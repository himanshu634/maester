import { and, eq, sql } from "drizzle-orm";
import type { ChangeClassificationRequest, EvidenceField } from "@maester/contracts";
import { getCurrentClassification, listEvidence, schema, type ClassificationRow, type Db } from "@maester/db";
import { READ_KINDS } from "@maester/jobs";
import { HttpError } from "../errors.js";

/** The transaction a caller opens with `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Writes the investor's answers as the document's new classification, in the caller's transaction. It locks the document
 * row, so the classification written last is the newest, and it takes the answers from `input.basedOn`: when that is no
 * longer the current one it throws CONFLICT, and when nothing would change, VALIDATION_FAILED. A new company is created
 * here; a name or code already used makes the insert fail with a unique violation, which the caller turns into 409 outside
 * its transaction (a violation inside it aborts it). `read` says whether the answers ask for a read, which the caller
 * hands to `decideIntake` once the transaction has committed. Evidence for an answer the investor changed is dropped; the
 * rest carries over.
 */
export async function writeInvestorClassification(
  tx: Tx,
  workspaceId: string,
  userId: string,
  documentId: string,
  input: ChangeClassificationRequest,
): Promise<{ row: ClassificationRow; read: boolean }> {
  const db = tx as unknown as Db;
  const [locked] = await tx
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, documentId), eq(schema.document.workspaceId, workspaceId)))
    .for("update");
  if (!locked) throw new HttpError("NOT_FOUND", "document not found");
  const prev = await getCurrentClassification(db, workspaceId, documentId);
  if (!prev) throw new HttpError("INVALID_STATE", "document has not been identified yet");
  if (prev.id !== input.basedOn) {
    throw new HttpError("CONFLICT", "the answers changed since you loaded them; reload and try again", [{ path: "basedOn", message: "not current" }]);
  }

  let companyId = prev.companyId;
  if (input.company && "id" in input.company) {
    const [found] = await tx
      .select()
      .from(schema.company)
      .where(and(eq(schema.company.id, input.company.id), eq(schema.company.workspaceId, workspaceId)));
    if (!found) throw new HttpError("VALIDATION_FAILED", "company not found in this workspace", [{ path: "company.id", message: "unknown company" }]);
    companyId = found.id;
  } else if (input.company) {
    const n = input.company.new;
    const [company] = await tx
      .insert(schema.company)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
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
      workspaceId,
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
      isin: prev.isin,
      xbrlFormat: prev.xbrlFormat,
      basis: prev.basis,
      statementsFound: prev.statementsFound,
      setBy: "investor",
      setByUserId: userId,
      readsUnderId: read ? id : isRead ? prev.readsUnderId : null,
      rulesVersion: prev.rulesVersion,
      model: prev.model,
      promptVersion: prev.promptVersion,
      warnings: prev.warnings,
      // Taken under the document lock, so the classification written last is the newest.
      createdAt: sql`clock_timestamp()`,
    })
    .returning();

  // Evidence for an answer the investor changed no longer supports it; the rest carries over.
  const answered: Partial<Record<EvidenceField, boolean>> = {
    kind: true,
    other_type: otherType !== null,
    company: companyId !== null,
    period: periodEnd !== null || periodLabel !== null,
    results_span: resultsSpan !== null,
  };
  const given = (field: EvidenceField) => answered[field] === true;
  const dropped = new Set<string>(changed);
  if (changed.has("company")) dropped.add("identifier");
  const carried = (await listEvidence(db, workspaceId, prev.id)).filter((e) => !dropped.has(e.field));
  const rows = [
    ...carried.map((e) => ({ ...e, id: crypto.randomUUID(), classificationId: id })),
    // Only answers actually given; a field cleared as a side effect (e.g. results span) has no investor row.
    ...[...changed].filter(given).map((field) => ({
      id: crypto.randomUUID(),
      workspaceId,
      classificationId: id,
      field,
      source: "investor" as const,
      ruleId: null,
      pageIndex: null,
      quote: null,
      textLayerMatch: null,
      element: null,
      context: null,
    })),
  ];
  if (rows.length) await tx.insert(schema.classificationEvidence).values(rows);
  return { row: row!, read };
}
