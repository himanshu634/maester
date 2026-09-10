import { createMiddleware } from "hono/factory";
import { getWorkspaceForUser, type Db } from "@maester/db";
import type { AppEnv } from "../app.js";
import { HttpError } from "../errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireWorkspace(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ws = c.req.param("ws");
    if (!ws || !UUID.test(ws)) throw new HttpError("NOT_FOUND", "workspace not found");
    const found = await getWorkspaceForUser(db, c.get("user").id, ws);
    if (!found) throw new HttpError("NOT_FOUND", "workspace not found");
    c.set("workspace", found.workspace);
    c.set("membership", found.membership);
    await next();
  });
}
