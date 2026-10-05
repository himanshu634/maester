import { Hono } from "hono";
import { CreateCompanyRequest, ListQuery } from "@maester/contracts";
import { getCompany, listCompanies, schema } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { uuidParam } from "../middleware/params.js";
import { toCompany } from "../serialize.js";
import { validate } from "../validation.js";

export function companyRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.post("/", validate("json", CreateCompanyRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    try {
      const [row] = await deps.db
        .insert(schema.company)
        .values({
          id: crypto.randomUUID(),
          workspaceId: workspace.id,
          displayName: input.displayName,
          country: input.country,
          createdByUserId: c.get("user").id,
        })
        .returning();
      return c.json(toCompany(row!), 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError("CONFLICT", "a company with this name already exists", [{ path: "displayName", message: "already exists" }]);
      }
      throw err;
    }
  });

  r.get("/", validate("query", ListQuery), async (c) => {
    const q = c.req.valid("query");
    const page = await listCompanies(deps.db, c.get("workspace").id, { cursor: q.cursor, limit: q.limit });
    return c.json({ items: page.items.map(toCompany), nextCursor: page.nextCursor });
  });

  r.get("/:id", async (c) => {
    const row = await getCompany(deps.db, c.get("workspace").id, uuidParam(c, "id"));
    if (!row) throw new HttpError("NOT_FOUND", "company not found");
    return c.json(toCompany(row));
  });

  return r;
}
