import { createMiddleware } from "hono/factory";
import { getWorkspaceForUser, type Db } from "@maester/db";
import type { AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { UUID } from "./params.js";

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
