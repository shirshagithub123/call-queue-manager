import { randomUUID } from "node:crypto";
import { parseCsv } from "./csv.js";
import { normalizePhone } from "./phone.js";

export const OUTCOMES = ["CONNECTED", "NO_ANSWER", "WRONG_NUMBER"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Attempt { id: string; contactId: string; outcome: Outcome; at: string; }

export interface Contact {
  id: string; name: string; phone: string; phoneKey: string; attempts: Attempt[];
}

export interface ContactList {
  id: string; name: string; maxAttempts: number; createdAt: string;
  contacts: Contact[];
  queue: string[];                  // contact ids, front = next to call
  currentContactId: string | null;  // handed out, no outcome yet
}

export interface Stats { total: number; pending: number; finished: number; outOfAttempts: number; }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type ContactStatus = "pending" | "finished" | "out_of_attempts";

export function statusOf(contact: Contact, maxAttempts: number): ContactStatus {
  const last = contact.attempts[contact.attempts.length - 1];
  if (last && (last.outcome === "CONNECTED" || last.outcome === "WRONG_NUMBER")) return "finished"; // rule 7
  if (contact.attempts.length >= maxAttempts) return "out_of_attempts";                              // rule 6
  return "pending";
}

export class CallQueueService {
  private lists = new Map<string, ContactList>();

  // ---------- Requirements 1 and 2: create a list from a CSV ----------
  createList(input: { name?: unknown; maxAttempts?: unknown; csv?: unknown }) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new HttpError(400, "List name is required.");

    const maxAttempts = Number(input.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      throw new HttpError(400, "maxAttempts must be a whole number between 1 and 20.");
    }
    if (typeof input.csv !== "string" || input.csv.trim() === "") {
      throw new HttpError(400, "CSV content is required.");
    }

    const rows = parseCsv(input.csv);
    if (rows.length === 0) throw new HttpError(400, "CSV is empty.");

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const nameCol = header.indexOf("name");
    const phoneCol = header.indexOf("phone");
    if (nameCol === -1 || phoneCol === -1) {
      throw new HttpError(400, 'CSV must have the columns "name" and "phone".');
    }

    const contacts: Contact[] = [];
    const skippedRows: { row: number; name: string; reason: string }[] = [];
    const seen = new Set<string>();

    rows.slice(1).forEach((cells, i) => {
      const rowNumber = i + 2; // the header is row 1
      const contactName = (cells[nameCol] ?? "").trim() || "Unknown";
      const rawPhone = (cells[phoneCol] ?? "").trim();
      const phone = normalizePhone(rawPhone);

      if (!phone.ok) {
        skippedRows.push({
          row: rowNumber,
          name: contactName,
          reason: phone.reason === "missing" ? "missing phone" : "invalid phone",
        });
        return;
      }
      if (seen.has(phone.key)) {
        skippedRows.push({ row: rowNumber, name: contactName, reason: "duplicate phone" });
        return;
      }
      seen.add(phone.key);
      contacts.push({
        id: randomUUID(),
        name: contactName,
        phone: rawPhone,
        phoneKey: phone.key,
        attempts: [],
      });
    });

    const list: ContactList = {
      id: randomUUID(),
      name,
      maxAttempts,
      createdAt: new Date().toISOString(),
      contacts,
      queue: contacts.map((c) => c.id), // upload order
      currentContactId: null,
    };
    this.lists.set(list.id, list);

    return {
      list: { id: list.id, name: list.name, maxAttempts: list.maxAttempts },
      added: contacts.length,
      skipped: skippedRows.length,
      skippedRows,
    };
  }

  // ---------- Lists and stats (requirement 9) ----------
  listAll() {
    return [...this.lists.values()].map((l) => ({
      id: l.id,
      name: l.name,
      maxAttempts: l.maxAttempts,
      createdAt: l.createdAt,
      stats: this.statsFor(l),
    }));
  }

  getList(id: string) {
    const l = this.mustGet(id);
    return {
      id: l.id,
      name: l.name,
      maxAttempts: l.maxAttempts,
      createdAt: l.createdAt,
      stats: this.statsFor(l),
    };
  }

  getStats(id: string): Stats {
    return this.statsFor(this.mustGet(id));
  }

  // ---------- Requirements 3, 6, 7, 8: give out the next contact ----------
  next(listId: string) {
    const list = this.mustGet(listId);

    // A contact is already "on the phone": give the same one back.
    if (list.currentContactId) {
      return this.nextResponse(list, this.mustContact(list, list.currentContactId));
    }

    // Otherwise take from the front of the queue.
    while (list.queue.length > 0) {
      const id = list.queue.shift() as string;
      const contact = this.mustContact(list, id);
      if (statusOf(contact, list.maxAttempts) === "pending") { // safety re-check
        list.currentContactId = contact.id;
        return this.nextResponse(list, contact);
      }
    }
    return { contact: null, message: "Nobody left to call.", stats: this.statsFor(list) };
  }

  // ---------- Requirements 4, 5, 8: record the outcome of the call ----------
  recordAttempt(listId: string, input: { contactId?: unknown; outcome?: unknown }) {
    const list = this.mustGet(listId);

    if (!OUTCOMES.includes(input.outcome as Outcome)) {
      throw new HttpError(400, `outcome must be one of: ${OUTCOMES.join(", ")}.`);
    }
    if (typeof input.contactId !== "string" || input.contactId === "") {
      throw new HttpError(400, "contactId is required.");
    }
    if (list.currentContactId !== input.contactId) {
      throw new HttpError(409, "That contact is not the one currently being called.");
    }

    const contact = this.mustContact(list, input.contactId);
    const attempt: Attempt = {
      id: randomUUID(),
      contactId: contact.id,
      outcome: input.outcome as Outcome,
      at: new Date().toISOString(), // requirement 5: time is saved
    };
    contact.attempts.push(attempt);
    list.currentContactId = null;

    // Rule 8: still pending (No answer, tries left) -> back of the queue
    if (statusOf(contact, list.maxAttempts) === "pending") list.queue.push(contact.id);

    return { attempt, status: statusOf(contact, list.maxAttempts), stats: this.statsFor(list) };
  }

  // ---------- All saved attempts of a list ----------
  getAttempts(listId: string) {
    const list = this.mustGet(listId);
    return list.contacts
      .flatMap((c) => c.attempts.map((a) => ({ ...a, contactName: c.name, phone: c.phone })))
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  // ---------- Helpers ----------
  private nextResponse(list: ContactList, c: Contact) {
    return {
      contact: {
        id: c.id,
        name: c.name,
        phone: c.phone,
        attemptsMade: c.attempts.length,
        attemptNumber: c.attempts.length + 1,
        maxAttempts: list.maxAttempts,
      },
      stats: this.statsFor(list),
    };
  }

  private statsFor(list: ContactList): Stats {
    const stats: Stats = { total: list.contacts.length, pending: 0, finished: 0, outOfAttempts: 0 };
    for (const c of list.contacts) {
      const s = statusOf(c, list.maxAttempts);
      if (s === "pending") stats.pending++;
      else if (s === "finished") stats.finished++;
      else stats.outOfAttempts++;
    }
    return stats;
  }

  private mustGet(id: string): ContactList {
    const list = this.lists.get(id);
    if (!list) throw new HttpError(404, "List not found.");
    return list;
  }

  private mustContact(list: ContactList, id: string): Contact {
    const c = list.contacts.find((x) => x.id === id);
    if (!c) throw new HttpError(404, "Contact not found.");
    return c;
  }
}