import { Hono } from "hono";
import { listWorkspacesForUser } from "@maester/db";
import type { Me } from "@maester/contracts";
import type { AppDeps, AppEnv } from "../app.js";
import { toWorkspace } from "../serialize.js";

export function meRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const user = c.get("user");
    const workspaces = await listWorkspacesForUser(deps.db, user.id);
    const body: Me = { user, workspaces: workspaces.map(toWorkspace) };
    return c.json(body);
  });
  return r;
}
