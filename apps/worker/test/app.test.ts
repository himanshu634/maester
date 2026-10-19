import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { createWorkerApp } from "../src/app.js";
import { logJobBacklog, logUnhandledQueued } from "../src/start.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

const noop = { "test.noop": async () => ({ done: true }) };
const post = (app: ReturnType<typeof createWorkerApp>, jobId: string, headers: Record<string, string> = {}) =>
  app.request("/tasks/test.noop", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jobId }) });

describe("worker app", () => {
  it("has no /tasks route in queue mode, since the runner pulls jobs", async () => {
    const c = await createWorkerContext(noop);
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      const id = await seedJob(c.db, workspaceId, { type: "test.noop" });
      const app = createWorkerApp(c);
      expect((await post(app, id)).status).toBe(404);
      const [row] = await c.db.select().from(schema.job).where(eq(schema.job.id, id));
      expect(row!.state).toBe("queued");
      expect((await app.request("/healthz")).status).toBe(200);
    } finally {
      await c.close();
    }
  });

  it("mounts /tasks in cloud-tasks mode, behind the OIDC check", async () => {
    const c = await createWorkerContext(noop, {}, { DISPATCH_MODE: "cloud-tasks", API_SERVICE_ACCOUNT_EMAIL: "api@p.iam" });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      const id = await seedJob(c.db, workspaceId, { type: "test.noop" });
      const app = createWorkerApp(c);
      const res = await post(app, id);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "missing bearer token" });
      expect((await post(app, id, { authorization: "Bearer not-a-token" })).status).toBe(401);
      const [row] = await c.db.select().from(schema.job).where(eq(schema.job.id, id));
      expect(row!.state).toBe("queued");
      expect((await app.request("/healthz")).status).toBe(200);
    } finally {
      await c.close();
    }
  });
});

describe("logUnhandledQueued", () => {
  it("logs each queued type with no handler once, with its count only", async () => {
    const c = await createWorkerContext(noop);
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await seedJob(c.db, workspaceId, { type: "test.noop" });
      await seedJob(c.db, workspaceId, { type: "test.orphan" });
      await seedJob(c.db, workspaceId, { type: "test.orphan" });
      await seedJob(c.db, workspaceId, { type: "test.gone" });
      await seedJob(c.db, workspaceId, { type: "test.gone", state: "failed" });
      const lines: Record<string, unknown>[] = [];
      const logger = pino({ level: "info" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
      const rows = await logUnhandledQueued(c.db, ["test.noop"], logger);
      expect(rows.sort((a, b) => a.type.localeCompare(b.type))).toEqual([{ type: "test.gone", count: 1 }, { type: "test.orphan", count: 2 }]);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.msg).toBe("queued jobs of a type this worker has no handler for");
        const fields = Object.keys(line).filter((k) => !["level", "time", "pid", "hostname", "msg"].includes(k));
        expect(fields.sort()).toEqual(["count", "type"]);
      }
    } finally {
      await c.close();
    }
  });
});

describe("logJobBacklog", () => {
  it("logs the queued and running count of each type once, with the type and the counts only", async () => {
    const c = await createWorkerContext(noop);
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await seedJob(c.db, workspaceId, { type: "document.extract" });
      await seedJob(c.db, workspaceId, { type: "document.extract" });
      await seedJob(c.db, workspaceId, { type: "document.extract", state: "running", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
      await seedJob(c.db, workspaceId, { type: "document.classify", state: "running", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) });
      await seedJob(c.db, workspaceId, { type: "document.verify", state: "failed" });
      await seedJob(c.db, workspaceId, { type: "document.verify", state: "succeeded" });
      const lines: Record<string, unknown>[] = [];
      const logger = pino({ level: "info" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
      const rows = await logJobBacklog(c.db, logger);
      expect(rows.sort((a, b) => a.type.localeCompare(b.type))).toEqual([
        { type: "document.classify", queued: 0, running: 1 },
        { type: "document.extract", queued: 2, running: 1 },
      ]);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.msg).toBe("jobs waiting or running at start");
        const fields = Object.keys(line).filter((k) => !["level", "time", "pid", "hostname", "msg"].includes(k));
        expect(fields.sort()).toEqual(["queued", "running", "type"]);
      }
    } finally {
      await c.close();
    }
  });
});
