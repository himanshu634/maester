import { Hono } from "hono";
import { listWorkspacesForUser } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { requireWorkspace } from "../middleware/workspace.js";
import { toWorkspace } from "../serialize.js";

export function workspaceRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const rows = await listWorkspacesForUser(deps.db, c.get("user").id);
    return c.json({ items: rows.map(toWorkspace), nextCursor: null });
  });
  r.get("/:ws", requireWorkspace(deps.db), (c) => c.json(toWorkspace(c.get("workspace"))));
  return r;
}
