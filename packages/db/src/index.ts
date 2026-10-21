export { createDb, closeDb, type Db } from "./client.js";
export * as schema from "./schema/index.js";
export type { WorkspaceRow, MembershipRow, CompanyRow, DocumentRow, JobRow, JobProgressJson } from "./schema/platform.js";
export type {
  CoverageJson,
  WarningJson,
  ExtractionRevisionRow,
  FinancialFactRow,
  SourceReferenceRow,
  ExtractionCheckRow,
} from "./schema/extraction.js";
export type { XbrlSourceRow } from "./schema/xbrl.js";
export type { ClassificationRow, EvidenceRow, StatementsFoundJson, ClassificationWarningJson } from "./schema/classification.js";
export type { WaitlistEntryRow } from "./schema/waitlist.js";
export { runMigrations, DEFAULT_MIGRATIONS_FOLDER } from "./migrate.js";
export { encodeCursor, decodeCursor, type CursorValue } from "./pagination.js";
export { listWorkspacesForUser, getWorkspaceForUser, ensurePersonalWorkspace } from "./queries/workspaces.js";
export { getDocument, listDocuments } from "./queries/documents.js";
export { getJob, getLatestJobForSubject } from "./queries/jobs.js";
export { getCompany, listCompanies } from "./queries/companies.js";
export {
  getLatestRevision, getRevision, listChecks, listFactsWithSources, listXbrlPdfChecks, XBRL_PDF_CHECK_VERSION_READ, type FactWithSource,
} from "./queries/extraction.js";
export { listCompanyFilings, listFactsWithSourcesForRevisions, listChecksForRevisions, type CompanyFilingRow } from "./queries/research.js";
export { admitOrWaitlist, approveWaitlistEmail, normalizeEmail, type WaitlistSource } from "./queries/waitlist.js";
export {
  getCurrentClassification, listEvidence, getCurrentRevision, normalizeCompanyName, matchCompanies, findStoredDuplicate,
} from "./queries/classification.js";
export type { MarketPointRow, NewMarketPoint, MarketFetchRow, MarketConnectionRow, MarketConnectionProvider } from "./schema/market.js";
export {
  upsertMarketPoints, listMarketSeries, listMarketSeriesByPrefix, listMarketValuesByPrefix, latestMarketDay, startMarketFetch, finishMarketFetch, latestMarketFetch,
  getConnection, listConnections, saveConnection, deleteConnection, markConnectionError, lastMarketReads, type SaveConnection,
} from "./queries/market.js";
export type { IndexRevisionRow } from "./schema/document-index.js";
export {
  startOrResumeRevision, writeRange, lastStoredPage, chunksWithoutEmbedding, insertEmbeddings, completeRevision,
  getPageRead, putPageRead, documentsNeedingIndex, deleteModelRevisions,
  type IndexVersions, type PageInput, type ChunkInput, type RangeCounts, type PageReadKey, type RangeReadJson,
} from "./queries/document-index.js";
export { loadWorkspaceXbrlDocs, companyIdentity, companyIdentities } from "./queries/xbrl.js";
export { loadPipelineInputs, type PipelineInput, type PipelineRevision, type PipelineIndex } from "./queries/pipeline.js";
export { listFilingRows, loadXbrlFilingData, lockHeldDocuments, type XbrlFilingFact, type XbrlFilingData, type PrintedIdentity } from "./queries/filings.js";
