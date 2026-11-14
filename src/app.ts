import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CallQueueService, HttpError } from "./service.js";

// A function that builds the app, so tests can make a fresh one each time
export function createApp(service = new CallQueueService()) {
  const app = express();
  app.use(express.json({ limit: "2mb" })); // the CSV is sent as text inside JSON

  const api = express.Router();

  // Create a list from a CSV (requirements 1 and 2)
  api.post("/lists", (req, res) => {
    res.status(201).json(service.createList(req.body ?? {}));
  });

  api.get("/lists", (_req, res) => {
    res.json(service.listAll());
  });

  api.get("/lists/:id", (req, res) => {
    res.json(service.getList(String(req.params.id)));
  });

  // Stats (requirement 9)
  api.get("/lists/:id/stats", (req, res) => {
    res.json(service.getStats(String(req.params.id)));
  });

  // Next contact (requirement 3)
  api.post("/lists/:id/next", (req, res) => {
    res.json(service.next(String(req.params.id)));
  });

  // Record an outcome (requirements 4 and 5)
  api.post("/lists/:id/attempts", (req, res) => {
    res.status(201).json(service.recordAttempt(String(req.params.id), req.body ?? {}));
  });

  api.get("/lists/:id/attempts", (req, res) => {
    res.json(service.getAttempts(String(req.params.id)));
  });

  app.use("/api", api);

  // Serve the front end page from the "public" folder
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  app.use(express.static(publicDir));

  // Error handler: our errors keep their status, anything else is a 500
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 400) {
      res.status(400).json({ error: "Invalid request body." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}