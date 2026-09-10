import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.js";

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const traceId = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  c.set("traceId", traceId);
  await next();
  c.header("x-request-id", traceId);
});
