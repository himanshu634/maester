import { FetchStatus } from "@maester/contracts";
import type { Classification, ClassificationSummary, Company, Document, DocumentPipeline, Evidence, ExtractionCheck, ExtractionRevision, FinancialFact, Job, Workspace } from "@maester/contracts";
import type {
  ClassificationRow,
  CompanyRow,
  DocumentRow,
  EvidenceRow,
  ExtractionCheckRow,
  ExtractionRevisionRow,
  FactWithSource,
  JobRow,
  MarketFetchRow,
  WorkspaceRow,
} from "@maester/db";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, name: row.name, ownerUserId: row.ownerUserId, locale: row.locale, createdAt: row.createdAt.toISOString() };
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    state: row.state,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    progress: row.progress ?? {},
    result: row.result ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDocument(row: DocumentRow, latestJob: JobRow | null, classification: ClassificationRow | null, pipeline: DocumentPipeline): Document {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.companyId,
    originalName: row.originalName,
    declaredSize: row.declaredSize,
    declaredMime: row.declaredMime,
    format: row.format,
    state: row.state,
    contentSha256: row.contentSha256,
    sizeBytes: row.sizeBytes,
    rejectionCode: (row.rejectionCode as Document["rejectionCode"]) ?? null,
    intakeState: row.intakeState,
    duplicateOfDocumentId: row.duplicateOfDocumentId,
    classification: classification ? toClassificationSummary(classification) : null,
    createdAt: row.createdAt.toISOString(),
    storedAt: iso(row.storedAt),
    latestJob: latestJob ? toJob(latestJob) : null,
    pipeline,
  };
}

export function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    displayName: row.displayName,
    country: row.country,
    cin: row.cin,
    bseCode: row.bseCode,
    nseSymbol: row.nseSymbol,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toClassification(row: ClassificationRow): Classification {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    otherType: row.otherType,
    resultsSpan: row.resultsSpan,
    periodEnd: row.periodEnd,
    periodLabel: row.periodLabel,
    companyId: row.companyId,
    companyNameAsPrinted: row.companyNameAsPrinted,
    cin: row.cin,
    bseCode: row.bseCode,
    nseSymbol: row.nseSymbol,
    isin: row.isin,
    xbrlFormat: row.xbrlFormat,
    basis: row.basis,
    statementsFound: row.statementsFound as Classification["statementsFound"],
    setBy: row.setBy,
    readsUnderId: row.readsUnderId,
    warnings: row.warnings,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toClassificationSummary(row: ClassificationRow): ClassificationSummary {
  const c = toClassification(row);
  return {
    id: c.id,
    kind: c.kind,
    otherType: c.otherType,
    resultsSpan: c.resultsSpan,
    periodLabel: c.periodLabel,
    companyId: c.companyId,
    companyNameAsPrinted: c.companyNameAsPrinted,
    setBy: c.setBy,
  };
}

export function toEvidence(row: EvidenceRow): Evidence {
  return {
    field: row.field, source: row.source, ruleId: row.ruleId, pageIndex: row.pageIndex, quote: row.quote, textLayerMatch: row.textLayerMatch,
    element: row.element, context: row.context,
  };
}

export function toRevision(row: ExtractionRevisionRow): ExtractionRevision {
  return {
    id: row.id,
    documentId: row.documentId,
    jobId: row.jobId,
    source: row.source,
    state: row.state,
    pipelineVersion: row.pipelineVersion,
    model: row.model,
    promptVersion: row.promptVersion,
    pageCount: row.pageCount,
    companyNameAsPrinted: row.companyNameAsPrinted,
    coverage: row.coverage.statements as ExtractionRevision["coverage"],
    warnings: row.warnings,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCheck(row: ExtractionCheckRow): ExtractionCheck {
  return {
    id: row.id,
    checkType: row.checkType,
    statement: row.statement,
    basis: row.basis,
    section: row.section,
    periodLabel: row.periodLabel,
    subjectLabel: row.subjectLabel,
    status: row.status,
    expected: row.expected,
    actual: row.actual,
    detail: row.detail,
  };
}

/** Where a fact was read, by the row stored with it: a page, an XBRL element, or null when neither was stored. */
export function toFactSource({ source, xbrl }: Pick<FactWithSource, "source" | "xbrl">): FinancialFact["source"] {
  if (xbrl) return { kind: "xbrl", documentId: xbrl.documentId, element: xbrl.element, contextId: xbrl.contextId, decimals: xbrl.decimals, nil: xbrl.nil };
  if (source) return { kind: "page", documentId: source.documentId, pageIndex: source.pageIndex, textLayerMatch: source.textLayerMatch };
  return null;
}

export function toFact(row: FactWithSource): FinancialFact {
  const { fact } = row;
  return {
    id: fact.id,
    revisionId: fact.revisionId,
    companyId: fact.companyId,
    statement: fact.statement,
    basis: fact.basis,
    section: fact.section,
    lineOrder: fact.lineOrder,
    reportedLabel: fact.reportedLabel,
    isSubtotal: fact.isSubtotal,
    componentLabels: fact.componentLabels,
    periodLabel: fact.periodLabel,
    periodEnd: fact.periodEnd,
    periodStart: fact.periodStart,
    span: fact.span,
    asOfDate: fact.asOfDate,
    reportedText: fact.reportedText,
    reportedValue: fact.reportedValue,
    valueStatus: fact.valueStatus,
    unitLabel: fact.unitLabel,
    scaleFactor: fact.scaleFactor,
    currency: fact.currency,
    normalizedValue: fact.normalizedValue,
    source: toFactSource(row),
  };
}

const FETCH_CODES = new Set<string>(FetchStatus.shape.errorCode.unwrap().options);

export function toFetchStatus(row: MarketFetchRow | null): FetchStatus {
  if (!row) return { state: "never", at: null, errorCode: null };
  return {
    state: row.state,
    at: (row.finishedAt ?? row.startedAt).toISOString(),
    errorCode: row.state === "failed" ? ((row.errorCode && FETCH_CODES.has(row.errorCode) ? row.errorCode : "UNKNOWN") as FetchStatus["errorCode"]) : null,
  };
}
