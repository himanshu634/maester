import { Hono } from "hono";
import { z } from "zod";
import { DispatchAuthError, verifyDispatchRequest } from "./auth.js";
import { runJob, type WorkerDeps } from "./run.js";

const Body = z.object({ jobId: z.uuid() });

export function createWorkerApp(deps: WorkerDeps) {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.post("/tasks/:type", async (c) => {
    try {
      await verifyDispatchRequest(deps.env, c.req.raw.headers);
    } catch (err) {
      if (err instanceof DispatchAuthError) return c.json({ error: err.message }, 401);
      throw err;
    }
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const result = await runJob(deps, c.req.param("type"), parsed.data.jobId);
    return c.json(result.body, result.status);
  });

  app.onError((err, c) => {
    deps.logger.error({ err: { name: err.name, message: err.message } }, "unhandled worker error");
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
