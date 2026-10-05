import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  ChangeClassificationRequest,
  JobTypes,
  type ClassificationChanged,
  type ClassifyJobResponse,
  type DocumentClassification,
  type EvidenceField,
} from "@maester/contracts";
import { getCurrentClassification, getDocument, getLatestJobForSubject, listEvidence, schema, type ClassificationRow, type Db } from "@maester/db";
import { decideIntake, READ_KINDS } from "@maester/jobs";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { createJob } from "../jobs/create.js";
import { uuidParam } from "../middleware/params.js";
import { toClassification, toDocument, toEvidence, toJob } from "../serialize.js";
import { validate } from "../validation.js";

export function classificationRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id/classification", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const current = await getCurrentClassification(deps.db, workspace.id, doc.id);
    if (!current) throw new HttpError("NOT_FOUND", "document has not been identified yet");
    const evidence = await listEvidence(deps.db, workspace.id, current.id);
    const body: DocumentClassification = { classification: toClassification(current), evidence: evidence.map(toEvidence) };
    return c.json(body);
  });

  r.post("/:id/classification", validate("json", ChangeClassificationRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    const userId = c.get("user").id;
    const documentId = uuidParam(c, "id");

    let created: { row: ClassificationRow; read: boolean };
    try {
      created = await deps.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        const [locked] = await tx
          .select()
          .from(schema.document)
          .where(and(eq(schema.document.id, documentId), eq(schema.document.workspaceId, workspace.id)))
          .for("update");
        if (!locked) throw new HttpError("NOT_FOUND", "document not found");
        const prev = await getCurrentClassification(db, workspace.id, documentId);
        if (!prev) throw new HttpError("INVALID_STATE", "document has not been identified yet");
        if (prev.id !== input.basedOn) {
          throw new HttpError("CONFLICT", "the answers changed since you loaded them; reload and try again", [{ path: "basedOn", message: "not current" }]);
        }

        let companyId = prev.companyId;
        if (input.company && "id" in input.company) {
          const [found] = await tx
            .select()
            .from(schema.company)
            .where(and(eq(schema.company.id, input.company.id), eq(schema.company.workspaceId, workspace.id)));
          if (!found) throw new HttpError("VALIDATION_FAILED", "company not found in this workspace", [{ path: "company.id", message: "unknown company" }]);
          companyId = found.id;
        } else if (input.company) {
          const n = input.company.new;
          const [company] = await tx
            .insert(schema.company)
            .values({
              id: crypto.randomUUID(),
              workspaceId: workspace.id,
              displayName: n.displayName,
              country: n.country,
              cin: n.cin ?? null,
              bseCode: n.bseCode ?? null,
              nseSymbol: n.nseSymbol ?? null,
              createdByUserId: userId,
            })
            .returning();
          companyId = company!.id;
        }

        const kind = input.kind ?? prev.kind;
        const otherType = kind === "other" ? (input.otherType ?? (prev.kind === "other" ? prev.otherType : null) ?? "unlisted_type") : null;
        const resultsSpan = kind === "financial_results" ? (input.resultsSpan !== undefined ? input.resultsSpan : prev.resultsSpan) : null;
        const periodEnd = input.periodEnd !== undefined ? input.periodEnd : prev.periodEnd;
        const periodLabel = input.periodLabel !== undefined ? input.periodLabel : prev.periodLabel;

        const changed = new Set<EvidenceField>();
        if (kind !== prev.kind) changed.add("kind");
        if (otherType !== prev.otherType) changed.add("other_type");
        if (companyId !== prev.companyId) changed.add("company");
        if (periodEnd !== prev.periodEnd || periodLabel !== prev.periodLabel) changed.add("period");
        if (resultsSpan !== prev.resultsSpan) changed.add("results_span");
        if (changed.size === 0) throw new HttpError("VALIDATION_FAILED", "nothing changed");

        const isRead = READ_KINDS.has(kind);
        const read = isRead && companyId !== null && (changed.has("kind") || changed.has("company") || prev.readsUnderId === null);
        const id = crypto.randomUUID();
        const [row] = await tx
          .insert(schema.documentClassification)
          .values({
            id,
            workspaceId: workspace.id,
            documentId,
            kind,
            otherType,
            resultsSpan,
            periodEnd,
            periodLabel,
            companyId,
            companyNameAsPrinted: prev.companyNameAsPrinted,
            cin: prev.cin,
            bseCode: prev.bseCode,
            nseSymbol: prev.nseSymbol,
            statementsFound: prev.statementsFound,
            setBy: "investor",
            setByUserId: userId,
            readsUnderId: read ? id : isRead ? prev.readsUnderId : null,
            rulesVersion: prev.rulesVersion,
            model: prev.model,
            promptVersion: prev.promptVersion,
            warnings: prev.warnings,
          })
          .returning();

        // Evidence for an answer the investor changed no longer supports it; the rest carries over.
        const dropped = new Set<string>(changed);
        if (changed.has("company")) dropped.add("identifier");
        const carried = (await listEvidence(db, workspace.id, prev.id)).filter((e) => !dropped.has(e.field));
        const rows = [
          ...carried.map((e) => ({ ...e, id: crypto.randomUUID(), classificationId: id })),
          ...[...changed].map((field) => ({
            id: crypto.randomUUID(),
            workspaceId: workspace.id,
            classificationId: id,
            field,
            source: "investor" as const,
            ruleId: null,
            pageIndex: null,
            quote: null,
            textLayerMatch: null,
          })),
        ];
        if (rows.length) await tx.insert(schema.classificationEvidence).values(rows);
        return { row: row!, read };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError("CONFLICT", "a company with this name or identifier already exists", [{ path: "company.new", message: "already exists" }]);
      }
      throw err;
    }

    await decideIntake(deps.db, deps.dispatcher, created.row, { read: created.read });
    const doc = (await getDocument(deps.db, workspace.id, documentId))!;
    const job = await getLatestJobForSubject(deps.db, workspace.id, "document", documentId);
    const evidence = await listEvidence(deps.db, workspace.id, created.row.id);
    const body: ClassificationChanged = {
      document: toDocument(doc, job, created.row),
      classification: toClassification(created.row),
      evidence: evidence.map(toEvidence),
    };
    return c.json(body);
  });

  r.post("/:id/classify", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}; only stored documents can be classified`);
    await deps.db
      .update(schema.document)
      .set({ intakeState: "identifying", updatedAt: sql`now()` })
      .where(and(eq(schema.document.id, doc.id), eq(schema.document.workspaceId, workspace.id)));
    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id,
      type: JobTypes.DOCUMENT_CLASSIFY,
      subjectType: "document",
      subjectId: doc.id,
      pipelineVersion: `manual-${crypto.randomUUID()}`,
    });
    const body: ClassifyJobResponse = { job: toJob(job) };
    return c.json(body, 202);
  });

  return r;
}
