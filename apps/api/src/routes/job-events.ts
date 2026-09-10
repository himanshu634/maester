import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJob, type JobRow } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { toJob } from "../serialize.js";

export interface SseOptions { pollMs: number; heartbeatMs: number; maxLifetimeMs: number }
export const DEFAULT_SSE: SseOptions = { pollMs: 2000, heartbeatMs: 15000, maxLifetimeMs: 30 * 60 * 1000 };

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const fingerprint = (j: JobRow) => `${j.state}|${j.updatedAt.toISOString()}|${JSON.stringify(j.progress)}`;

export function jobEventsRoute(deps: AppDeps, opts: SseOptions = DEFAULT_SSE) {
  const r = new Hono<AppEnv>();

  r.get("/:id/events", async (c) => {
    const workspaceId = c.get("workspace").id;
    const jobId = c.req.param("id");
    const initial = await getJob(deps.db, workspaceId, jobId);
    if (!initial) throw new HttpError("NOT_FOUND", "job not found");

    return streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      const startedAt = Date.now();
      let lastHeartbeat = Date.now();
      let last = fingerprint(initial);
      let seq = 0;

      await stream.writeSSE({ event: "job", id: String(seq++), data: JSON.stringify(toJob(initial)) });
      if (TERMINAL.has(initial.state)) {
        await stream.writeSSE({ event: "done", data: "" });
        return;
      }

      while (open && Date.now() - startedAt < opts.maxLifetimeMs) {
        await stream.sleep(opts.pollMs);
        if (!open) break;
        const current = await getJob(deps.db, workspaceId, jobId);
        if (!current) break;
        const fp = fingerprint(current);
        if (fp !== last) {
          last = fp;
          await stream.writeSSE({ event: "job", id: String(seq++), data: JSON.stringify(toJob(current)) });
          if (TERMINAL.has(current.state)) {
            await stream.writeSSE({ event: "done", data: "" });
            break;
          }
        } else if (Date.now() - lastHeartbeat >= opts.heartbeatMs) {
          lastHeartbeat = Date.now();
          await stream.write(": ping\n\n");
        }
      }
    });
  });

  return r;
}
