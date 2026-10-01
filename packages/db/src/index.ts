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
export { runMigrations, DEFAULT_MIGRATIONS_FOLDER } from "./migrate.js";
export { encodeCursor, decodeCursor, type CursorValue } from "./pagination.js";
export { listWorkspacesForUser, getWorkspaceForUser, ensurePersonalWorkspace } from "./queries/workspaces.js";
export { getDocument, listDocuments } from "./queries/documents.js";
export { getJob, getLatestJobForSubject } from "./queries/jobs.js";
export { getCompany, listCompanies } from "./queries/companies.js";
export { getLatestRevision, getRevision, listChecks, listFactsWithSources, type FactWithSource } from "./queries/extraction.js";
