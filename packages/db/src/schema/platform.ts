import { sql } from "drizzle-orm";
import { bigint, type AnyPgColumn, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const membershipRole = pgEnum("membership_role", ["owner"]);
export const membershipState = pgEnum("membership_state", ["active", "revoked"]);
export const documentState = pgEnum("document_state", ["pending_upload", "uploaded", "verifying", "stored", "rejected"]);
export const jobState = pgEnum("job_state", ["queued", "running", "succeeded", "failed", "cancelled"]);

export const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const workspace = pgTable("workspace", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id),
  locale: text("locale").notNull().default("en-IN"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const membership = pgTable(
  "membership",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    userId: text("user_id").notNull().references(() => user.id),
    role: membershipRole("role").notNull(),
    state: membershipState("state").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("membership_workspace_user").on(t.workspaceId, t.userId)],
);

export const intakeState = pgEnum("intake_state", [
  "identifying", "duplicate", "needs_company", "needs_kind", "kept", "reading", "read", "identify_failed", "read_failed",
]);

export const company = pgTable(
  "company",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    displayName: text("display_name").notNull(),
    country: text("country").notNull(),
    cin: text("cin"),
    bseCode: text("bse_code"),
    nseSymbol: text("nse_symbol"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_workspace_name").on(t.workspaceId, sql`lower(${t.displayName})`),
    index("company_workspace_created").on(t.workspaceId, t.createdAt),
    uniqueIndex("company_workspace_cin").on(t.workspaceId, t.cin).where(sql`${t.cin} is not null`),
    uniqueIndex("company_workspace_bse").on(t.workspaceId, t.bseCode).where(sql`${t.bseCode} is not null`),
    uniqueIndex("company_workspace_nse").on(t.workspaceId, t.nseSymbol).where(sql`${t.nseSymbol} is not null`),
  ],
);

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    companyId: uuid("company_id").references(() => company.id),
    originalName: text("original_name").notNull(),
    declaredSize: bigint("declared_size", { mode: "number" }).notNull(),
    declaredMime: text("declared_mime").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentSha256: text("content_sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    state: documentState("state").notNull(),
    rejectionCode: text("rejection_code"),
    /** Where the document stands after it is stored; null before. */
    intakeState: intakeState("intake_state"),
    duplicateOfDocumentId: uuid("duplicate_of_document_id").references((): AnyPgColumn => document.id),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    storedAt: ts("stored_at"),
  },
  (t) => [index("document_workspace_created").on(t.workspaceId, t.createdAt)],
);

export type JobProgressJson = { stage?: string; percent?: number; message?: string };

export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    type: text("type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    state: jobState("state").notNull(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: ts("lease_expires_at"),
    progress: jsonb("progress").$type<JobProgressJson>().notNull().default({}),
    result: jsonb("result").$type<unknown>(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("job_workspace_subject").on(t.workspaceId, t.subjectType, t.subjectId),
    index("job_state_lease").on(t.state, t.leaseExpiresAt),
  ],
);

export type WorkspaceRow = typeof workspace.$inferSelect;
export type MembershipRow = typeof membership.$inferSelect;
export type CompanyRow = typeof company.$inferSelect;
export type DocumentRow = typeof document.$inferSelect;
export type JobRow = typeof job.$inferSelect;
