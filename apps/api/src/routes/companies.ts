import { Hono } from "hono";
import { ConfirmCompanyRequest, CreateCompanyRequest, ListQuery, type ConfirmCompanyResponse } from "@maester/contracts";
import { getCompany, getCurrentClassification, listCompanies, lockHeldDocuments, schema, type ClassificationRow, type Db, type PrintedIdentity } from "@maester/db";
import { decideIntake, redecidePdfsAfterXbrl } from "@maester/jobs";
import type { AppDeps, AppEnv } from "../app.js";
import { writeInvestorClassification } from "../documents/reclassify.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { uuidParam } from "../middleware/params.js";
import { toCompany } from "../serialize.js";
import { validate } from "../validation.js";

/** True when the classification prints one of the identity's given codes, matched exactly, as `lockHeldDocuments` matches. */
function printsIdentity(c: ClassificationRow, identity: PrintedIdentity): boolean {
  return (
    (!!identity.cin && c.cin === identity.cin) ||
    (!!identity.bseCode && c.bseCode === identity.bseCode) ||
    (!!identity.isin && c.isin === identity.isin) ||
    (!!identity.nseSymbol && c.nseSymbol === identity.nseSymbol)
  );
}

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

  /**
   * Confirms a company once for every file that prints its identity. One transaction: create the company when asked,
   * lock the workspace's held documents that print any of the identifiers (oldest first), and write an investor
   * classification for each, based on the one it has now. A document another confirm has already given a company is
   * skipped. After the commit each gets its next step from `decideIntake` (instances first, so a PDF decided after them
   * sees them unsettled and waits), then the PDFs that wait for XBRL are decided again.
   */
  r.post("/confirm", validate("json", ConfirmCompanyRequest), async (c) => {
    const { identity, company } = c.req.valid("json");
    const workspace = c.get("workspace");
    const userId = c.get("user").id;

    let outcome: { companyId: string; written: { row: ClassificationRow; read: boolean }[] };
    try {
      outcome = await deps.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        let companyId: string;
        if ("id" in company) {
          const found = await getCompany(db, workspace.id, company.id);
          if (!found) throw new HttpError("VALIDATION_FAILED", "company not found in this workspace", [{ path: "company.id", message: "unknown company" }]);
          companyId = found.id;
        } else {
          const n = company.new;
          const [created] = await tx
            .insert(schema.company)
            .values({
              id: crypto.randomUUID(),
              workspaceId: workspace.id,
              displayName: n.displayName,
              country: n.country,
              // The identity being confirmed names the company's codes; the others are filled in from the request.
              cin: identity.cin ?? n.cin ?? null,
              bseCode: identity.bseCode ?? n.bseCode ?? null,
              isin: identity.isin ?? n.isin ?? null,
              nseSymbol: identity.nseSymbol ?? n.nseSymbol ?? null,
              createdByUserId: userId,
            })
            .returning();
          companyId = created!.id;
        }

        const written: { row: ClassificationRow; read: boolean; format: "pdf" | "xbrl" }[] = [];
        for (const held of await lockHeldDocuments(db, workspace.id, identity)) {
          // The lock is held now: a confirm that ran first has already given this document its company, and answers
          // written while this one waited may no longer print the identity.
          const current = await getCurrentClassification(db, workspace.id, held.documentId);
          if (!current || current.companyId !== null || !printsIdentity(current, identity)) continue;
          const result = await writeInvestorClassification(tx, workspace.id, userId, held.documentId, { basedOn: current.id, company: { id: companyId } });
          written.push({ ...result, format: held.format });
        }
        // Instances before PDFs, whatever order they were added in.
        written.sort((a, b) => (a.format === b.format ? 0 : a.format === "xbrl" ? -1 : 1));
        return { companyId, written };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError("CONFLICT", "a company with this name or identifier already exists", [{ path: "company.new", message: "already exists" }]);
      }
      throw err;
    }

    for (const { row, read } of outcome.written) await decideIntake(deps.db, deps.dispatcher, row, { read });
    if (outcome.written.length > 0) await redecidePdfsAfterXbrl(deps.db, deps.dispatcher, workspace.id);
    const body: ConfirmCompanyResponse = { companyId: outcome.companyId, confirmed: outcome.written.length };
    return c.json(body);
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
