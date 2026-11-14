import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app.js";
import { CallQueueService, HttpError } from "../src/service.js";

const sampleCsv = readFileSync(new URL("../sample.csv", import.meta.url), "utf8");

let service: CallQueueService;

// Helper: make a list from names (each gets a unique phone number)
function makeList(names: string[], maxAttempts = 3) {
  const csv =
    "name,phone\n" +
    names.map((n, i) => `${n},+1 555 000 01${String(i).padStart(2, "0")}`).join("\n");
  return service.createList({ name: "Contacts", maxAttempts, csv }).list.id;
}

// Helper: get the next contact and record an outcome for it
function call(listId: string, outcome: "CONNECTED" | "NO_ANSWER" | "WRONG_NUMBER") {
  const { contact } = service.next(listId);
  if (!contact) throw new Error("expected a contact");
  service.recordAttempt(listId, { contactId: contact.id, outcome });
  return contact.name;
}

// A fresh empty service before every test
beforeEach(() => {
  service = new CallQueueService();
});

describe("rules", () => {
  it("rule 7: a Connected contact is never given out again", () => {
    const id = makeList(["Ann"]);
    expect(call(id, "CONNECTED")).toBe("Ann");
    expect(service.next(id).contact).toBeNull();
  });

  it("rule 7: a Wrong number contact is never given out again", () => {
    const id = makeList(["Ann", "Ben"]);
    expect(call(id, "WRONG_NUMBER")).toBe("Ann");
    expect(call(id, "CONNECTED")).toBe("Ben");
    expect(service.next(id).contact).toBeNull();
  });

  it("rule 6: a contact is never called more than maxAttempts times", () => {
    const id = makeList(["Ann"], 3);
    call(id, "NO_ANSWER");
    call(id, "NO_ANSWER");
    call(id, "NO_ANSWER");
    expect(service.next(id).contact).toBeNull();
    expect(service.getAttempts(id)).toHaveLength(3);
    expect(service.getStats(id)).toMatchObject({ pending: 0, finished: 0, outOfAttempts: 1 });
  });

  it("rule 8: No answer goes to the back of the queue", () => {
    const id = makeList(["Ann", "Ben", "Cara"]);
    expect(call(id, "NO_ANSWER")).toBe("Ann"); // Ann goes to the back
    expect(call(id, "CONNECTED")).toBe("Ben");
    expect(call(id, "CONNECTED")).toBe("Cara");
    expect(call(id, "CONNECTED")).toBe("Ann"); // Ann comes round again
    expect(service.next(id).contact).toBeNull();
  });

  it("calling next twice returns the same contact and does not use up an attempt", () => {
    const id = makeList(["Ann", "Ben"]);
    const a = service.next(id).contact;
    const b = service.next(id).contact;
    expect(b?.id).toBe(a?.id);
    expect(service.getAttempts(id)).toHaveLength(0);
  });

  it("an outcome can only be recorded once, for the contact being called", () => {
    const id = makeList(["Ann", "Ben"]);
    const ann = service.next(id).contact!;
    // wrong contact id
    expect(() => service.recordAttempt(id, { contactId: "nope", outcome: "CONNECTED" })).toThrow(HttpError);
    // double submit
    service.recordAttempt(id, { contactId: ann.id, outcome: "NO_ANSWER" });
    expect(() => service.recordAttempt(id, { contactId: ann.id, outcome: "NO_ANSWER" })).toThrow(HttpError);
    expect(service.getAttempts(id)).toHaveLength(1);
  });

  it("every attempt is saved with a time and an outcome", () => {
    const id = makeList(["Ann"]);
    call(id, "NO_ANSWER");
    const [attempt] = service.getAttempts(id);
    expect(attempt.outcome).toBe("NO_ANSWER");
    expect(Number.isNaN(Date.parse(attempt.at))).toBe(false);
  });
});

describe("csv upload", () => {
  it("handles the sample CSV: skips missing phone and duplicate phone", () => {
    const result = service.createList({ name: "Sample", maxAttempts: 3, csv: sampleCsv });
    expect(result.added).toBe(3); // Priya, James, Tom
    expect(result.skipped).toBe(2); // Aisha (missing), Maria (duplicate of James)
    expect(result.skippedRows).toEqual([
      { row: 4, name: "Aisha Bello", reason: "missing phone" },
      { row: 6, name: "Maria Lopez", reason: "duplicate phone" },
    ]);
  });

  it("treats (312) 555-0103 and +1 312 555 0103 as the same number", () => {
    const csv = "name,phone\nA,(312) 555-0103\nB,+1 312 555 0103";
    expect(service.createList({ name: "x", maxAttempts: 1, csv })).toMatchObject({ added: 1, skipped: 1 });
  });

  it("rejects a bad CSV, a bad maxAttempts and a missing name", () => {
    expect(() => service.createList({ name: "x", maxAttempts: 3, csv: "a,b\n1,2" })).toThrow(HttpError);
    expect(() => service.createList({ name: "x", maxAttempts: 0, csv: sampleCsv })).toThrow(HttpError);
    expect(() => service.createList({ name: "", maxAttempts: 3, csv: sampleCsv })).toThrow(HttpError);
  });
});

describe("stats", () => {
  it("counts pending, finished and out of attempts", () => {
    const id = makeList(["Ann", "Ben", "Cara"], 1);
    call(id, "CONNECTED"); // Ann finished
    call(id, "NO_ANSWER"); // Ben out of attempts (max is 1)
    expect(service.getStats(id)).toEqual({ total: 3, pending: 1, finished: 1, outOfAttempts: 1 });
  });
});

describe("REST API", () => {
  it("full flow over HTTP", async () => {
    const app = createApp(new CallQueueService());

    const created = await request(app)
      .post("/api/lists")
      .send({ name: "Sample", maxAttempts: 2, csv: sampleCsv })
      .expect(201);
    expect(created.body).toMatchObject({ added: 3, skipped: 2 });
    const listId = created.body.list.id;

    const next = await request(app).post(`/api/lists/${listId}/next`).expect(200);
    expect(next.body.contact.name).toBe("Priya Sharma");

    const rec = await request(app)
      .post(`/api/lists/${listId}/attempts`)
      .send({ contactId: next.body.contact.id, outcome: "CONNECTED" })
      .expect(201);
    expect(rec.body.stats).toMatchObject({ pending: 2, finished: 1 });

    // invalid outcome -> 400, unknown list -> 404
    await request(app)
      .post(`/api/lists/${listId}/attempts`)
      .send({ contactId: "x", outcome: "BUSY" })
      .expect(400);
    await request(app).post("/api/lists/nope/next").expect(404);
  });
});