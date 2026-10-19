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
export type { ClassificationRow, EvidenceRow, StatementsFoundJson, ClassificationWarningJson } from "./schema/classification.js";
export type { WaitlistEntryRow } from "./schema/waitlist.js";
export { runMigrations, DEFAULT_MIGRATIONS_FOLDER } from "./migrate.js";
export { encodeCursor, decodeCursor, type CursorValue } from "./pagination.js";
export { listWorkspacesForUser, getWorkspaceForUser, ensurePersonalWorkspace } from "./queries/workspaces.js";
export { getDocument, listDocuments } from "./queries/documents.js";
export { getJob, getLatestJobForSubject } from "./queries/jobs.js";
export { getCompany, listCompanies } from "./queries/companies.js";
export { getLatestRevision, getRevision, listChecks, listFactsWithSources, type FactWithSource } from "./queries/extraction.js";
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
export type { BrokerConnectionRow, BrokerLoginStateRow, HoldingReadRow, HoldingLineRow, NewHoldingLine } from "./schema/brokers.js";
export {
  getBrokerConnection, listBrokerConnections, saveBrokerCredentials, forgetBrokerCredentials, saveBrokerSession, markBrokerError,
  createBrokerLoginState, takeBrokerLoginState, startHoldingRead, finishHoldingRead, latestHoldings, readStartedSince, latestCloses, type LatestHoldings,
} from "./queries/brokers.js";
