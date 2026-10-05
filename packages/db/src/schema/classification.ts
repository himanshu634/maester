import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { company, document, job, ts, workspace } from "./platform.js";

export const classificationKind = pgEnum("classification_kind", ["annual_report", "financial_results", "other", "not_sure"]);
export const otherDocumentType = pgEnum("other_document_type", [
  "shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
  "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type",
]);
export const resultsSpan = pgEnum("results_span", ["quarter", "half_year", "nine_months", "full_year"]);
export const classificationSetBy = pgEnum("classification_set_by", ["maester", "investor"]);
export const evidenceField = pgEnum("evidence_field", ["kind", "other_type", "company", "identifier", "period", "results_span", "statements"]);
export const evidenceSource = pgEnum("evidence_source", ["rule", "model", "investor"]);

export type StatementsFoundJson = { statement: string; basis: string; pages: number[] }[];
export type ClassificationWarningJson = { code: string; message: string }[];

/** One answer set about what a document is. Immutable; the newest row is current. */
export const documentClassification = pgTable(
  "document_classification",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    documentId: uuid("document_id").notNull().references(() => document.id),
    kind: classificationKind("kind").notNull(),
    otherType: otherDocumentType("other_type"),
    resultsSpan: resultsSpan("results_span"),
    periodEnd: date("period_end"),
    periodLabel: text("period_label"),
    companyId: uuid("company_id").references(() => company.id),
    companyNameAsPrinted: text("company_name_as_printed"),
    cin: text("cin"),
    bseCode: text("bse_code"),
    nseSymbol: text("nse_symbol"),
    statementsFound: jsonb("statements_found").$type<StatementsFoundJson>().notNull().default([]),
    setBy: classificationSetBy("set_by").notNull(),
    setByUserId: text("set_by_user_id").references(() => user.id),
    jobId: uuid("job_id").unique().references(() => job.id),
    /** The classification whose read gives this document its current figures. */
    readsUnderId: uuid("reads_under_id").references((): AnyPgColumn => documentClassification.id),
    rulesVersion: text("rules_version"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    warnings: jsonb("warnings").$type<ClassificationWarningJson>().notNull().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("document_classification_document_created").on(t.workspaceId, t.documentId, t.createdAt)],
);

/** Where an answer came from: a rule, the model or the investor, with its page and words. */
export const classificationEvidence = pgTable(
  "classification_evidence",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    classificationId: uuid("classification_id").notNull().references(() => documentClassification.id),
    field: evidenceField("field").notNull(),
    source: evidenceSource("source").notNull(),
    ruleId: text("rule_id"),
    pageIndex: integer("page_index"),
    quote: text("quote"),
    textLayerMatch: boolean("text_layer_match"),
  },
  (t) => [index("classification_evidence_classification").on(t.classificationId)],
);

export type ClassificationRow = typeof documentClassification.$inferSelect;
export type EvidenceRow = typeof classificationEvidence.$inferSelect;
