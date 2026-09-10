import { Hono } from "hono";
import { getJob } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { retryJob } from "../jobs/create.js";
import { uuidParam } from "../middleware/params.js";
import { toJob } from "../serialize.js";

export function jobRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id", async (c) => {
    const job = await getJob(deps.db, c.get("workspace").id, uuidParam(c, "id"));
    if (!job) throw new HttpError("NOT_FOUND", "job not found");
    return c.json(toJob(job));
  });

  r.post("/:id/retry", async (c) => {
    const job = await retryJob(deps.db, deps.dispatcher, c.get("workspace").id, uuidParam(c, "id"));
    return c.json(toJob(job));
  });

  return r;
}
