import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { documentClassification } from "./classification.js";
import { company, document, job, ts, workspace } from "./platform.js";

export const extractionState = pgEnum("extraction_state", ["complete", "partial"]);
export const statementKind = pgEnum("statement_kind", ["balance_sheet", "income_statement", "cash_flow"]);
export const reportingBasis = pgEnum("reporting_basis", ["consolidated", "standalone", "unknown"]);
export const valueStatus = pgEnum("value_status", ["value", "dash", "unparsed"]);
export const checkType = pgEnum("check_type", ["subtotal", "balance_identity"]);
export const checkStatus = pgEnum("check_status", ["passed", "failed", "not_checked"]);

export type CoverageJson = {
  statements: { statement: string; basis: string; pages: number[]; status: string; message?: string | null }[];
};
export type WarningJson = { code: string; message: string }[];

/** One extraction run over one document. Immutable; the newest row is the current revision. */
export const extractionRevision = pgTable(
  "extraction_revision",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    documentId: uuid("document_id").notNull().references(() => document.id),
    jobId: uuid("job_id").notNull().unique().references(() => job.id),
    /** The classification this revision was read under; null for revisions made before intake. */
    classificationId: uuid("classification_id").references(() => documentClassification.id),
    state: extractionState("state").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    pageCount: integer("page_count").notNull(),
    companyNameAsPrinted: text("company_name_as_printed"),
    coverage: jsonb("coverage").$type<CoverageJson>().notNull(),
    warnings: jsonb("warnings").$type<WarningJson>().notNull().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("extraction_revision_document_created").on(t.workspaceId, t.documentId, t.createdAt)],
);

/** A reported value as printed, with its parsed and normalized decimal. Immutable. */
export const financialFact = pgTable(
  "financial_fact",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    revisionId: uuid("revision_id").notNull().references(() => extractionRevision.id),
    companyId: uuid("company_id").references(() => company.id),
    statement: statementKind("statement").notNull(),
    basis: reportingBasis("basis").notNull(),
    section: text("section").notNull(),
    lineOrder: integer("line_order").notNull(),
    reportedLabel: text("reported_label").notNull(),
    isSubtotal: boolean("is_subtotal").notNull(),
    componentLabels: text("component_labels").array().notNull().default(sql`'{}'::text[]`),
    periodLabel: text("period_label").notNull(),
    periodEnd: date("period_end"),
    asOfDate: date("as_of_date"),
    reportedText: text("reported_text").notNull(),
    reportedValue: numeric("reported_value"),
    valueStatus: valueStatus("value_status").notNull(),
    unitLabel: text("unit_label"),
    scaleFactor: numeric("scale_factor"),
    currency: text("currency"),
    normalizedValue: numeric("normalized_value"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("financial_fact_revision_order").on(t.revisionId, t.statement, t.basis, t.lineOrder)],
);

/** Where a fact was read: a page of the original PDF. */
export const sourceReference = pgTable(
  "source_reference",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    factId: uuid("fact_id").notNull().references(() => financialFact.id),
    documentId: uuid("document_id").notNull().references(() => document.id),
    pageIndex: integer("page_index").notNull(),
    textLayerMatch: boolean("text_layer_match"),
  },
  (t) => [uniqueIndex("source_reference_fact").on(t.factId)],
);

/** One arithmetic check run during extraction. */
export const extractionCheck = pgTable(
  "extraction_check",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    revisionId: uuid("revision_id").notNull().references(() => extractionRevision.id),
    checkType: checkType("check_type").notNull(),
    statement: statementKind("statement").notNull(),
    basis: reportingBasis("basis").notNull(),
    section: text("section"),
    periodLabel: text("period_label").notNull(),
    subjectLabel: text("subject_label").notNull(),
    status: checkStatus("status").notNull(),
    expected: numeric("expected"),
    actual: numeric("actual"),
    detail: text("detail").notNull(),
  },
  (t) => [index("extraction_check_revision").on(t.revisionId)],
);

export type ExtractionRevisionRow = typeof extractionRevision.$inferSelect;
export type FinancialFactRow = typeof financialFact.$inferSelect;
export type SourceReferenceRow = typeof sourceReference.$inferSelect;
export type ExtractionCheckRow = typeof extractionCheck.$inferSelect;
