import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db, MembershipRow, WorkspaceRow } from "@maester/db";
import type { ObjectStore } from "@maester/storage";
import type { Env } from "./env.js";
import { errorBody, HttpError } from "./errors.js";
import type { Logger } from "./logger.js";
import { requestId } from "./middleware/request-id.js";

export type AppEnv = {
  Variables: {
    traceId: string;
    user: { id: string; name: string; email: string };
    session: { id: string; userId: string };
    workspace: WorkspaceRow;
    membership: MembershipRow;
  };
};

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Db;
  auth: unknown;
  store: ObjectStore;
  dispatcher: unknown;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const allowed = new Set(deps.env.ALLOWED_ORIGINS);

  app.use("*", requestId);
  app.use(
    "*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : ""),
      credentials: true,
      allowHeaders: ["Content-Type", "x-request-id"],
      exposeHeaders: ["x-request-id"],
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.notFound((c) => c.json(errorBody("NOT_FOUND", "route not found", c.get("traceId")), 404));

  app.onError((err, c) => {
    const traceId = c.get("traceId") ?? "unknown";
    if (err instanceof HttpError) {
      return c.json(errorBody(err.code, err.message, traceId, err.fields), err.status as 400);
    }
    deps.logger.error({ traceId, err: { name: err.name, message: err.message, stack: err.stack } }, "unhandled error");
    return c.json(errorBody("INTERNAL", "internal error", traceId), 500);
  });

  return app;
}
