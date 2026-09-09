# Platform Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TypeScript backend foundation (monorepo, auth, workspaces, database, durable jobs, private uploads, SSE, deployment) that the PDF extraction pipeline will plug into as a new job type.

**Architecture:** A pnpm/Turborepo workspace with two Hono services (`apps/api`, `apps/worker`) and shared packages (`contracts` for Zod schemas, `db` for Drizzle schema and scoped queries, `storage` for a GCS object-store abstraction). The API owns auth (Better Auth), authorization (workspace membership), job creation and Cloud Tasks dispatch, and SSE. The worker leases jobs from Postgres and runs handlers; the only handler in the base is `document.verify`, which hashes an uploaded PDF in GCS.

**Tech Stack:** Node 22, TypeScript 5, pnpm 11, Turborepo, Hono 4, Better Auth 1.7, Drizzle ORM + drizzle-kit, PostgreSQL 16, Zod 4, `@google-cloud/storage`, `@google-cloud/tasks`, `google-auth-library`, pino, Vitest, tsup, Docker, Cloud Run, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-platform-base-design.md`

## Global Constraints

- Node `>=22`, pnpm `>=10` (pinned via `packageManager` in root `package.json`, `.nvmrc` = `22`).
- All TypeScript is ESM (`"type": "module"`), `strict: true`, `moduleResolution: "bundler"`, target `ES2022`.
- Workspace packages are consumed as TypeScript source (`exports` point to `./src/index.ts`). Apps are bundled with tsup for production. Tests run with Vitest against source.
- Every private table has `workspace_id`; there is no unscoped read helper for private tables in `@maester/db`.
- IDs are UUID v4 from `crypto.randomUUID()`. Timestamps are `timestamptz`, serialised as ISO 8601 UTC strings.
- Error envelope is exactly `{ "error": { "code", "message", "fields"?, "traceId" } }` with codes `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, CONFLICT, UPLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, INVALID_STATE, RATE_LIMITED, INTERNAL`.
- Upload limit `MAX_UPLOAD_BYTES = 52428800` (50 MiB); only `application/pdf`.
- Job states `queued, running, succeeded, failed, cancelled`; default `max_attempts = 5`; lease 600 s.
- Document states `pending_upload, uploaded, verifying, stored, rejected`; rejection codes `NOT_A_PDF, TOO_LARGE, OBJECT_MISSING`.
- Storage key format `workspaces/{workspaceId}/documents/{documentId}/original.pdf`.
- Never log request bodies, cookies, signed URLs or object contents.
- Python workspace (`apps/cli`, `packages/financial-engine`) is not modified.
- Local Postgres runs from `docker-compose.yml` on port `5433`; databases `maester` (dev) and `maester_test` (tests).
- Dependency ranges in the manifests below are floors verified on 2026-09-10; if `pnpm install` reports a peer-dependency conflict, raise the conflicting range to the current major and note it in the commit.
- Commit after every task with the message given in the task. Use `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the trailer.

---

## File structure

```text
package.json                      root, private, scripts, packageManager
pnpm-workspace.yaml               apps/*, packages/*
turbo.json                        lint / typecheck / test / build pipeline
.nvmrc, .npmrc                    node 22, strict peer deps off
docker-compose.yml                postgres:16 on 5433 with init script creating maester + maester_test
scripts/db/init.sql               creates the two databases
packages/config/                  @maester/config: tsconfig.base.json, eslint.config.js
packages/contracts/src/
  index.ts                        re-exports
  common.ts                       ErrorCode, ApiError, paginated(), ListQuery, DecimalString, IsoTimestamp, encode/decodeCursor types
  workspace.ts                    Workspace, Membership, Me
  document.ts                     DocumentState, RejectionCode, Document, CreateUploadRequest/Response, FinalizeResponse, DownloadResponse
  job.ts                          JobState, JobProgress, Job, JobTypes
  payloads.ts                     DocumentVerifyResult
packages/contracts/README.md      frontend integration guide
packages/db/src/
  index.ts                        re-exports
  schema/auth.ts                  user, session, account, verification (Better Auth)
  schema/platform.ts              enums, workspace, membership, document, job
  schema/index.ts                 export * from both
  client.ts                       createDb(url) -> Db, closeDb
  pagination.ts                   encodeCursor / decodeCursor
  queries/workspaces.ts           listWorkspacesForUser, getWorkspaceForUser, ensurePersonalWorkspace
  queries/documents.ts            getDocument, listDocuments
  queries/jobs.ts                 getJob, getLatestJobForSubject
  migrate.ts                      runMigrations(db, folder)
packages/db/drizzle.config.ts, drizzle/ (generated SQL)
packages/db/test/                 helpers.ts, schema.test.ts, queries.test.ts
packages/storage/src/
  index.ts                        ObjectStore interface, ObjectNotFoundError, MemoryObjectStore, GcsObjectStore
apps/api/src/
  env.ts                          loadEnv()
  logger.ts                       createLogger()
  errors.ts                       HttpError, errorBody, STATUS map
  serialize.ts                    toWorkspace, toDocument, toJob
  auth.ts                         createAuth({ db, env })
  middleware/request-id.ts        traceId
  middleware/session.ts           requireSession
  middleware/workspace.ts         requireWorkspace
  dispatch/index.ts               Dispatcher, CloudTasksDispatcher, LocalHttpDispatcher, RecordingDispatcher
  jobs/create.ts                  createJob(), retryJob()
  routes/me.ts, workspaces.ts, documents.ts, jobs.ts, job-events.ts, dev.ts
  app.ts                          createApp(deps)
  server.ts                       entry
  migrate.ts                      entry for the Cloud Run migrate job
apps/api/test/                    context.ts + one test file per route group
apps/worker/src/
  env.ts, logger.ts
  auth.ts                         verifyDispatchRequest
  lease.ts                        acquireLease, completeJob, failAttempt
  jobs/types.ts                   JobHandler, JobContext
  jobs/document-verify.ts
  jobs/index.ts                   registry
  run.ts                          runJob(deps, type, jobId) -> { status, body }
  app.ts                          createWorkerApp(deps)
  server.ts
apps/worker/test/                 context.ts, lease.test.ts, run.test.ts, document-verify.test.ts
apps/api/Dockerfile, apps/worker/Dockerfile
infra/bootstrap.sh, infra/deploy.sh
.github/workflows/ts.yml
scripts/smoke-upload.ts
docs/decisions/0002-typescript-backend.md (+ doc edits)
```

---

### Task 1: Monorepo scaffolding and local Postgres

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`, `docker-compose.yml`, `scripts/db/init.sql`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.config.js`
- Modify: `.gitignore`, `Makefile`

**Interfaces:**
- Produces: `@maester/config/tsconfig.base.json` extended by every package; `@maester/config/eslint.config.js` imported by every package's `eslint.config.js`; root scripts `pnpm lint|typecheck|test|build`.

- [ ] **Step 1: Root manifests**

`package.json`:
```json
{
  "name": "maester-platform-ts",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.2.2",
  "engines": { "node": ">=22", "pnpm": ">=10" },
  "scripts": {
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "build": "turbo run build",
    "dev:api": "pnpm --filter @maester/api dev",
    "dev:worker": "pnpm --filter @maester/worker dev",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.9.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "lint": {},
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["^typecheck"], "env": ["DATABASE_URL_TEST"] },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] }
  }
}
```

`.nvmrc`: `22`

`.npmrc`:
```ini
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 2: Shared config package**

`packages/config/package.json`:
```json
{
  "name": "@maester/config",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "files": ["tsconfig.base.json", "eslint.config.js"],
  "dependencies": {
    "@eslint/js": "^9.30.0",
    "eslint": "^9.30.0",
    "typescript-eslint": "^8.40.0"
  }
}
```

`packages/config/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

`packages/config/eslint.config.js`:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "drizzle/**"],
  },
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
```

- [ ] **Step 3: Local Postgres**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: maester
      POSTGRES_PASSWORD: maester
      POSTGRES_DB: maester
    ports:
      - "5433:5432"
    volumes:
      - ./scripts/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U maester"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes:
  pgdata:
```

`scripts/db/init.sql`:
```sql
CREATE DATABASE maester_test OWNER maester;
```

- [ ] **Step 4: gitignore and Makefile**

Append to `.gitignore`:
```gitignore
node_modules/
dist/
.turbo/
*.tsbuildinfo
.env.test
```

Append to `Makefile` (keep existing targets):
```makefile
.PHONY: ts-install ts-check ts-test ts-dev-api ts-dev-worker db-up db-down

ts-install:
	pnpm install --frozen-lockfile

ts-check:
	pnpm lint && pnpm typecheck

ts-test:
	pnpm test

ts-dev-api:
	pnpm dev:api

ts-dev-worker:
	pnpm dev:worker

db-up:
	docker compose up -d postgres

db-down:
	docker compose down
```

- [ ] **Step 5: Install and verify**

Run:
```bash
pnpm install
docker compose up -d postgres
docker compose exec postgres psql -U maester -d maester_test -c "select 1"
pnpm turbo run typecheck
```
Expected: install succeeds, `select 1` returns a row, turbo reports no tasks (no packages define `typecheck` yet) and exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .nvmrc .npmrc docker-compose.yml scripts/db/init.sql packages/config .gitignore Makefile
git commit -m "chore: pnpm/turbo workspace, shared config, local postgres"
```

---

### Task 2: Contracts package

**Files:**
- Create: `packages/contracts/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- Create: `packages/contracts/src/{index,common,workspace,document,job,payloads}.ts`
- Test: `packages/contracts/test/schemas.test.ts`

**Interfaces:**
- Produces (all from `@maester/contracts`):
  - `ErrorCode` (zod enum) and type `ErrorCode`; `ApiError` schema and type; `FieldError` type `{ path: string; message: string }`.
  - `IsoTimestamp`, `DecimalString`, `ListQuery` (`{ cursor?: string; limit: number }`), `paginated(item)`.
  - `Workspace`, `Membership`, `Me` schemas/types.
  - `DocumentState`, `RejectionCode`, `Document`, `CreateUploadRequest`, `CreateUploadResponse`, `FinalizeResponse`, `DownloadResponse`.
  - `JobState`, `JobProgress`, `Job`, `JobTypes` (`{ DOCUMENT_VERIFY: "document.verify" }`), `JobType`.
  - `DocumentVerifyResult`.

- [ ] **Step 1: Package manifest and configs**

`packages/contracts/package.json`:
```json
{
  "name": "@maester/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.1.0" },
  "devDependencies": {
    "@maester/config": "workspace:*",
    "@types/node": "^22.0.0",
    "eslint": "^9.30.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{ "extends": "@maester/config/tsconfig.base.json", "include": ["src", "test"] }
```

`packages/contracts/eslint.config.js`:
```js
export { default } from "@maester/config/eslint.config.js";
```

`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: Write the failing schema tests**

`packages/contracts/test/schemas.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  ApiError,
  CreateUploadRequest,
  DecimalString,
  Document,
  Job,
  JobTypes,
  ListQuery,
  paginated,
} from "../src/index.js";

describe("common", () => {
  it("accepts a valid error envelope", () => {
    const parsed = ApiError.parse({
      error: { code: "VALIDATION_FAILED", message: "bad", fields: [{ path: "size", message: "too big" }], traceId: "t1" },
    });
    expect(parsed.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an unknown error code", () => {
    expect(() => ApiError.parse({ error: { code: "NOPE", message: "x", traceId: "t" } })).toThrow();
  });

  it("DecimalString accepts plain decimals only", () => {
    expect(DecimalString.parse("2217.00")).toBe("2217.00");
    expect(DecimalString.parse("-5")).toBe("-5");
    expect(() => DecimalString.parse("1e3")).toThrow();
    expect(() => DecimalString.parse("NaN")).toThrow();
  });

  it("ListQuery defaults limit to 25 and caps at 100", () => {
    expect(ListQuery.parse({}).limit).toBe(25);
    expect(() => ListQuery.parse({ limit: "101" })).toThrow();
    expect(ListQuery.parse({ limit: "10" }).limit).toBe(10);
  });

  it("paginated wraps items with nextCursor", () => {
    const P = paginated(Document);
    const r = P.parse({ items: [], nextCursor: null });
    expect(r.nextCursor).toBeNull();
  });
});

describe("document", () => {
  it("CreateUploadRequest only allows PDF and positive size", () => {
    expect(CreateUploadRequest.parse({ originalName: "a.pdf", size: 10, mimeType: "application/pdf" }).size).toBe(10);
    expect(() => CreateUploadRequest.parse({ originalName: "a.png", size: 10, mimeType: "image/png" })).toThrow();
    expect(() => CreateUploadRequest.parse({ originalName: "a.pdf", size: 0, mimeType: "application/pdf" })).toThrow();
  });
});

describe("job", () => {
  it("Job round-trips", () => {
    const j = Job.parse({
      id: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10",
      workspaceId: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f11",
      type: JobTypes.DOCUMENT_VERIFY,
      subjectType: "document",
      subjectId: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f12",
      state: "queued",
      attempt: 0,
      maxAttempts: 5,
      progress: {},
      result: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-09-10T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
    expect(j.state).toBe("queued");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @maester/contracts test`
Expected: FAIL, cannot resolve `../src/index.js`.

- [ ] **Step 4: Implement schemas**

`packages/contracts/src/common.ts`:
```ts
import { z } from "zod";

export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "UPLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INVALID_STATE",
  "RATE_LIMITED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const FieldError = z.object({ path: z.string(), message: z.string() });
export type FieldError = z.infer<typeof FieldError>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    fields: z.array(FieldError).optional(),
    traceId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const IsoTimestamp = z.iso.datetime({ offset: true });
export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string");
export const Uuid = z.uuid();

export const ListQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof ListQuery>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
```

`packages/contracts/src/workspace.ts`:
```ts
import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";

export const MembershipRole = z.enum(["owner"]);
export const MembershipState = z.enum(["active", "revoked"]);

export const Workspace = z.object({
  id: Uuid,
  name: z.string(),
  ownerUserId: z.string(),
  locale: z.string(),
  createdAt: IsoTimestamp,
});
export type Workspace = z.infer<typeof Workspace>;

export const Membership = z.object({
  id: Uuid,
  workspaceId: Uuid,
  userId: z.string(),
  role: MembershipRole,
  state: MembershipState,
});
export type Membership = z.infer<typeof Membership>;

export const Me = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  workspaces: z.array(Workspace),
});
export type Me = z.infer<typeof Me>;
```

`packages/contracts/src/job.ts`:
```ts
import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";

export const JobTypes = { DOCUMENT_VERIFY: "document.verify" } as const;
export type JobType = (typeof JobTypes)[keyof typeof JobTypes];

export const JobState = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobState = z.infer<typeof JobState>;

export const JobProgress = z.object({
  stage: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgress>;

export const Job = z.object({
  id: Uuid,
  workspaceId: Uuid,
  type: z.string(),
  subjectType: z.string(),
  subjectId: Uuid,
  state: JobState,
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  progress: JobProgress,
  result: z.unknown().nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  createdAt: IsoTimestamp,
  startedAt: IsoTimestamp.nullable(),
  finishedAt: IsoTimestamp.nullable(),
  updatedAt: IsoTimestamp,
});
export type Job = z.infer<typeof Job>;
```

`packages/contracts/src/document.ts`:
```ts
import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";
import { Job } from "./job.js";

export const DocumentState = z.enum(["pending_upload", "uploaded", "verifying", "stored", "rejected"]);
export type DocumentState = z.infer<typeof DocumentState>;

export const RejectionCode = z.enum(["NOT_A_PDF", "TOO_LARGE", "OBJECT_MISSING"]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const Document = z.object({
  id: Uuid,
  workspaceId: Uuid,
  originalName: z.string(),
  declaredSize: z.number().int(),
  declaredMime: z.string(),
  state: DocumentState,
  contentSha256: z.string().length(64).nullable(),
  sizeBytes: z.number().int().nullable(),
  rejectionCode: RejectionCode.nullable(),
  createdAt: IsoTimestamp,
  storedAt: IsoTimestamp.nullable(),
  latestJob: Job.nullable(),
});
export type Document = z.infer<typeof Document>;

export const CreateUploadRequest = z.object({
  originalName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.literal("application/pdf"),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export const CreateUploadResponse = z.object({
  document: Document,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: IsoTimestamp,
  }),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

export const FinalizeResponse = z.object({ document: Document, job: Job });
export type FinalizeResponse = z.infer<typeof FinalizeResponse>;

export const DownloadResponse = z.object({ url: z.string(), expiresAt: IsoTimestamp });
export type DownloadResponse = z.infer<typeof DownloadResponse>;
```

`packages/contracts/src/payloads.ts`:
```ts
import { z } from "zod";
import { RejectionCode } from "./document.js";

export const DocumentVerifyResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("stored"), sha256: z.string().length(64), sizeBytes: z.number().int() }),
  z.object({ outcome: z.literal("rejected"), code: RejectionCode }),
]);
export type DocumentVerifyResult = z.infer<typeof DocumentVerifyResult>;
```

`packages/contracts/src/index.ts`:
```ts
export * from "./common.js";
export * from "./workspace.js";
export * from "./job.js";
export * from "./document.js";
export * from "./payloads.js";
```

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm install && pnpm --filter @maester/contracts test && pnpm --filter @maester/contracts lint && pnpm --filter @maester/contracts typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): zod schemas for errors, workspaces, documents, jobs"
```

---

### Task 3: Database package (schema, migrations, scoped queries)

**Files:**
- Create: `packages/db/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `drizzle.config.ts`
- Create: `packages/db/src/{index,client,pagination,migrate}.ts`, `packages/db/src/schema/{auth,platform,index}.ts`, `packages/db/src/queries/{workspaces,documents,jobs}.ts`
- Create (generated): `packages/db/drizzle/0000_*.sql` and `packages/db/drizzle/meta/*`
- Test: `packages/db/test/helpers.ts`, `packages/db/test/migrate.test.ts`, `packages/db/test/queries.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (from `@maester/db`):
  - `createDb(url: string): Db`, `closeDb(db: Db): Promise<void>`, type `Db`.
  - `schema` namespace: tables `user, session, account, verification, workspace, membership, document, job`; enums `membershipRole, membershipState, documentState, jobState`.
  - Row types `WorkspaceRow, MembershipRow, DocumentRow, JobRow` (`typeof table.$inferSelect`).
  - `runMigrations(db, folder?: string): Promise<void>`.
  - `encodeCursor({ createdAt: Date; id: string }): string`, `decodeCursor(s: string): { createdAt: Date; id: string } | null`.
  - `listWorkspacesForUser(db, userId): Promise<WorkspaceRow[]>`, `getWorkspaceForUser(db, userId, workspaceId): Promise<{ workspace: WorkspaceRow; membership: MembershipRow } | null>`, `ensurePersonalWorkspace(db, { userId, userName }): Promise<WorkspaceRow>`.
  - `getDocument(db, workspaceId, id): Promise<DocumentRow | null>`, `listDocuments(db, workspaceId, { cursor?, limit }): Promise<{ items: DocumentRow[]; nextCursor: string | null }>`.
  - `getJob(db, workspaceId, id): Promise<JobRow | null>`, `getLatestJobForSubject(db, workspaceId, subjectType, subjectId): Promise<JobRow | null>`.

- [ ] **Step 1: Manifest and configs**

`packages/db/package.json`:
```json
{
  "name": "@maester/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "generate": "drizzle-kit generate",
    "migrate": "tsx src/migrate-cli.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "pg": "^8.16.0"
  },
  "devDependencies": {
    "@maester/config": "workspace:*",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.15.0",
    "drizzle-kit": "^0.31.0",
    "eslint": "^9.30.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`packages/db/tsconfig.json`:
```json
{ "extends": "@maester/config/tsconfig.base.json", "include": ["src", "test", "drizzle.config.ts"] }
```

`packages/db/eslint.config.js`:
```js
export { default } from "@maester/config/eslint.config.js";
```

`packages/db/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 20000 },
});
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://maester:maester@localhost:5433/maester" },
});
```

- [ ] **Step 2: Schema files**

`packages/db/src/schema/auth.ts` (Better Auth core tables; column names snake_case, JS keys are the Better Auth field names):
```ts
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/schema/platform.ts`:
```ts
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const membershipRole = pgEnum("membership_role", ["owner"]);
export const membershipState = pgEnum("membership_state", ["active", "revoked"]);
export const documentState = pgEnum("document_state", ["pending_upload", "uploaded", "verifying", "stored", "rejected"]);
export const jobState = pgEnum("job_state", ["queued", "running", "succeeded", "failed", "cancelled"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });

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

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    originalName: text("original_name").notNull(),
    declaredSize: bigint("declared_size", { mode: "number" }).notNull(),
    declaredMime: text("declared_mime").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentSha256: text("content_sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    state: documentState("state").notNull(),
    rejectionCode: text("rejection_code"),
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
export type DocumentRow = typeof document.$inferSelect;
export type JobRow = typeof job.$inferSelect;
```

`packages/db/src/schema/index.ts`:
```ts
export * from "./auth.js";
export * from "./platform.js";
```

- [ ] **Step 3: Client, migrate, pagination**

`packages/db/src/client.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return drizzle(pool, { schema });
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
```

`packages/db/src/migrate.ts`:
```ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = resolve(here, "../drizzle");

export async function runMigrations(db: Db, folder = DEFAULT_MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
```

`packages/db/src/migrate-cli.ts`:
```ts
import { createDb, closeDb } from "./client.js";
import { runMigrations } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDb(url);
await runMigrations(db, process.env.MIGRATIONS_FOLDER);
await closeDb(db);
console.log("migrations applied");
```

`packages/db/src/pagination.ts`:
```ts
export type CursorValue = { createdAt: Date; id: string };

export function encodeCursor(v: CursorValue): string {
  return Buffer.from(JSON.stringify({ c: v.createdAt.toISOString(), i: v.id })).toString("base64url");
}

export function decodeCursor(s: string): CursorValue | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string") return null;
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Generate the initial migration**

Run:
```bash
pnpm install
pnpm --filter @maester/db generate
ls packages/db/drizzle
```
Expected: one `0000_<name>.sql` plus `meta/_journal.json` and `meta/0000_snapshot.json`. Open the SQL and confirm it creates the four enums and eight tables.

- [ ] **Step 5: Write failing tests for migrations and scoped queries**

`packages/db/test/helpers.ts`:
```ts
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import * as schema from "../src/schema/index.js";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgres://maester:maester@localhost:5433/maester_test";

export async function testDb(): Promise<Db> {
  const db = createDb(TEST_DATABASE_URL);
  await runMigrations(db);
  await truncateAll(db);
  return db;
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user" CASCADE`);
}

export async function insertUser(db: Db, id: string, email: string) {
  await db.insert(schema.user).values({ id, name: "Test " + id, email });
}
```

`packages/db/test/migrate.test.ts`:
```ts
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import { testDb } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));

it("creates all base tables", async () => {
  const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
  const names = res.rows.map((r) => r.table_name);
  for (const t of ["user", "session", "account", "verification", "workspace", "membership", "document", "job"]) {
    expect(names).toContain(t);
  }
});

it("is idempotent", async () => {
  const { runMigrations } = await import("../src/migrate.js");
  await expect(runMigrations(db)).resolves.toBeUndefined();
});
```

`packages/db/test/queries.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { ensurePersonalWorkspace, getWorkspaceForUser, listWorkspacesForUser } from "../src/queries/workspaces.js";
import { getDocument, listDocuments } from "../src/queries/documents.js";
import { getJob, getLatestJobForSubject } from "../src/queries/jobs.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function seedDoc(workspaceId: string, userId: string, name: string, createdAt: Date) {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId, originalName: name, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "pending_upload",
    createdByUserId: userId, createdAt, updatedAt: createdAt,
  });
  return id;
}

describe("workspaces", () => {
  it("ensurePersonalWorkspace creates once and is idempotent", async () => {
    await insertUser(db, "u1", "u1@example.com");
    const w1 = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
    const w2 = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
    expect(w1.id).toBe(w2.id);
    expect(w1.name).toBe("Ada's workspace");
    const list = await listWorkspacesForUser(db, "u1");
    expect(list).toHaveLength(1);
    const found = await getWorkspaceForUser(db, "u1", w1.id);
    expect(found?.membership.role).toBe("owner");
  });

  it("getWorkspaceForUser returns null for a non-member", async () => {
    await insertUser(db, "u1", "u1@example.com");
    await insertUser(db, "u2", "u2@example.com");
    const w = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
    expect(await getWorkspaceForUser(db, "u2", w.id)).toBeNull();
  });
});

describe("documents", () => {
  it("scoped get and cursor list never cross workspaces", async () => {
    await insertUser(db, "u1", "u1@example.com");
    await insertUser(db, "u2", "u2@example.com");
    const wa = await ensurePersonalWorkspace(db, { userId: "u1", userName: "A" });
    const wb = await ensurePersonalWorkspace(db, { userId: "u2", userName: "B" });
    const base = Date.now();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await seedDoc(wa.id, "u1", `a${i}.pdf`, new Date(base + i * 1000)));
    const foreign = await seedDoc(wb.id, "u2", "b.pdf", new Date(base));

    expect(await getDocument(db, wa.id, foreign)).toBeNull();
    expect((await getDocument(db, wa.id, ids[0]!))?.originalName).toBe("a0.pdf");

    const page1 = await listDocuments(db, wa.id, { limit: 2 });
    expect(page1.items.map((d) => d.originalName)).toEqual(["a2.pdf", "a1.pdf"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listDocuments(db, wa.id, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((d) => d.originalName)).toEqual(["a0.pdf"]);
    expect(page2.nextCursor).toBeNull();
  });
});

describe("jobs", () => {
  it("getJob is scoped and latest job for subject picks newest", async () => {
    await insertUser(db, "u1", "u1@example.com");
    const w = await ensurePersonalWorkspace(db, { userId: "u1", userName: "A" });
    const docId = await seedDoc(w.id, "u1", "a.pdf", new Date());
    const mk = async (key: string, createdAt: Date) => {
      const id = crypto.randomUUID();
      await db.insert(schema.job).values({ id, workspaceId: w.id, type: "document.verify", subjectType: "document", subjectId: docId, idempotencyKey: key, state: "queued", createdAt, updatedAt: createdAt });
      return id;
    };
    const j1 = await mk("k1", new Date(Date.now() - 5000));
    const j2 = await mk("k2", new Date());
    expect((await getJob(db, w.id, j1))?.id).toBe(j1);
    expect(await getJob(db, crypto.randomUUID(), j1)).toBeNull();
    expect((await getLatestJobForSubject(db, w.id, "document", docId))?.id).toBe(j2);
  });
});
```

- [ ] **Step 6: Run tests to verify failure**

Run: `pnpm --filter @maester/db test`
Expected: `migrate.test.ts` passes; `queries.test.ts` fails with missing modules `../src/queries/...`.

- [ ] **Step 7: Implement queries**

`packages/db/src/queries/workspaces.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { membership, workspace, type MembershipRow, type WorkspaceRow } from "../schema/platform.js";

export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceRow[]> {
  const rows = await db
    .select({ workspace })
    .from(membership)
    .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
    .where(and(eq(membership.userId, userId), eq(membership.state, "active")))
    .orderBy(workspace.createdAt);
  return rows.map((r) => r.workspace);
}

export async function getWorkspaceForUser(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<{ workspace: WorkspaceRow; membership: MembershipRow } | null> {
  const rows = await db
    .select({ workspace, membership })
    .from(membership)
    .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
    .where(and(eq(membership.userId, userId), eq(membership.workspaceId, workspaceId), eq(membership.state, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensurePersonalWorkspace(
  db: Db,
  input: { userId: string; userName: string },
): Promise<WorkspaceRow> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ workspace })
      .from(membership)
      .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
      .where(and(eq(membership.userId, input.userId), eq(membership.role, "owner")))
      .limit(1);
    if (existing[0]) return existing[0].workspace;

    const [created] = await tx
      .insert(workspace)
      .values({ id: crypto.randomUUID(), name: `${input.userName}'s workspace`, ownerUserId: input.userId })
      .returning();
    await tx.insert(membership).values({
      id: crypto.randomUUID(),
      workspaceId: created!.id,
      userId: input.userId,
      role: "owner",
      state: "active",
    });
    return created!;
  });
}
```

`packages/db/src/queries/documents.ts`:
```ts
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { decodeCursor, encodeCursor } from "../pagination.js";
import { document, type DocumentRow } from "../schema/platform.js";

export async function getDocument(db: Db, workspaceId: string, id: string): Promise<DocumentRow | null> {
  const rows = await db.select().from(document).where(and(eq(document.workspaceId, workspaceId), eq(document.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listDocuments(
  db: Db,
  workspaceId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: DocumentRow[]; nextCursor: string | null }> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const where = cursor
    ? and(
        eq(document.workspaceId, workspaceId),
        or(lt(document.createdAt, cursor.createdAt), and(eq(document.createdAt, cursor.createdAt), lt(document.id, cursor.id))),
      )
    : eq(document.workspaceId, workspaceId);
  const rows = await db
    .select()
    .from(document)
    .where(where)
    .orderBy(desc(document.createdAt), desc(document.id))
    .limit(opts.limit + 1);
  const items = rows.slice(0, opts.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > opts.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { items, nextCursor };
}

export const documentUpdatedNow = sql`now()`;
```

`packages/db/src/queries/jobs.ts`:
```ts
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { job, type JobRow } from "../schema/platform.js";

export async function getJob(db: Db, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await db.select().from(job).where(and(eq(job.workspaceId, workspaceId), eq(job.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function getLatestJobForSubject(
  db: Db,
  workspaceId: string,
  subjectType: string,
  subjectId: string,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.workspaceId, workspaceId), eq(job.subjectType, subjectType), eq(job.subjectId, subjectId)))
    .orderBy(desc(job.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
```

`packages/db/src/index.ts`:
```ts
export { createDb, closeDb, type Db } from "./client.js";
export * as schema from "./schema/index.js";
export type { WorkspaceRow, MembershipRow, DocumentRow, JobRow, JobProgressJson } from "./schema/platform.js";
export { runMigrations, DEFAULT_MIGRATIONS_FOLDER } from "./migrate.js";
export { encodeCursor, decodeCursor, type CursorValue } from "./pagination.js";
export { listWorkspacesForUser, getWorkspaceForUser, ensurePersonalWorkspace } from "./queries/workspaces.js";
export { getDocument, listDocuments } from "./queries/documents.js";
export { getJob, getLatestJobForSubject } from "./queries/jobs.js";
```

- [ ] **Step 8: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/db test && pnpm --filter @maester/db lint && pnpm --filter @maester/db typecheck`
Expected: all PASS. If lint flags `documentUpdatedNow` as unused, delete that export.

- [ ] **Step 9: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): drizzle schema, migrations, workspace-scoped queries"
```

---

### Task 4: Storage package (ObjectStore abstraction)

**Files:**
- Create: `packages/storage/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- Create: `packages/storage/src/index.ts`, `packages/storage/src/memory.ts`, `packages/storage/src/gcs.ts`
- Test: `packages/storage/test/memory.test.ts`

**Interfaces:**
- Produces (from `@maester/storage`):
```ts
export interface SignedUpload { url: string; headers: Record<string, string>; expiresAt: Date }
export interface SignedDownload { url: string; expiresAt: Date }
export interface ObjectStore {
  signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload>;
  signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload>;
  exists(key: string): Promise<boolean>;
  readStream(key: string): Promise<Readable>;   // rejects with ObjectNotFoundError
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
export class ObjectNotFoundError extends Error { key: string }
export class MemoryObjectStore implements ObjectStore { objects: Map<string, { bytes: Uint8Array; contentType: string }> }
export class GcsObjectStore implements ObjectStore { constructor(bucketName: string) }
```

- [ ] **Step 1: Manifest and configs**

`packages/storage/package.json`:
```json
{
  "name": "@maester/storage",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "lint": "eslint .", "typecheck": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@google-cloud/storage": "^8.0.0" },
  "devDependencies": {
    "@maester/config": "workspace:*",
    "@types/node": "^22.0.0",
    "eslint": "^9.30.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```
`tsconfig.json`, `eslint.config.js`, `vitest.config.ts`: identical to the contracts package.

- [ ] **Step 2: Failing test for the memory store**

`packages/storage/test/memory.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MemoryObjectStore, ObjectNotFoundError } from "../src/index.js";

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

describe("MemoryObjectStore", () => {
  it("put / exists / readStream round trip", async () => {
    const store = new MemoryObjectStore();
    expect(await store.exists("k")).toBe(false);
    await store.put("k", new TextEncoder().encode("%PDF-1.4 hello"), "application/pdf");
    expect(await store.exists("k")).toBe(true);
    expect((await readAll(await store.readStream("k"))).toString()).toBe("%PDF-1.4 hello");
  });

  it("readStream rejects with ObjectNotFoundError", async () => {
    const store = new MemoryObjectStore();
    await expect(store.readStream("missing")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("signUpload returns a memory URL with required headers and expiry", async () => {
    const store = new MemoryObjectStore();
    const s = await store.signUpload("k", { contentType: "application/pdf", contentLength: 5, expiresInSeconds: 60 });
    expect(s.url).toBe("memory://upload/k");
    expect(s.headers["Content-Type"]).toBe("application/pdf");
    expect(s.headers["Content-Length"]).toBe("5");
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @maester/storage test`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`packages/storage/src/index.ts`:
```ts
import type { Readable } from "node:stream";

export interface SignedUpload { url: string; headers: Record<string, string>; expiresAt: Date }
export interface SignedDownload { url: string; expiresAt: Date }

export interface ObjectStore {
  signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload>;
  signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload>;
  exists(key: string): Promise<boolean>;
  readStream(key: string): Promise<Readable>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export { MemoryObjectStore } from "./memory.js";
export { GcsObjectStore } from "./gcs.js";
```

`packages/storage/src/memory.ts`:
```ts
import { Readable } from "node:stream";
import { ObjectNotFoundError, type ObjectStore, type SignedDownload, type SignedUpload } from "./index.js";

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload> {
    return {
      url: `memory://upload/${key}`,
      headers: { "Content-Type": opts.contentType, "Content-Length": String(opts.contentLength) },
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload> {
    return { url: `memory://download/${key}`, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000) };
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async readStream(key: string): Promise<Readable> {
    const obj = this.objects.get(key);
    if (!obj) throw new ObjectNotFoundError(key);
    return Readable.from([Buffer.from(obj.bytes)]);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
  }
}
```

`packages/storage/src/gcs.ts`:
```ts
import type { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import { ObjectNotFoundError, type ObjectStore, type SignedDownload, type SignedUpload } from "./index.js";

export class GcsObjectStore implements ObjectStore {
  private readonly storage = new Storage();
  constructor(private readonly bucketName: string) {}

  private file(key: string) {
    return this.storage.bucket(this.bucketName).file(key);
  }

  async signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload> {
    const expires = Date.now() + opts.expiresInSeconds * 1000;
    const [url] = await this.file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType: opts.contentType,
      extensionHeaders: { "content-length": String(opts.contentLength) },
    });
    return {
      url,
      headers: { "Content-Type": opts.contentType, "Content-Length": String(opts.contentLength) },
      expiresAt: new Date(expires),
    };
  }

  async signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload> {
    const expires = Date.now() + opts.expiresInSeconds * 1000;
    const [url] = await this.file(key).getSignedUrl({ version: "v4", action: "read", expires });
    return { url, expiresAt: new Date(expires) };
  }

  async exists(key: string): Promise<boolean> {
    const [exists] = await this.file(key).exists();
    return exists;
  }

  async readStream(key: string): Promise<Readable> {
    if (!(await this.exists(key))) throw new ObjectNotFoundError(key);
    return this.file(key).createReadStream();
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.file(key).save(Buffer.from(bytes), { contentType, resumable: false });
  }
}
```

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/storage test && pnpm --filter @maester/storage lint && pnpm --filter @maester/storage typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/storage pnpm-lock.yaml
git commit -m "feat(storage): ObjectStore interface with GCS and in-memory implementations"
```

---

### Task 5: API skeleton (env, logger, errors, request IDs, health, CORS)

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `tsup.config.ts`
- Create: `apps/api/src/{env,logger,errors,app,server}.ts`, `apps/api/src/middleware/request-id.ts`
- Test: `apps/api/test/env.ts`, `apps/api/test/skeleton.test.ts`

**Interfaces:**
- Produces:
  - `loadEnv(source?: NodeJS.ProcessEnv): Env` and type `Env` (fields listed in Step 3).
  - `createLogger(level: string): Logger` (pino) and `silentLogger`.
  - `class HttpError extends Error { code: ErrorCode; status: number; fields?: FieldError[] }`, `errorBody(code, message, traceId, fields?)`, `STATUS: Record<ErrorCode, number>`.
  - `type AppDeps = { db: Db; auth: Auth; store: ObjectStore; dispatcher: Dispatcher; env: Env; logger: Logger }` — in this task `auth` and `dispatcher` are typed as `unknown` placeholders and replaced in Tasks 6 and 7.
  - `createApp(deps: AppDeps): Hono<AppEnv>` where `AppEnv = { Variables: { traceId: string; user: User; session: Session; workspace: WorkspaceRow; membership: MembershipRow } }`.
  - Middleware `requestId` sets `traceId` variable and `x-request-id` response header.

- [ ] **Step 1: Manifest and configs**

`apps/api/package.json`:
```json
{
  "name": "@maester/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup",
    "start": "node dist/server.js",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@google-cloud/tasks": "^7.1.0",
    "@hono/node-server": "^2.1.0",
    "@hono/zod-validator": "^0.9.0",
    "@maester/contracts": "workspace:*",
    "@maester/db": "workspace:*",
    "@maester/storage": "workspace:*",
    "better-auth": "^1.7.0",
    "drizzle-orm": "^0.44.0",
    "hono": "^4.13.0",
    "pino": "^10.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@maester/config": "workspace:*",
    "@types/node": "^22.0.0",
    "eslint": "^9.30.0",
    "tsup": "^8.5.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{ "extends": "@maester/config/tsconfig.base.json", "include": ["src", "test", "tsup.config.ts"] }
```

`apps/api/eslint.config.js`: `export { default } from "@maester/config/eslint.config.js";`

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 30000 },
});
```

`apps/api/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: { server: "src/server.ts", migrate: "src/migrate.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: [/^@maester\//],
});
```

- [ ] **Step 2: Failing skeleton test**

`apps/api/test/env.ts`:
```ts
import { loadEnv, type Env } from "../src/env.js";

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? "postgres://maester:maester@localhost:5433/maester_test",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
    BETTER_AUTH_URL: "http://localhost",
    ALLOWED_ORIGINS: "http://localhost,http://localhost:5173",
    GCS_BUCKET: "test-bucket",
    GOOGLE_CLOUD_PROJECT: "test-project",
    DISPATCH_MODE: "local",
    WORKER_URL: "http://localhost:8788",
    DISPATCH_SECRET: "local-dispatch-secret",
    ...overrides,
  });
}
```

`apps/api/test/skeleton.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

function app() {
  return createApp({ env: testEnv(), logger: silentLogger, db: null as never, auth: null as never, store: null as never, dispatcher: null as never });
}

describe("skeleton", () => {
  it("GET /healthz returns ok and echoes x-request-id", async () => {
    const res = await app().request("/healthz", { headers: { "x-request-id": "abc-123" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });

  it("generates a trace id when none is supplied", async () => {
    const res = await app().request("/healthz");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("unknown route returns the NOT_FOUND envelope", async () => {
    const res = await app().request("/nope");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.traceId).toBe("string");
  });

  it("CORS allows configured origins with credentials", async () => {
    const res = await app().request("/healthz", { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("CORS rejects other origins", async () => {
    const res = await app().request("/healthz", { headers: { origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @maester/api test`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement env, logger, errors, request-id, app, server**

`apps/api/src/env.ts`:
```ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  GCS_BUCKET: z.string().min(1),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().default("asia-south1"),
  DISPATCH_MODE: z.enum(["local", "cloud-tasks"]).default("local"),
  WORKER_URL: z.url(),
  DISPATCH_SECRET: z.string().optional(),
  CLOUD_TASKS_QUEUE: z.string().default("maester-jobs"),
  WORKER_INVOKER_SA: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(52428800),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(300),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  if (parsed.data.DISPATCH_MODE === "local" && !parsed.data.DISPATCH_SECRET) {
    throw new Error("invalid environment: DISPATCH_SECRET is required when DISPATCH_MODE=local");
  }
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.WORKER_INVOKER_SA) {
    throw new Error("invalid environment: WORKER_INVOKER_SA is required when DISPATCH_MODE=cloud-tasks");
  }
  return parsed.data;
}
```

`apps/api/src/logger.ts`:
```ts
import pino, { type Logger } from "pino";

const SEVERITY: Record<string, string> = {
  trace: "DEBUG", debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR", fatal: "CRITICAL",
};

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    messageKey: "message",
    formatters: { level: (label) => ({ severity: SEVERITY[label] ?? "DEFAULT" }) },
    redact: { paths: ["req.headers.cookie", "req.headers.authorization"], censor: "[redacted]" },
  });
}

export const silentLogger: Logger = pino({ level: "silent" });
```

`apps/api/src/errors.ts`:
```ts
import type { ErrorCode, FieldError } from "@maester/contracts";

export const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  UPLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class HttpError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
    this.name = "HttpError";
    this.status = STATUS[code];
  }
}

export function errorBody(code: ErrorCode, message: string, traceId: string, fields?: FieldError[]) {
  return { error: { code, message, ...(fields && fields.length ? { fields } : {}), traceId } };
}
```

`apps/api/src/middleware/request-id.ts`:
```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.js";

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const traceId = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  c.set("traceId", traceId);
  await next();
  c.header("x-request-id", traceId);
});
```

`apps/api/src/app.ts`:
```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db, MembershipRow, WorkspaceRow } from "@maester/db";
import type { ObjectStore } from "@maester/storage";
import type { Env } from "./env.js";
import { errorBody, HttpError } from "./errors.js";
import type { Logger } from "./logger.js";
import { requestId } from "./middleware/request-id.js";

export type AppEnv = {
  Variables: {
    traceId: string;
    user: { id: string; name: string; email: string };
    session: { id: string; userId: string };
    workspace: WorkspaceRow;
    membership: MembershipRow;
  };
};

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Db;
  auth: unknown;
  store: ObjectStore;
  dispatcher: unknown;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const allowed = new Set(deps.env.ALLOWED_ORIGINS);

  app.use("*", requestId);
  app.use(
    "*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : ""),
      credentials: true,
      allowHeaders: ["Content-Type", "x-request-id"],
      exposeHeaders: ["x-request-id"],
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.notFound((c) => c.json(errorBody("NOT_FOUND", "route not found", c.get("traceId")), 404));

  app.onError((err, c) => {
    const traceId = c.get("traceId") ?? "unknown";
    if (err instanceof HttpError) {
      return c.json(errorBody(err.code, err.message, traceId, err.fields), err.status as 400);
    }
    deps.logger.error({ traceId, err: { name: err.name, message: err.message, stack: err.stack } }, "unhandled error");
    return c.json(errorBody("INTERNAL", "internal error", traceId), 500);
  });

  return app;
}
```

`apps/api/src/server.ts`:
```ts
import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { GcsObjectStore } from "@maester/storage";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const store = new GcsObjectStore(env.GCS_BUCKET);

const app = createApp({ env, logger, db, store, auth: null, dispatcher: null });

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});
```

`apps/api/src/migrate.ts`:
```ts
import { closeDb, createDb, runMigrations } from "@maester/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDb(url);
await runMigrations(db, process.env.MIGRATIONS_FOLDER);
await closeDb(db);
console.log("migrations applied");
```

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/api test && pnpm --filter @maester/api lint && pnpm --filter @maester/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): hono skeleton with env, logging, error envelope, request ids, cors"
```

---

### Task 6: Authentication, sessions, workspaces

**Files:**
- Create: `apps/api/src/auth.ts`, `apps/api/src/middleware/session.ts`, `apps/api/src/middleware/workspace.ts`, `apps/api/src/serialize.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/workspaces.ts`
- Modify: `apps/api/src/app.ts` (replace `auth: unknown` with `Auth`, mount routes), `apps/api/src/server.ts`
- Test: `apps/api/test/context.ts`, `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: `ensurePersonalWorkspace`, `listWorkspacesForUser`, `getWorkspaceForUser` from `@maester/db`; `HttpError`, `AppEnv` from Task 5.
- Produces:
  - `createAuth({ db, env }): Auth` and `type Auth = ReturnType<typeof createAuth>`.
  - `requireSession(auth: Auth)` middleware setting `user` and `session` variables or throwing `HttpError("UNAUTHENTICATED")`.
  - `requireWorkspace()` middleware reading route param `ws`, setting `workspace` and `membership`, or throwing `HttpError("NOT_FOUND")`.
  - `toWorkspace(row): Workspace`, `toJob(row): Job`, `toDocument(row, latestJob): Document` serialisers.
  - Test helper `createTestContext(): Promise<TestContext>` with `{ app, db, store, dispatcher, env, signUp(email): Promise<{ cookie: string; userId: string; workspaceId: string }>, close() }`.
  - Routes: `GET /v1/me`, `GET /v1/workspaces`, `GET /v1/workspaces/:ws`.

- [ ] **Step 1: Failing tests**

`apps/api/test/context.ts`:
```ts
import { sql } from "drizzle-orm";
import { closeDb, createDb, runMigrations } from "@maester/db";
import { MemoryObjectStore } from "@maester/storage";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { RecordingDispatcher } from "../src/dispatch/index.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

export async function createTestContext() {
  const env = testEnv();
  const db = createDb(env.DATABASE_URL);
  await runMigrations(db);
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user" CASCADE`);
  const store = new MemoryObjectStore();
  const dispatcher = new RecordingDispatcher();
  const auth = createAuth({ db, env });
  const app = createApp({ env, logger: silentLogger, db, auth, store, dispatcher });

  async function signUp(email: string) {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-battery" }),
    });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const me = await app.request("/v1/me", { headers: { cookie } });
    const body = (await me.json()) as { user: { id: string }; workspaces: { id: string }[] };
    return { cookie, userId: body.user.id, workspaceId: body.workspaces[0]!.id };
  }

  return { app, db, store, dispatcher, env, signUp, close: () => closeDb(db) };
}
export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
```

Until Task 7 exists, create a stub `apps/api/src/dispatch/index.ts` in this task:
```ts
import type { JobRow } from "@maester/db";
export interface Dispatcher { enqueue(job: JobRow): Promise<void> }
export class RecordingDispatcher implements Dispatcher {
  readonly enqueued: JobRow[] = [];
  async enqueue(job: JobRow) { this.enqueued.push(job); }
}
```

`apps/api/test/auth.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Me, Workspace } from "@maester/contracts";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

describe("auth and workspaces", () => {
  it("sign-up creates a personal workspace and /v1/me returns it", async () => {
    const { cookie } = await ctx.signUp("ada@example.com");
    const res = await ctx.app.request("/v1/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    const me = Me.parse(await res.json());
    expect(me.user.email).toBe("ada@example.com");
    expect(me.workspaces).toHaveLength(1);
    expect(me.workspaces[0]!.name).toBe("Test User's workspace");
  });

  it("/v1/me without a session is UNAUTHENTICATED", async () => {
    const res = await ctx.app.request("/v1/me");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("workspace detail is visible to its member and 404 to others", async () => {
    const a = await ctx.signUp("a@example.com");
    const b = await ctx.signUp("b@example.com");
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect(Workspace.parse(await ok.json()).id).toBe(a.workspaceId);
    const denied = await ctx.app.request(`/v1/workspaces/${a.workspaceId}`, { headers: { cookie: b.cookie } });
    expect(denied.status).toBe(404);
    expect((await denied.json()).error.code).toBe("NOT_FOUND");
  });

  it("sign-in with the wrong password fails and sign-out clears the session", async () => {
    await ctx.signUp("c@example.com");
    const bad = await ctx.app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ email: "c@example.com", password: "wrong" }),
    });
    expect(bad.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @maester/api test -- auth`
Expected: FAIL, `../src/auth.js` not found.

- [ ] **Step 3: Implement auth, middleware, serialisers, routes**

`apps/api/src/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { ensurePersonalWorkspace, schema, type Db } from "@maester/db";
import type { Env } from "./env.js";

export function createAuth({ db, env }: { db: Db; env: Env }) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    trustedOrigins: env.ALLOWED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true },
    advanced: {
      cookiePrefix: "maester",
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "lax" },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensurePersonalWorkspace(db, { userId: user.id, userName: user.name });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

`apps/api/src/middleware/session.ts`:
```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.js";
import type { Auth } from "../auth.js";
import { HttpError } from "../errors.js";

export function requireSession(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new HttpError("UNAUTHENTICATED", "sign in required");
    c.set("user", { id: result.user.id, name: result.user.name, email: result.user.email });
    c.set("session", { id: result.session.id, userId: result.session.userId });
    await next();
  });
}
```

`apps/api/src/middleware/workspace.ts`:
```ts
import { createMiddleware } from "hono/factory";
import { getWorkspaceForUser, type Db } from "@maester/db";
import type { AppEnv } from "../app.js";
import { HttpError } from "../errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireWorkspace(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ws = c.req.param("ws");
    if (!ws || !UUID.test(ws)) throw new HttpError("NOT_FOUND", "workspace not found");
    const found = await getWorkspaceForUser(db, c.get("user").id, ws);
    if (!found) throw new HttpError("NOT_FOUND", "workspace not found");
    c.set("workspace", found.workspace);
    c.set("membership", found.membership);
    await next();
  });
}
```

`apps/api/src/serialize.ts`:
```ts
import type { Document, Job, Workspace } from "@maester/contracts";
import type { DocumentRow, JobRow, WorkspaceRow } from "@maester/db";

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

export function toDocument(row: DocumentRow, latestJob: JobRow | null): Document {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    originalName: row.originalName,
    declaredSize: row.declaredSize,
    declaredMime: row.declaredMime,
    state: row.state,
    contentSha256: row.contentSha256,
    sizeBytes: row.sizeBytes,
    rejectionCode: (row.rejectionCode as Document["rejectionCode"]) ?? null,
    createdAt: row.createdAt.toISOString(),
    storedAt: iso(row.storedAt),
    latestJob: latestJob ? toJob(latestJob) : null,
  };
}
```

`apps/api/src/routes/me.ts`:
```ts
import { Hono } from "hono";
import { listWorkspacesForUser } from "@maester/db";
import type { Me } from "@maester/contracts";
import type { AppDeps, AppEnv } from "../app.js";
import { toWorkspace } from "../serialize.js";

export function meRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const user = c.get("user");
    const workspaces = await listWorkspacesForUser(deps.db, user.id);
    const body: Me = { user, workspaces: workspaces.map(toWorkspace) };
    return c.json(body);
  });
  return r;
}
```

`apps/api/src/routes/workspaces.ts`:
```ts
import { Hono } from "hono";
import { listWorkspacesForUser } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { requireWorkspace } from "../middleware/workspace.js";
import { toWorkspace } from "../serialize.js";

export function workspaceRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const rows = await listWorkspacesForUser(deps.db, c.get("user").id);
    return c.json({ items: rows.map(toWorkspace), nextCursor: null });
  });
  r.get("/:ws", requireWorkspace(deps.db), (c) => c.json(toWorkspace(c.get("workspace"))));
  return r;
}
```

Modify `apps/api/src/app.ts`: change `auth: unknown` to `auth: Auth` (import type from `./auth.js`), and after the `/healthz` route add:
```ts
  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  const v1 = new Hono<AppEnv>();
  v1.use("*", requireSession(deps.auth));
  v1.route("/me", meRoutes(deps));
  v1.route("/workspaces", workspaceRoutes(deps));
  app.route("/v1", v1);
```
with imports for `requireSession`, `meRoutes`, `workspaceRoutes`. Keep `dispatcher: unknown` until Task 7.

Modify `apps/api/src/server.ts`: build `const auth = createAuth({ db, env });` and pass `auth` into `createApp`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @maester/api test`
Expected: PASS. If Better Auth reports a missing column on sign-up (its field set can grow between minor versions), add the column to `packages/db/src/schema/auth.ts`, run `pnpm --filter @maester/db generate`, and re-run.

- [ ] **Step 5: Lint and typecheck, then commit**

Run: `pnpm --filter @maester/api lint && pnpm --filter @maester/api typecheck`

```bash
git add apps/api packages/db
git commit -m "feat(api): better-auth sessions, personal workspaces, membership authorization"
```

---

### Task 7: Job creation, dispatch, and job routes

**Files:**
- Create: `apps/api/src/jobs/create.ts`, `apps/api/src/routes/jobs.ts`
- Modify: `apps/api/src/dispatch/index.ts` (replace stub with full implementation), `apps/api/src/app.ts` (`dispatcher: Dispatcher`, mount jobs routes), `apps/api/src/server.ts`
- Test: `apps/api/test/jobs.test.ts`

**Interfaces:**
- Consumes: `schema.job`, `getJob` from `@maester/db`; `JobTypes` from contracts; `RecordingDispatcher` from the Task 6 stub.
- Produces:
  - `interface Dispatcher { enqueue(job: JobRow): Promise<void> }`; `CloudTasksDispatcher`, `LocalHttpDispatcher`, `RecordingDispatcher`; `createDispatcher(env, logger): Dispatcher`.
  - `createJob(db, dispatcher, input: { workspaceId; type; subjectType; subjectId; pipelineVersion?: string }): Promise<JobRow>` — idempotent on `{type}:{subjectId}:{pipelineVersion}`; enqueues only when the row was newly inserted.
  - `retryJob(db, dispatcher, workspaceId, jobId): Promise<JobRow>` — throws `HttpError("INVALID_STATE")` unless the job is `failed`, or `queued` and untouched for 5 minutes.
  - Routes `GET /v1/workspaces/:ws/jobs/:id`, `POST /v1/workspaces/:ws/jobs/:id/retry`.

- [ ] **Step 1: Failing tests**

`apps/api/test/jobs.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Job, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createJob } from "../src/jobs/create.js";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

describe("jobs", () => {
  it("createJob is idempotent and enqueues once", async () => {
    const { workspaceId } = await ctx.signUp("j1@example.com");
    const subjectId = crypto.randomUUID();
    const a = await createJob(ctx.db, ctx.dispatcher, { workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId });
    const b = await createJob(ctx.db, ctx.dispatcher, { workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId });
    expect(a.id).toBe(b.id);
    expect(a.state).toBe("queued");
    expect(ctx.dispatcher.enqueued.filter((j) => j.id === a.id)).toHaveLength(1);
  });

  it("GET job is scoped to the workspace", async () => {
    const a = await ctx.signUp("j2@example.com");
    const b = await ctx.signUp("j3@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect(Job.parse(await ok.json()).id).toBe(job.id);
    const denied = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/jobs/${job.id}`, { headers: { cookie: b.cookie } });
    expect(denied.status).toBe(404);
  });

  it("retry re-enqueues a failed job with extended max attempts and rejects a running one", async () => {
    const a = await ctx.signUp("j4@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });
    await ctx.db.update(schema.job).set({ state: "failed", attempt: 5, lastErrorCode: "BOOM" }).where(eq(schema.job.id, job.id));
    const before = ctx.dispatcher.enqueued.length;
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(res.status).toBe(200);
    const body = Job.parse(await res.json());
    expect(body.state).toBe("queued");
    expect(body.maxAttempts).toBe(10);
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);

    await ctx.db.update(schema.job).set({ state: "running" }).where(eq(schema.job.id, job.id));
    const bad = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(bad.status).toBe(409);
    expect((await bad.json()).error.code).toBe("INVALID_STATE");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @maester/api test -- jobs`
Expected: FAIL, `../src/jobs/create.js` missing.

- [ ] **Step 3: Implement dispatchers**

Replace `apps/api/src/dispatch/index.ts`:
```ts
import { CloudTasksClient } from "@google-cloud/tasks";
import type { JobRow } from "@maester/db";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";

export interface Dispatcher {
  enqueue(job: JobRow): Promise<void>;
}

export class RecordingDispatcher implements Dispatcher {
  readonly enqueued: JobRow[] = [];
  async enqueue(job: JobRow): Promise<void> {
    this.enqueued.push(job);
  }
}

export class LocalHttpDispatcher implements Dispatcher {
  constructor(
    private readonly workerUrl: string,
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  async enqueue(job: JobRow): Promise<void> {
    const url = `${this.workerUrl}/tasks/${encodeURIComponent(job.type)}`;
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dispatch-secret": this.secret },
      body: JSON.stringify({ jobId: job.id }),
    })
      .then((res) => this.logger.info({ jobId: job.id, status: res.status }, "local dispatch completed"))
      .catch((err: Error) => this.logger.error({ jobId: job.id, err: err.message }, "local dispatch failed"));
  }
}

export class CloudTasksDispatcher implements Dispatcher {
  private readonly client = new CloudTasksClient();
  private readonly parent: string;

  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
  ) {
    this.parent = this.client.queuePath(env.GOOGLE_CLOUD_PROJECT, env.GOOGLE_CLOUD_LOCATION, env.CLOUD_TASKS_QUEUE);
  }

  async enqueue(job: JobRow): Promise<void> {
    const name = `${this.parent}/tasks/${job.id}-${job.attempt}`;
    try {
      await this.client.createTask({
        parent: this.parent,
        task: {
          name,
          httpRequest: {
            httpMethod: "POST",
            url: `${this.env.WORKER_URL}/tasks/${encodeURIComponent(job.type)}`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ jobId: job.id })).toString("base64"),
            oidcToken: { serviceAccountEmail: this.env.WORKER_INVOKER_SA!, audience: this.env.WORKER_URL },
          },
        },
      });
    } catch (err) {
      // gRPC code 6 = ALREADY_EXISTS: a duplicate enqueue for the same job/attempt is harmless.
      if ((err as { code?: number }).code === 6) {
        this.logger.info({ jobId: job.id }, "task already exists");
        return;
      }
      throw err;
    }
  }
}

export function createDispatcher(env: Env, logger: Logger): Dispatcher {
  if (env.DISPATCH_MODE === "cloud-tasks") return new CloudTasksDispatcher(env, logger);
  return new LocalHttpDispatcher(env.WORKER_URL, env.DISPATCH_SECRET!, logger);
}
```

- [ ] **Step 4: Implement createJob / retryJob and routes**

`apps/api/src/jobs/create.ts`:
```ts
import { and, eq, sql } from "drizzle-orm";
import { getJob, schema, type Db, type JobRow } from "@maester/db";
import type { Dispatcher } from "../dispatch/index.js";
import { HttpError } from "../errors.js";

export const DEFAULT_MAX_ATTEMPTS = 5;
export const STUCK_QUEUED_MS = 5 * 60 * 1000;

export async function createJob(
  db: Db,
  dispatcher: Dispatcher,
  input: { workspaceId: string; type: string; subjectType: string; subjectId: string; pipelineVersion?: string },
): Promise<JobRow> {
  const idempotencyKey = `${input.type}:${input.subjectId}:${input.pipelineVersion ?? "1"}`;
  const inserted = await db
    .insert(schema.job)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      idempotencyKey,
      state: "queued",
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    })
    .onConflictDoNothing({ target: schema.job.idempotencyKey })
    .returning();

  if (inserted[0]) {
    await dispatcher.enqueue(inserted[0]);
    return inserted[0];
  }
  const existing = await db.select().from(schema.job).where(eq(schema.job.idempotencyKey, idempotencyKey)).limit(1);
  if (!existing[0]) throw new Error("job vanished after idempotency conflict");
  return existing[0];
}

export async function retryJob(db: Db, dispatcher: Dispatcher, workspaceId: string, jobId: string): Promise<JobRow> {
  const current = await getJob(db, workspaceId, jobId);
  if (!current) throw new HttpError("NOT_FOUND", "job not found");
  const stuckBefore = new Date(Date.now() - STUCK_QUEUED_MS);
  const [updated] = await db
    .update(schema.job)
    .set({
      state: "queued",
      leaseToken: null,
      leaseExpiresAt: null,
      maxAttempts: sql`${schema.job.attempt} + ${DEFAULT_MAX_ATTEMPTS}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        eq(schema.job.workspaceId, workspaceId),
        sql`(${schema.job.state} = 'failed' OR (${schema.job.state} = 'queued' AND ${schema.job.updatedAt} < ${stuckBefore}))`,
      ),
    )
    .returning();
  if (!updated) throw new HttpError("INVALID_STATE", `job is ${current.state} and cannot be retried`);
  await dispatcher.enqueue(updated);
  return updated;
}
```

`apps/api/src/routes/jobs.ts`:
```ts
import { Hono } from "hono";
import { getJob } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { retryJob } from "../jobs/create.js";
import { toJob } from "../serialize.js";

export function jobRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id", async (c) => {
    const job = await getJob(deps.db, c.get("workspace").id, c.req.param("id"));
    if (!job) throw new HttpError("NOT_FOUND", "job not found");
    return c.json(toJob(job));
  });

  r.post("/:id/retry", async (c) => {
    const job = await retryJob(deps.db, deps.dispatcher, c.get("workspace").id, c.req.param("id"));
    return c.json(toJob(job));
  });

  return r;
}
```

Modify `apps/api/src/app.ts`: change `dispatcher: unknown` to `dispatcher: Dispatcher` (type import from `./dispatch/index.js`), and inside `createApp` after the `v1.route("/workspaces", workspaceRoutes(deps))` line add a workspace-scoped sub-router:
```ts
  const ws = new Hono<AppEnv>();
  ws.use("*", requireWorkspace(deps.db));
  ws.route("/jobs", jobRoutes(deps));
  v1.route("/workspaces/:ws", ws);
```

Modify `apps/api/src/server.ts`: `const dispatcher = createDispatcher(env, logger);` and pass it to `createApp`.

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/api test && pnpm --filter @maester/api lint && pnpm --filter @maester/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): idempotent job creation, cloud tasks and local dispatch, job routes"
```

---

### Task 8: Document upload, finalize, list, detail, download routes

**Files:**
- Create: `apps/api/src/routes/documents.ts`, `apps/api/src/validation.ts`
- Modify: `apps/api/src/app.ts` (mount under `ws`)
- Test: `apps/api/test/documents.test.ts`

**Interfaces:**
- Consumes: `createJob` (Task 7), `ObjectStore` (Task 4), `getDocument`, `listDocuments`, `getLatestJobForSubject`, `schema.document` from `@maester/db`, contracts schemas, `toDocument`, `toJob`.
- Produces routes:
  - `POST /v1/workspaces/:ws/documents/uploads` → `CreateUploadResponse` (201)
  - `POST /v1/workspaces/:ws/documents/:id/finalize` → `FinalizeResponse`
  - `GET /v1/workspaces/:ws/documents` → `paginated(Document)`
  - `GET /v1/workspaces/:ws/documents/:id` → `Document`
  - `GET /v1/workspaces/:ws/documents/:id/download` → `DownloadResponse`
  - `storageKeyFor(workspaceId, documentId): string`
  - `validate(target, schema)`: a wrapper over `zValidator` that emits the `VALIDATION_FAILED` envelope.

- [ ] **Step 1: Failing tests**

`apps/api/test/documents.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateUploadResponse, Document, FinalizeResponse, JobTypes, paginated } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const post = (cookie: string, body: unknown) => ({
  method: "POST",
  headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify(body),
});

async function createUpload(ws: string, cookie: string, size = 1234) {
  const res = await ctx.app.request(`/v1/workspaces/${ws}/documents/uploads`, post(cookie, { originalName: "fy24.pdf", size, mimeType: "application/pdf" }));
  return { status: res.status, body: await res.json() };
}

describe("documents", () => {
  it("creates an upload with a signed PUT bound to size and type", async () => {
    const a = await ctx.signUp("d1@example.com");
    const { status, body } = await createUpload(a.workspaceId, a.cookie);
    expect(status).toBe(201);
    const parsed = CreateUploadResponse.parse(body);
    expect(parsed.document.state).toBe("pending_upload");
    expect(parsed.upload.headers["Content-Length"]).toBe("1234");
    expect(parsed.upload.url).toBe(`memory://upload/workspaces/${a.workspaceId}/documents/${parsed.document.id}/original.pdf`);
  });

  it("rejects oversize and non-pdf uploads with stable codes", async () => {
    const a = await ctx.signUp("d2@example.com");
    const big = await createUpload(a.workspaceId, a.cookie, 52428801);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("UPLOAD_TOO_LARGE");
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/uploads`, post(a.cookie, { originalName: "x.png", size: 5, mimeType: "image/png" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fields[0].path).toBe("mimeType");
  });

  it("finalize requires the object to exist, enqueues verify, and is idempotent", async () => {
    const a = await ctx.signUp("d3@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    const docId = body.document.id as string;
    const key = `workspaces/${a.workspaceId}/documents/${docId}/original.pdf`;

    const missing = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(missing.status).toBe(409);
    expect((await missing.json()).error.code).toBe("INVALID_STATE");

    await ctx.store.put(key, new TextEncoder().encode("%PDF-1.4"), "application/pdf");
    const first = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(first.status).toBe(200);
    const f = FinalizeResponse.parse(await first.json());
    expect(f.document.state).toBe("uploaded");
    expect(f.job.type).toBe(JobTypes.DOCUMENT_VERIFY);
    expect(ctx.dispatcher.enqueued.some((j) => j.id === f.job.id)).toBe(true);

    const second = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(second.status).toBe(200);
    expect(FinalizeResponse.parse(await second.json()).job.id).toBe(f.job.id);
  });

  it("list is paginated and scoped; detail is 404 across workspaces", async () => {
    const a = await ctx.signUp("d4@example.com");
    const b = await ctx.signUp("d5@example.com");
    for (let i = 0; i < 3; i++) await createUpload(a.workspaceId, a.cookie);
    await createUpload(b.workspaceId, b.cookie);

    const p1 = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents?limit=2`, { headers: { cookie: a.cookie } });
    const page = paginated(Document).parse(await p1.json());
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const p2 = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents?limit=2&cursor=${page.nextCursor}`, { headers: { cookie: a.cookie } });
    expect(paginated(Document).parse(await p2.json()).items).toHaveLength(1);

    const foreign = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/documents/${page.items[0]!.id}`, { headers: { cookie: b.cookie } });
    expect(foreign.status).toBe(404);
  });

  it("download is only available once stored", async () => {
    const a = await ctx.signUp("d6@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    const docId = body.document.id as string;
    const notYet = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/download`, { headers: { cookie: a.cookie } });
    expect(notYet.status).toBe(409);
    await ctx.db.update(schema.document).set({ state: "stored" }).where(eq(schema.document.id, docId));
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/download`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).url).toContain("memory://download/");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @maester/api test -- documents`
Expected: FAIL with 404s (routes not mounted).

- [ ] **Step 3: Implement validation wrapper and routes**

`apps/api/src/validation.ts`:
```ts
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { errorBody } from "./errors.js";

export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const fields = result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
      const traceId = (c.get("traceId" as never) as string | undefined) ?? "unknown";
      return c.json(errorBody("VALIDATION_FAILED", "request validation failed", traceId, fields), 400);
    }
  });
}
```

`apps/api/src/routes/documents.ts`:
```ts
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  CreateUploadRequest,
  JobTypes,
  ListQuery,
  type CreateUploadResponse,
  type DownloadResponse,
  type FinalizeResponse,
} from "@maester/contracts";
import { getDocument, getLatestJobForSubject, listDocuments, schema, type DocumentRow } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { createJob } from "../jobs/create.js";
import { toDocument, toJob } from "../serialize.js";
import { validate } from "../validation.js";

export function storageKeyFor(workspaceId: string, documentId: string): string {
  return `workspaces/${workspaceId}/documents/${documentId}/original.pdf`;
}

function sanitiseName(name: string): string {
  return name.replace(/[\\/]/g, "_").replace(/[^\x20-\x7E]/g, "_").slice(0, 255);
}

export function documentRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.post("/uploads", validate("json", CreateUploadRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    if (input.size > deps.env.MAX_UPLOAD_BYTES) {
      throw new HttpError("UPLOAD_TOO_LARGE", `uploads are limited to ${deps.env.MAX_UPLOAD_BYTES} bytes`, [{ path: "size", message: "too large" }]);
    }
    const id = crypto.randomUUID();
    const storageKey = storageKeyFor(workspace.id, id);
    const [row] = await deps.db
      .insert(schema.document)
      .values({
        id,
        workspaceId: workspace.id,
        originalName: sanitiseName(input.originalName),
        declaredSize: input.size,
        declaredMime: input.mimeType,
        storageKey,
        state: "pending_upload",
        createdByUserId: c.get("user").id,
      })
      .returning();
    const signed = await deps.store.signUpload(storageKey, {
      contentType: input.mimeType,
      contentLength: input.size,
      expiresInSeconds: deps.env.UPLOAD_URL_TTL_SECONDS,
    });
    const body: CreateUploadResponse = {
      document: toDocument(row!, null),
      upload: { method: "PUT", url: signed.url, headers: signed.headers, expiresAt: signed.expiresAt.toISOString() },
    };
    return c.json(body, 201);
  });

  r.post("/:id/finalize", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, c.req.param("id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state === "rejected") throw new HttpError("INVALID_STATE", "document was rejected; create a new upload");

    let current: DocumentRow = doc;
    if (doc.state === "pending_upload") {
      if (!(await deps.store.exists(doc.storageKey))) {
        throw new HttpError("INVALID_STATE", "upload has not been received yet");
      }
      const [updated] = await deps.db
        .update(schema.document)
        .set({ state: "uploaded", updatedAt: sql`now()` })
        .where(and(eq(schema.document.id, doc.id), eq(schema.document.state, "pending_upload")))
        .returning();
      current = updated ?? (await getDocument(deps.db, workspace.id, doc.id))!;
    }

    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id,
      type: JobTypes.DOCUMENT_VERIFY,
      subjectType: "document",
      subjectId: current.id,
    });
    const body: FinalizeResponse = { document: toDocument(current, job), job: toJob(job) };
    return c.json(body);
  });

  r.get("/", validate("query", ListQuery), async (c) => {
    const q = c.req.valid("query");
    const workspace = c.get("workspace");
    const page = await listDocuments(deps.db, workspace.id, { cursor: q.cursor, limit: q.limit });
    const items = await Promise.all(
      page.items.map(async (d) => toDocument(d, await getLatestJobForSubject(deps.db, workspace.id, "document", d.id))),
    );
    return c.json({ items, nextCursor: page.nextCursor });
  });

  r.get("/:id", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, c.req.param("id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const job = await getLatestJobForSubject(deps.db, workspace.id, "document", doc.id);
    return c.json(toDocument(doc, job));
  });

  r.get("/:id/download", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, c.req.param("id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}`);
    const signed = await deps.store.signDownload(doc.storageKey, { expiresInSeconds: deps.env.DOWNLOAD_URL_TTL_SECONDS });
    const body: DownloadResponse = { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    return c.json(body);
  });

  return r;
}
```

Modify `apps/api/src/app.ts`: add `ws.route("/documents", documentRoutes(deps));` next to the jobs mount.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/api test && pnpm --filter @maester/api lint && pnpm --filter @maester/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): document upload, finalize, list, detail and download routes"
```

---

### Task 9: SSE job events

**Files:**
- Create: `apps/api/src/routes/job-events.ts`
- Modify: `apps/api/src/app.ts` (`AppOptions`, mount events route before job routes), `apps/api/test/context.ts` (fast SSE options)
- Test: `apps/api/test/job-events.test.ts`

**Interfaces:**
- Consumes: `getJob`, `toJob`.
- Produces:
  - `interface SseOptions { pollMs: number; heartbeatMs: number; maxLifetimeMs: number }`, `DEFAULT_SSE = { pollMs: 2000, heartbeatMs: 15000, maxLifetimeMs: 1800000 }`.
  - `jobEventsRoute(deps, opts?)` mounted so that `GET /v1/workspaces/:ws/jobs/:id/events` streams `event: job` (full `Job` JSON), `: ping` heartbeats, and `event: done` on a terminal state.
  - `createApp(deps, options?: { sse?: SseOptions })`.

- [ ] **Step 1: Failing test**

`apps/api/test/job-events.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createJob } from "../src/jobs/create.js";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

async function collect(res: Response, until: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (until(text)) break;
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

function parseJobEvents(text: string): { state: string; progress: { stage?: string } }[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("event: job"))
    .map((block) => JSON.parse(block.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));
}

describe("job events", () => {
  it("streams the initial state, a change, then done", async () => {
    const a = await ctx.signUp("e1@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });

    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/events`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    setTimeout(async () => {
      await ctx.db.update(schema.job).set({ state: "running", progress: { stage: "hashing" }, updatedAt: new Date() }).where(eq(schema.job.id, job.id));
      setTimeout(async () => {
        await ctx.db.update(schema.job).set({ state: "succeeded", finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.job.id, job.id));
      }, 150);
    }, 150);

    const text = await collect(res, (t) => t.includes("event: done"));
    const events = parseJobEvents(text);
    expect(events[0]!.state).toBe("queued");
    expect(events.some((e) => e.state === "running" && e.progress.stage === "hashing")).toBe(true);
    expect(events[events.length - 1]!.state).toBe("succeeded");
  });

  it("returns 404 for another workspace's job", async () => {
    const a = await ctx.signUp("e2@example.com");
    const b = await ctx.signUp("e3@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });
    const res = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/jobs/${job.id}/events`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });
});
```

Modify `apps/api/test/context.ts` so the app is created with fast polling:
```ts
const app = createApp({ env, logger: silentLogger, db, auth, store, dispatcher }, { sse: { pollMs: 50, heartbeatMs: 1000, maxLifetimeMs: 10000 } });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @maester/api test -- job-events`
Expected: FAIL (404 on the events route, and a type error on the second `createApp` argument).

- [ ] **Step 3: Implement**

`apps/api/src/routes/job-events.ts`:
```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJob, type JobRow } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { toJob } from "../serialize.js";

export interface SseOptions { pollMs: number; heartbeatMs: number; maxLifetimeMs: number }
export const DEFAULT_SSE: SseOptions = { pollMs: 2000, heartbeatMs: 15000, maxLifetimeMs: 30 * 60 * 1000 };

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const fingerprint = (j: JobRow) => `${j.state}|${j.updatedAt.toISOString()}|${JSON.stringify(j.progress)}`;

export function jobEventsRoute(deps: AppDeps, opts: SseOptions = DEFAULT_SSE) {
  const r = new Hono<AppEnv>();

  r.get("/:id/events", async (c) => {
    const workspaceId = c.get("workspace").id;
    const jobId = c.req.param("id");
    const initial = await getJob(deps.db, workspaceId, jobId);
    if (!initial) throw new HttpError("NOT_FOUND", "job not found");

    return streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      const startedAt = Date.now();
      let lastHeartbeat = Date.now();
      let last = fingerprint(initial);
      let seq = 0;

      await stream.writeSSE({ event: "job", id: String(seq++), data: JSON.stringify(toJob(initial)) });
      if (TERMINAL.has(initial.state)) {
        await stream.writeSSE({ event: "done", data: "" });
        return;
      }

      while (open && Date.now() - startedAt < opts.maxLifetimeMs) {
        await stream.sleep(opts.pollMs);
        if (!open) break;
        const current = await getJob(deps.db, workspaceId, jobId);
        if (!current) break;
        const fp = fingerprint(current);
        if (fp !== last) {
          last = fp;
          await stream.writeSSE({ event: "job", id: String(seq++), data: JSON.stringify(toJob(current)) });
          if (TERMINAL.has(current.state)) {
            await stream.writeSSE({ event: "done", data: "" });
            break;
          }
        } else if (Date.now() - lastHeartbeat >= opts.heartbeatMs) {
          lastHeartbeat = Date.now();
          await stream.write(": ping\n\n");
        }
      }
    });
  });

  return r;
}
```

Modify `apps/api/src/app.ts`:
```ts
import { DEFAULT_SSE, jobEventsRoute, type SseOptions } from "./routes/job-events.js";

export interface AppOptions { sse?: SseOptions }

export function createApp(deps: AppDeps, options: AppOptions = {}) {
  // ...existing setup...
  ws.route("/jobs", jobEventsRoute(deps, options.sse ?? DEFAULT_SSE));
  ws.route("/jobs", jobRoutes(deps));
```
Mount `jobEventsRoute` before `jobRoutes` so `/:id/events` is matched before `/:id`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/api test && pnpm --filter @maester/api lint && pnpm --filter @maester/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): server-sent events for job progress"
```

---

### Task 10: Worker service (dispatch auth, leasing, handler registry, run loop)

**Files:**
- Create: `apps/worker/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `tsup.config.ts`
- Create: `apps/worker/src/{env,logger,auth,lease,run,app,server}.ts`, `apps/worker/src/jobs/{types,index}.ts`
- Test: `apps/worker/test/context.ts`, `apps/worker/test/lease.test.ts`, `apps/worker/test/run.test.ts`

**Interfaces:**
- Consumes: `@maester/db` (`schema.job`, `createDb`, `runMigrations`), `@maester/storage`.
- Produces:
  - `loadWorkerEnv(source?): WorkerEnv` with `NODE_ENV, PORT (8788), LOG_LEVEL, DATABASE_URL, GCS_BUCKET, DISPATCH_MODE, DISPATCH_SECRET?, WORKER_URL, API_SERVICE_ACCOUNT_EMAIL?, MAX_UPLOAD_BYTES, LEASE_SECONDS (600)`.
  - `verifyDispatchRequest(env, headers: Headers): Promise<void>` throwing `DispatchAuthError` on failure.
  - `acquireLease(db, jobId, leaseSeconds): Promise<JobRow | null>`; `completeJob(db, jobId, leaseToken, result): Promise<boolean>`; `failAttempt(db, job, leaseToken, err: { code: string; message: string }, final: boolean): Promise<void>`; `writeProgress(db, jobId, leaseToken, progress): Promise<void>`.
  - `type JobHandler = (job: JobRow, ctx: JobContext) => Promise<unknown>`; `interface JobContext { db: Db; store: ObjectStore; logger: Logger; env: WorkerEnv; progress(p: JobProgressJson): Promise<void> }`.
  - `handlers: Record<string, JobHandler>` registry (empty except `document.verify`, added in Task 11).
  - `runJob(deps: WorkerDeps, type: string, jobId: string): Promise<{ status: 200 | 409 | 500; body: { jobId: string; outcome: string } }>` where `WorkerDeps = { db; store; logger; env; handlers }`.
  - `createWorkerApp(deps): Hono` with `GET /healthz` and `POST /tasks/:type`.

- [ ] **Step 1: Manifest and configs**

`apps/worker/package.json`:
```json
{
  "name": "@maester/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup",
    "start": "node dist/server.js",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.0",
    "@maester/contracts": "workspace:*",
    "@maester/db": "workspace:*",
    "@maester/storage": "workspace:*",
    "drizzle-orm": "^0.44.0",
    "google-auth-library": "^11.0.0",
    "hono": "^4.13.0",
    "pino": "^10.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@maester/config": "workspace:*",
    "@types/node": "^22.0.0",
    "eslint": "^9.30.0",
    "tsup": "^8.5.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```
`tsconfig.json`, `eslint.config.js`, `vitest.config.ts` identical to `apps/api`. `tsup.config.ts` identical to the API's but with `entry: { server: "src/server.ts" }`.

- [ ] **Step 2: Failing tests**

`apps/worker/test/context.ts`:
```ts
import { sql } from "drizzle-orm";
import { closeDb, createDb, runMigrations, schema, type Db } from "@maester/db";
import { MemoryObjectStore } from "@maester/storage";
import { loadWorkerEnv } from "../src/env.js";
import { silentLogger } from "../src/logger.js";
import type { JobHandler } from "../src/jobs/types.js";
import type { WorkerDeps } from "../src/run.js";

export function workerTestEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadWorkerEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? "postgres://maester:maester@localhost:5433/maester_test",
    GCS_BUCKET: "test-bucket",
    DISPATCH_MODE: "local",
    DISPATCH_SECRET: "local-dispatch-secret",
    WORKER_URL: "http://localhost:8788",
    LEASE_SECONDS: "600",
    ...overrides,
  });
}

export async function createWorkerContext(handlers: Record<string, JobHandler> = {}) {
  const env = workerTestEnv();
  const db = createDb(env.DATABASE_URL);
  await runMigrations(db);
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user" CASCADE`);
  const store = new MemoryObjectStore();
  const deps: WorkerDeps = { db, store, logger: silentLogger, env, handlers };
  return { ...deps, close: () => closeDb(db) };
}

export async function seedWorkspace(db: Db) {
  const userId = "u-" + crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name: "W", email: `${userId}@example.com` });
  const workspaceId = crypto.randomUUID();
  await db.insert(schema.workspace).values({ id: workspaceId, name: "W", ownerUserId: userId });
  return { userId, workspaceId };
}

export async function seedJob(db: Db, workspaceId: string, overrides: Partial<typeof schema.job.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(schema.job).values({
    id, workspaceId, type: "test.noop", subjectType: "test", subjectId: crypto.randomUUID(),
    idempotencyKey: `k-${id}`, state: "queued", ...overrides,
  });
  return id;
}
```

`apps/worker/test/lease.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { acquireLease, completeJob, failAttempt } from "../src/lease.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext(); });
afterAll(() => ctx.close());

describe("lease", () => {
  it("only one of many concurrent acquirers wins", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const results = await Promise.all(Array.from({ length: 8 }, () => acquireLease(ctx.db, id, 600)));
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.state).toBe("running");
    expect(winners[0]!.attempt).toBe(1);
    expect(winners[0]!.leaseToken).toBeTruthy();
  });

  it("an expired lease can be re-acquired", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { state: "running", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000), attempt: 1 });
    const row = await acquireLease(ctx.db, id, 600);
    expect(row?.attempt).toBe(2);
  });

  it("completeJob only succeeds with the matching lease token", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const row = (await acquireLease(ctx.db, id, 600))!;
    expect(await completeJob(ctx.db, id, crypto.randomUUID(), { ok: true })).toBe(false);
    expect(await completeJob(ctx.db, id, row.leaseToken!, { ok: true })).toBe(true);
    const [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(after!.state).toBe("succeeded");
    expect(after!.result).toEqual({ ok: true });
    expect(after!.finishedAt).not.toBeNull();
  });

  it("failAttempt requeues when not final and fails when final", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const row = (await acquireLease(ctx.db, id, 600))!;
    await failAttempt(ctx.db, row, row.leaseToken!, { code: "E1", message: "boom" }, false);
    let [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(after!.state).toBe("queued");
    expect(after!.lastErrorCode).toBe("E1");
    expect(after!.leaseToken).toBeNull();

    const row2 = (await acquireLease(ctx.db, id, 600))!;
    await failAttempt(ctx.db, row2, row2.leaseToken!, { code: "E2", message: "boom again" }, true);
    [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(after!.state).toBe("failed");
    expect(after!.lastErrorCode).toBe("E2");
    expect(after!.finishedAt).not.toBeNull();
  });
});
```

`apps/worker/test/run.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { createWorkerApp } from "../src/app.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => {
  ctx = await createWorkerContext({
    "test.noop": async (_job, c) => {
      await c.progress({ stage: "working", percent: 50 });
      return { done: true };
    },
    "test.fail": async () => {
      throw new Error("handler exploded");
    },
  });
});
afterAll(() => ctx.close());

describe("runJob", () => {
  it("runs a handler to success and records progress and result", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.noop" });
    const res = await runJob(ctx, "test.noop", id);
    expect(res.status).toBe(200);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.state).toBe("succeeded");
    expect(row!.result).toEqual({ done: true });
    expect(row!.progress).toEqual({ stage: "working", percent: 50 });
  });

  it("returns 500 and requeues on a non-final failure, then fails on the last attempt", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.fail", maxAttempts: 2 });
    const first = await runJob(ctx, "test.fail", id);
    expect(first.status).toBe(500);
    let [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.state).toBe("queued");
    expect(row!.attempt).toBe(1);
    const second = await runJob(ctx, "test.fail", id);
    expect(second.status).toBe(200);
    [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.state).toBe("failed");
    expect(row!.lastErrorCode).toBe("HANDLER_ERROR");
  });

  it("acks already-terminal jobs, 409s a held lease, and fails unknown types", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const done = await seedJob(ctx.db, workspaceId, { type: "test.noop", state: "succeeded" });
    expect((await runJob(ctx, "test.noop", done)).status).toBe(200);

    const held = await seedJob(ctx.db, workspaceId, { type: "test.noop", state: "running", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) });
    expect((await runJob(ctx, "test.noop", held)).status).toBe(409);

    const unknown = await seedJob(ctx.db, workspaceId, { type: "nope" });
    expect((await runJob(ctx, "nope", unknown)).status).toBe(200);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, unknown));
    expect(row!.state).toBe("failed");
    expect(row!.lastErrorCode).toBe("UNKNOWN_JOB_TYPE");
  });

  it("missing job id returns 200 ack", async () => {
    expect((await runJob(ctx, "test.noop", crypto.randomUUID())).status).toBe(200);
  });
});

describe("worker app", () => {
  it("rejects a request without the local dispatch secret", async () => {
    const app = createWorkerApp(ctx);
    const res = await app.request("/tasks/test.noop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: crypto.randomUUID() }) });
    expect(res.status).toBe(401);
  });

  it("accepts a request with the local dispatch secret and runs the job", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.noop" });
    const app = createWorkerApp(ctx);
    const res = await app.request("/tasks/test.noop", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dispatch-secret": "local-dispatch-secret" },
      body: JSON.stringify({ jobId: id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: id, outcome: "succeeded" });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @maester/worker test`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement env, logger, auth**

`apps/worker/src/env.ts`:
```ts
import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8788),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  GCS_BUCKET: z.string().min(1),
  DISPATCH_MODE: z.enum(["local", "cloud-tasks"]).default("local"),
  DISPATCH_SECRET: z.string().optional(),
  WORKER_URL: z.url(),
  API_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(52428800),
  LEASE_SECONDS: z.coerce.number().int().default(600),
});
export type WorkerEnv = z.infer<typeof Schema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.DISPATCH_MODE === "local" && !parsed.data.DISPATCH_SECRET) throw new Error("DISPATCH_SECRET required when DISPATCH_MODE=local");
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.API_SERVICE_ACCOUNT_EMAIL) throw new Error("API_SERVICE_ACCOUNT_EMAIL required when DISPATCH_MODE=cloud-tasks");
  return parsed.data;
}
```

`apps/worker/src/logger.ts`: identical to `apps/api/src/logger.ts` (copy the file; a shared logging package is not worth it for two files).

`apps/worker/src/auth.ts`:
```ts
import { OAuth2Client } from "google-auth-library";
import type { WorkerEnv } from "./env.js";

export class DispatchAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchAuthError";
  }
}

const oauth = new OAuth2Client();

export async function verifyDispatchRequest(env: WorkerEnv, headers: Headers): Promise<void> {
  if (env.DISPATCH_MODE === "local") {
    const secret = headers.get("x-dispatch-secret");
    if (!secret || secret !== env.DISPATCH_SECRET) throw new DispatchAuthError("missing or invalid dispatch secret");
    return;
  }
  const authz = headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) throw new DispatchAuthError("missing bearer token");
  let email: string | undefined;
  try {
    const ticket = await oauth.verifyIdToken({ idToken: token, audience: env.WORKER_URL });
    email = ticket.getPayload()?.email;
  } catch {
    throw new DispatchAuthError("invalid OIDC token");
  }
  if (!email || email !== env.API_SERVICE_ACCOUNT_EMAIL) throw new DispatchAuthError("token issued for an unexpected service account");
}
```

- [ ] **Step 5: Implement lease, job types, registry, run loop, app, server**

`apps/worker/src/lease.ts`:
```ts
import { and, eq, lt, or, sql } from "drizzle-orm";
import { schema, type Db, type JobProgressJson, type JobRow } from "@maester/db";

export async function acquireLease(db: Db, jobId: string, leaseSeconds: number): Promise<JobRow | null> {
  const leaseToken = crypto.randomUUID();
  const [row] = await db
    .update(schema.job)
    .set({
      state: "running",
      leaseToken,
      leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSeconds})`,
      attempt: sql`${schema.job.attempt} + 1`,
      startedAt: sql`coalesce(${schema.job.startedAt}, now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        or(eq(schema.job.state, "queued"), and(eq(schema.job.state, "running"), lt(schema.job.leaseExpiresAt, sql`now()`))),
      ),
    )
    .returning();
  return row ?? null;
}

export async function writeProgress(db: Db, jobId: string, leaseToken: string, progress: JobProgressJson): Promise<void> {
  await db
    .update(schema.job)
    .set({ progress, updatedAt: sql`now()` })
    .where(and(eq(schema.job.id, jobId), eq(schema.job.leaseToken, leaseToken)));
}

export async function completeJob(db: Db, jobId: string, leaseToken: string, result: unknown): Promise<boolean> {
  const rows = await db
    .update(schema.job)
    .set({ state: "succeeded", result, leaseToken: null, leaseExpiresAt: null, finishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(schema.job.id, jobId), eq(schema.job.leaseToken, leaseToken)))
    .returning({ id: schema.job.id });
  return rows.length === 1;
}

export async function failAttempt(
  db: Db,
  job: JobRow,
  leaseToken: string,
  err: { code: string; message: string },
  final: boolean,
): Promise<void> {
  await db
    .update(schema.job)
    .set({
      state: final ? "failed" : "queued",
      lastErrorCode: err.code,
      lastErrorMessage: err.message.slice(0, 2000),
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: final ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(schema.job.id, job.id), eq(schema.job.leaseToken, leaseToken)));
}
```

`apps/worker/src/jobs/types.ts`:
```ts
import type { Db, JobProgressJson, JobRow } from "@maester/db";
import type { ObjectStore } from "@maester/storage";
import type { WorkerEnv } from "../env.js";
import type { Logger } from "../logger.js";

export interface JobContext {
  db: Db;
  store: ObjectStore;
  logger: Logger;
  env: WorkerEnv;
  progress(p: JobProgressJson): Promise<void>;
}

export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<unknown>;
```

`apps/worker/src/jobs/index.ts`:
```ts
import type { JobHandler } from "./types.js";

export const handlers: Record<string, JobHandler> = {};
```

`apps/worker/src/run.ts`:
```ts
import { eq } from "drizzle-orm";
import { schema, type Db } from "@maester/db";
import type { ObjectStore } from "@maester/storage";
import type { WorkerEnv } from "./env.js";
import type { JobHandler } from "./jobs/types.js";
import { acquireLease, completeJob, failAttempt, writeProgress } from "./lease.js";
import type { Logger } from "./logger.js";

export interface WorkerDeps {
  db: Db;
  store: ObjectStore;
  logger: Logger;
  env: WorkerEnv;
  handlers: Record<string, JobHandler>;
}

export type RunResult = { status: 200 | 409 | 500; body: { jobId: string; outcome: string } };

export async function runJob(deps: WorkerDeps, type: string, jobId: string): Promise<RunResult> {
  const log = deps.logger.child({ jobId, type });
  const [existing] = await deps.db.select().from(schema.job).where(eq(schema.job.id, jobId)).limit(1);
  if (!existing) {
    log.warn("job not found; acking");
    return { status: 200, body: { jobId, outcome: "missing" } };
  }
  if (existing.state === "succeeded" || existing.state === "failed" || existing.state === "cancelled") {
    return { status: 200, body: { jobId, outcome: existing.state } };
  }

  const job = await acquireLease(deps.db, jobId, deps.env.LEASE_SECONDS);
  if (!job) {
    log.info("lease held elsewhere");
    return { status: 409, body: { jobId, outcome: "lease_held" } };
  }
  const leaseToken = job.leaseToken!;
  const startedAt = Date.now();

  const handler = deps.handlers[job.type];
  if (!handler) {
    await failAttempt(deps.db, job, leaseToken, { code: "UNKNOWN_JOB_TYPE", message: `no handler for ${job.type}` }, true);
    log.error("unknown job type");
    return { status: 200, body: { jobId, outcome: "failed" } };
  }

  try {
    log.info({ attempt: job.attempt }, "job started");
    const result = await handler(job, {
      db: deps.db,
      store: deps.store,
      logger: log,
      env: deps.env,
      progress: (p) => writeProgress(deps.db, job.id, leaseToken, p),
    });
    const ok = await completeJob(deps.db, job.id, leaseToken, result ?? null);
    log.info({ durationMs: Date.now() - startedAt, ok }, "job succeeded");
    return { status: 200, body: { jobId, outcome: ok ? "succeeded" : "lease_lost" } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = job.attempt >= job.maxAttempts;
    await failAttempt(deps.db, job, leaseToken, { code: "HANDLER_ERROR", message }, final);
    log.error({ durationMs: Date.now() - startedAt, attempt: job.attempt, final, err: message }, "job attempt failed");
    return final ? { status: 200, body: { jobId, outcome: "failed" } } : { status: 500, body: { jobId, outcome: "retry" } };
  }
}
```

`apps/worker/src/app.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { DispatchAuthError, verifyDispatchRequest } from "./auth.js";
import { runJob, type WorkerDeps } from "./run.js";

const Body = z.object({ jobId: z.uuid() });

export function createWorkerApp(deps: WorkerDeps) {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.post("/tasks/:type", async (c) => {
    try {
      await verifyDispatchRequest(deps.env, c.req.raw.headers);
    } catch (err) {
      if (err instanceof DispatchAuthError) return c.json({ error: err.message }, 401);
      throw err;
    }
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const result = await runJob(deps, c.req.param("type"), parsed.data.jobId);
    return c.json(result.body, result.status);
  });

  app.onError((err, c) => {
    deps.logger.error({ err: { name: err.name, message: err.message } }, "unhandled worker error");
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
```

`apps/worker/src/server.ts`:
```ts
import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { GcsObjectStore } from "@maester/storage";
import { createWorkerApp } from "./app.js";
import { loadWorkerEnv } from "./env.js";
import { handlers } from "./jobs/index.js";
import { createLogger } from "./logger.js";

const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const store = new GcsObjectStore(env.GCS_BUCKET);
const app = createWorkerApp({ db, store, logger, env, handlers });

serve({ fetch: app.fetch, port: env.PORT }, (info) => logger.info({ port: info.port }, "worker listening"));
```

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/worker test && pnpm --filter @maester/worker lint && pnpm --filter @maester/worker typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): cloud tasks target with job leasing, retries and handler registry"
```

---

### Task 11: `document.verify` handler

**Files:**
- Create: `apps/worker/src/jobs/document-verify.ts`
- Modify: `apps/worker/src/jobs/index.ts` (register)
- Test: `apps/worker/test/document-verify.test.ts`

**Interfaces:**
- Consumes: `JobHandler`, `JobContext`, `ObjectNotFoundError`, `schema.document`, `DocumentVerifyResult` from contracts.
- Produces: `documentVerify: JobHandler` registered as `handlers["document.verify"]`. Returns `DocumentVerifyResult`. Sets the document to `verifying` at start and to `stored` (with `content_sha256`, `size_bytes`, `stored_at`) or `rejected` (with `rejection_code`) at the end.

- [ ] **Step 1: Failing test**

`apps/worker/test/document-verify.test.ts`:
```ts
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { documentVerify } from "../src/jobs/document-verify.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify }); });
afterAll(() => ctx.close());

async function seedDocument(workspaceId: string, userId: string, state: "uploaded" = "uploaded") {
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "x.pdf", declaredSize: 100, declaredMime: "application/pdf", storageKey, state, createdByUserId: userId,
  });
  return { id, storageKey };
}

async function verify(workspaceId: string, docId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: docId });
  const res = await runJob(ctx, JobTypes.DOCUMENT_VERIFY, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, docId));
  return { res, job: job!, doc: doc! };
}

describe("document.verify", () => {
  it("stores a valid PDF with its full sha256 and size", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    const bytes = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj << >> endobj\n%%EOF");
    await ctx.store.put(storageKey, bytes, "application/pdf");
    const { res, job, doc } = await verify(workspaceId, id);
    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("stored");
    expect(doc.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(doc.sizeBytes).toBe(bytes.length);
    expect(doc.storedAt).not.toBeNull();
    expect(job.result).toEqual({ outcome: "stored", sha256: doc.contentSha256, sizeBytes: bytes.length });
  });

  it("rejects a non-PDF as NOT_A_PDF and the job still succeeds", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    await ctx.store.put(storageKey, new TextEncoder().encode("hello world"), "text/plain");
    const { job, doc } = await verify(workspaceId, id);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("NOT_A_PDF");
    expect(job.result).toEqual({ outcome: "rejected", code: "NOT_A_PDF" });
  });

  it("rejects a missing object as OBJECT_MISSING", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id } = await seedDocument(workspaceId, userId);
    const { job, doc } = await verify(workspaceId, id);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("OBJECT_MISSING");
  });

  it("rejects an object over the limit as TOO_LARGE", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    const big = new Uint8Array(ctx.env.MAX_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-"), 0);
    await ctx.store.put(storageKey, big, "application/pdf");
    const { doc } = await verify(workspaceId, id);
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("TOO_LARGE");
  });

  it("fails the attempt when the document row is missing", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID(), maxAttempts: 1 });
    const res = await runJob(ctx, JobTypes.DOCUMENT_VERIFY, jobId);
    expect(res.status).toBe(200);
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    expect(job!.state).toBe("failed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @maester/worker test -- document-verify`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the handler**

`apps/worker/src/jobs/document-verify.ts`:
```ts
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DocumentVerifyResult, RejectionCode } from "@maester/contracts";
import { schema } from "@maester/db";
import { ObjectNotFoundError } from "@maester/storage";
import type { JobHandler } from "./types.js";

const PDF_MAGIC = Buffer.from("%PDF-");

export const documentVerify: JobHandler = async (job, ctx) => {
  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new Error(`document ${job.subjectId} not found in workspace ${job.workspaceId}`);
  if (doc.state === "stored" || doc.state === "rejected") {
    return doc.state === "stored"
      ? ({ outcome: "stored", sha256: doc.contentSha256!, sizeBytes: doc.sizeBytes! } satisfies DocumentVerifyResult)
      : ({ outcome: "rejected", code: doc.rejectionCode as RejectionCode } satisfies DocumentVerifyResult);
  }

  await ctx.db.update(schema.document).set({ state: "verifying", updatedAt: sql`now()` }).where(eq(schema.document.id, doc.id));
  await ctx.progress({ stage: "hashing", percent: 0 });

  const reject = async (code: RejectionCode): Promise<DocumentVerifyResult> => {
    await ctx.db
      .update(schema.document)
      .set({ state: "rejected", rejectionCode: code, updatedAt: sql`now()` })
      .where(eq(schema.document.id, doc.id));
    ctx.logger.info({ documentId: doc.id, code }, "document rejected");
    return { outcome: "rejected", code };
  };

  let stream;
  try {
    stream = await ctx.store.readStream(doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return reject("OBJECT_MISSING");
    throw err;
  }

  const hash = createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > ctx.env.MAX_UPLOAD_BYTES) {
      stream.destroy();
      return reject("TOO_LARGE");
    }
    if (head.length < PDF_MAGIC.length) head = Buffer.concat([head, buf]).subarray(0, PDF_MAGIC.length);
    hash.update(buf);
  }
  if (!head.equals(PDF_MAGIC)) return reject("NOT_A_PDF");

  const sha256 = hash.digest("hex");
  await ctx.db
    .update(schema.document)
    .set({ state: "stored", contentSha256: sha256, sizeBytes: size, storedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.document.id, doc.id));
  await ctx.progress({ stage: "stored", percent: 100 });
  ctx.logger.info({ documentId: doc.id, sizeBytes: size }, "document stored");
  return { outcome: "stored", sha256, sizeBytes: size } satisfies DocumentVerifyResult;
};
```

Modify `apps/worker/src/jobs/index.ts`:
```ts
import { JobTypes } from "@maester/contracts";
import { documentVerify } from "./document-verify.js";
import type { JobHandler } from "./types.js";

export const handlers: Record<string, JobHandler> = {
  [JobTypes.DOCUMENT_VERIFY]: documentVerify,
};
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @maester/worker test && pnpm --filter @maester/worker lint && pnpm --filter @maester/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): document.verify job hashes uploads and stores or rejects them"
```

---

### Task 12: Development upload page and end-to-end smoke script

**Files:**
- Create: `apps/api/src/routes/dev.ts`, `scripts/smoke-upload.ts`, `.env.example` (append TypeScript section)
- Modify: `apps/api/src/app.ts` (mount `/dev/upload` when not production), root `package.json` (`smoke` script)
- Test: `apps/api/test/dev.test.ts`

**Interfaces:**
- Produces: `GET /dev/upload` returning an HTML page (only when `NODE_ENV !== "production"`); `pnpm smoke` running the full flow against a running API and worker.

- [ ] **Step 1: Failing test**

`apps/api/test/dev.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

const deps = (env: ReturnType<typeof testEnv>) =>
  ({ env, logger: silentLogger, db: null as never, auth: null as never, store: null as never, dispatcher: null as never });

describe("dev upload page", () => {
  it("is served outside production", async () => {
    const res = await createApp(deps(testEnv())).request("/dev/upload");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("EventSource");
  });

  it("is absent in production", async () => {
    const res = await createApp(deps(testEnv({ NODE_ENV: "production" }))).request("/dev/upload");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @maester/api test -- dev`
Expected: FAIL (404 in the first test).

- [ ] **Step 3: Implement the page**

`apps/api/src/routes/dev.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv } from "../app.js";

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Maester dev upload</title>
<style>body{font:14px system-ui;margin:2rem;max-width:720px}pre{background:#f4f4f4;padding:.5rem;overflow:auto}label{display:block;margin:.5rem 0}</style>
<h1>Maester dev upload</h1>
<fieldset><legend>1. Session</legend>
<label>Email <input id="email" value="dev@example.com"></label>
<label>Password <input id="password" type="password" value="correct-horse-battery"></label>
<button id="signup">Sign up</button> <button id="signin">Sign in</button> <span id="who"></span>
</fieldset>
<fieldset><legend>2. Upload</legend>
<input type="file" id="file" accept="application/pdf"> <button id="upload">Upload and verify</button>
</fieldset>
<h3>Log</h3><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + "\\n"; };
const j = async (url, body) => {
  const res = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status + ' ' + JSON.stringify(data));
  return data;
};
let workspaceId = null;
async function me() { const m = await j('/v1/me'); workspaceId = m.workspaces[0].id; document.getElementById('who').textContent = m.user.email + ' / ' + workspaceId; }
document.getElementById('signup').onclick = async () => {
  await j('/api/auth/sign-up/email', { name: 'Dev', email: email.value, password: password.value }); await me(); log('signed up');
};
document.getElementById('signin').onclick = async () => {
  await j('/api/auth/sign-in/email', { email: email.value, password: password.value }); await me(); log('signed in');
};
document.getElementById('upload').onclick = async () => {
  const f = document.getElementById('file').files[0]; if (!f) return log('choose a file');
  const created = await j('/v1/workspaces/' + workspaceId + '/documents/uploads', { originalName: f.name, size: f.size, mimeType: 'application/pdf' });
  log('document ' + created.document.id);
  const put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: f });
  if (!put.ok) return log('PUT failed ' + put.status);
  const fin = await j('/v1/workspaces/' + workspaceId + '/documents/' + created.document.id + '/finalize', {});
  log('job ' + fin.job.id + ' ' + fin.job.state);
  const es = new EventSource('/v1/workspaces/' + workspaceId + '/jobs/' + fin.job.id + '/events', { withCredentials: true });
  es.addEventListener('job', (e) => { const job = JSON.parse(e.data); log('job ' + job.state + ' ' + JSON.stringify(job.progress)); });
  es.addEventListener('done', async () => { es.close(); const d = await j('/v1/workspaces/' + workspaceId + '/documents/' + created.document.id); log('document ' + d.state + ' sha256=' + d.contentSha256 + ' rejection=' + d.rejectionCode); });
};
</script>`;

export function devRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/upload", (c) => c.html(PAGE));
  return r;
}
```

Modify `apps/api/src/app.ts`, after `/healthz`:
```ts
  if (deps.env.NODE_ENV !== "production") app.route("/dev", devRoutes());
```

Note: the dev page is served from the API origin itself, so cookies are first-party and no CORS is involved. The GCS bucket needs a CORS rule for `PUT` from the API origin for the browser upload to work (configured in Task 13's bootstrap).

- [ ] **Step 4: Smoke script**

`scripts/smoke-upload.ts` (run with `pnpm smoke path/to/file.pdf`; requires API and worker running locally against a real dev bucket):
```ts
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const API = process.env.API_URL ?? "http://localhost:8787";
const file = process.argv[2];
if (!file) throw new Error("usage: pnpm smoke <file.pdf>");
const email = `smoke-${Date.now()}@example.com`;
const password = "correct-horse-battery";
let cookie = "";

async function call(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", origin: API, cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data as never;
}

await call("/api/auth/sign-up/email", { name: "Smoke", email, password });
const me = (await call("/v1/me")) as { workspaces: { id: string }[] };
const ws = me.workspaces[0]!.id;
const bytes = await readFile(file);
const created = (await call(`/v1/workspaces/${ws}/documents/uploads`, { originalName: basename(file), size: bytes.length, mimeType: "application/pdf" })) as {
  document: { id: string }; upload: { url: string; headers: Record<string, string> };
};
const put = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: bytes });
if (!put.ok) throw new Error(`PUT failed ${put.status} ${await put.text()}`);
const fin = (await call(`/v1/workspaces/${ws}/documents/${created.document.id}/finalize`, {})) as { job: { id: string } };
console.log("job", fin.job.id);

for (let i = 0; i < 60; i++) {
  const job = (await call(`/v1/workspaces/${ws}/jobs/${fin.job.id}`)) as { state: string; progress: unknown };
  console.log(job.state, JSON.stringify(job.progress));
  if (["succeeded", "failed", "cancelled"].includes(job.state)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const doc = (await call(`/v1/workspaces/${ws}/documents/${created.document.id}`)) as { state: string; contentSha256: string | null; rejectionCode: string | null };
console.log("document", doc.state, doc.contentSha256, doc.rejectionCode);
if (doc.state !== "stored") process.exit(1);
```

Root `package.json` scripts: add `"smoke": "tsx scripts/smoke-upload.ts"` and `tsx` to root devDependencies.

Append to `.env.example`:
```ini

# ---- TypeScript services (apps/api, apps/worker) ----
NODE_ENV=development
DATABASE_URL=postgres://maester:maester@localhost:5433/maester
BETTER_AUTH_SECRET=change-me-to-a-random-string-of-at-least-32-chars
BETTER_AUTH_URL=http://localhost:8787
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8787
GCS_BUCKET=your-private-dev-bucket
GOOGLE_CLOUD_LOCATION=asia-south1
DISPATCH_MODE=local
DISPATCH_SECRET=local-dispatch-secret
WORKER_URL=http://localhost:8788
API_PORT=8787
WORKER_PORT=8788
```
Note: `apps/api` reads `PORT`; when running both locally, start them as `PORT=8787 pnpm dev:api` and `PORT=8788 pnpm dev:worker`. The API and worker load `.env` from the repository root via `tsx --env-file=../../.env` — update both `dev` scripts to `tsx watch --env-file=../../.env src/server.ts`.

- [ ] **Step 5: Run tests, then the manual smoke**

Run: `pnpm --filter @maester/api test && pnpm --filter @maester/api lint && pnpm --filter @maester/api typecheck`
Expected: PASS.

Manual (requires `gcloud auth application-default login` and a dev bucket):
```bash
pnpm db:up && pnpm --filter @maester/db migrate
PORT=8787 pnpm dev:api &
PORT=8788 pnpm dev:worker &
pnpm smoke path/to/any.pdf
```
Expected: the script prints `queued`/`running`/`succeeded` and finally `document stored <sha256> null`, exit 0. Record the result in the commit message body.

- [ ] **Step 6: Commit**

```bash
git add apps/api scripts/smoke-upload.ts .env.example package.json pnpm-lock.yaml
git commit -m "feat(api): dev upload page and end-to-end smoke script"
```

---

### Task 13: Containers, GCP bootstrap, deploy script, CI

**Files:**
- Create: `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `.dockerignore`, `infra/bootstrap.sh`, `infra/deploy.sh`, `infra/README.md`, `.github/workflows/ts.yml`

**Interfaces:**
- Consumes: `pnpm build` outputs `apps/api/dist/{server,migrate}.js` and `apps/worker/dist/server.js`; `packages/db/drizzle/` migration folder.
- Produces: images `asia-south1-docker.pkg.dev/$PROJECT/maester/api` and `.../worker`; Cloud Run services `maester-api`, `maester-worker`; Cloud Run job `maester-migrate`; GitHub Actions `ts.yml`.

- [ ] **Step 1: Dockerfiles**

`.dockerignore`:
```gitignore
**/node_modules
**/dist
**/.turbo
.git
.venv
.uv-cache
data
docs
tests
*.md
```

`apps/api/Dockerfile`:
```dockerfile
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker/package.json ./apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @maester/api...
RUN pnpm --filter @maester/api build
RUN pnpm --filter @maester/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
RUN useradd -m app
WORKDIR /app
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/packages/db/drizzle ./drizzle
ENV MIGRATIONS_FOLDER=/app/drizzle
USER app
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

`apps/worker/Dockerfile`: identical but with `@maester/worker`, `COPY apps/worker ./apps/worker`, `COPY apps/api/package.json ./apps/api/package.json`, and no `drizzle`/`MIGRATIONS_FOLDER` lines.

Cloud Run sets `PORT=8080`; both servers already read `PORT`.

Verify locally:
```bash
docker build -f apps/api/Dockerfile -t maester-api:local .
docker build -f apps/worker/Dockerfile -t maester-worker:local .
docker run --rm -e DATABASE_URL=postgres://x -e BETTER_AUTH_SECRET=0123456789012345678901234567890123 -e BETTER_AUTH_URL=http://localhost -e GCS_BUCKET=b -e GOOGLE_CLOUD_PROJECT=p -e WORKER_URL=http://w -e DISPATCH_SECRET=s -e PORT=8080 -p 8080:8080 maester-api:local &
sleep 3 && curl -s localhost:8080/healthz && kill %1
```
Expected: both images build; `{"status":"ok"}`.

- [ ] **Step 2: Bootstrap script**

`infra/bootstrap.sh` (idempotent; every command tolerates "already exists"):
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-south1}"
BUCKET="${BUCKET:-maester-private-${PROJECT}}"
QUEUE="${QUEUE:-maester-jobs}"
SQL_INSTANCE="${SQL_INSTANCE:-maester-pg}"
DB_NAME="${DB_NAME:-maester}"
REPO="${REPO:-maester}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173}"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com sqladmin.googleapis.com storage.googleapis.com \
  cloudtasks.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com cloudbuild.googleapis.com

# Artifact Registry
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"

# Service accounts
for SA in maester-api maester-worker maester-migrate; do
  gcloud iam service-accounts describe "$SA@$PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$SA" --display-name="$SA"
done
API_SA="maester-api@$PROJECT.iam.gserviceaccount.com"
WORKER_SA="maester-worker@$PROJECT.iam.gserviceaccount.com"
MIGRATE_SA="maester-migrate@$PROJECT.iam.gserviceaccount.com"

# Cloud SQL (Postgres 16, smallest tier; resize later)
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --region="$REGION" \
    --tier=db-g1-small --storage-auto-increase --availability-type=zonal
gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
for SA in "$API_SA" "$WORKER_SA" "$MIGRATE_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/cloudsql.client" --condition=None >/dev/null
done

# Bucket: private, uniform access, versioning, CORS for browser PUTs
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --versioning
ORIGINS_JSON=$(printf '%s' "$ALLOWED_ORIGINS" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?",":""), $i}}')
cat > /tmp/cors.json <<EOF_CORS
[{"origin":[${ORIGINS_JSON}],"method":["PUT"],"responseHeader":["Content-Type","Content-Length"],"maxAgeSeconds":3600}]
EOF_CORS
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/cors.json
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$API_SA" --role="roles/storage.objectUser" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$WORKER_SA" --role="roles/storage.objectViewer" >/dev/null
# API signs V4 URLs via IAM signBlob on its own identity
gcloud iam service-accounts add-iam-policy-binding "$API_SA" --member="serviceAccount:$API_SA" --role="roles/iam.serviceAccountTokenCreator" >/dev/null

# Cloud Tasks queue
gcloud tasks queues describe "$QUEUE" --location="$REGION" >/dev/null 2>&1 || \
  gcloud tasks queues create "$QUEUE" --location="$REGION"
gcloud tasks queues update "$QUEUE" --location="$REGION" --max-attempts=5 --min-backoff=10s --max-backoff=300s --max-concurrent-dispatches=20
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$API_SA" --role="roles/cloudtasks.enqueuer" --condition=None >/dev/null
# API may mint OIDC tokens as the worker invoker (itself) when creating tasks
gcloud iam service-accounts add-iam-policy-binding "$API_SA" --member="serviceAccount:$API_SA" --role="roles/iam.serviceAccountUser" >/dev/null

# Secrets (values set manually afterwards)
for S in DATABASE_URL BETTER_AUTH_SECRET; do
  gcloud secrets describe "$S" >/dev/null 2>&1 || gcloud secrets create "$S" --replication-policy=automatic
done
for SA in "$API_SA" "$WORKER_SA" "$MIGRATE_SA"; do
  gcloud secrets add-iam-policy-binding DATABASE_URL --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null
done
gcloud secrets add-iam-policy-binding BETTER_AUTH_SECRET --member="serviceAccount:$API_SA" --role="roles/secretmanager.secretAccessor" >/dev/null

echo "bootstrap complete. Next: add secret versions:"
echo "  printf '%s' 'postgres://USER:PASS@localhost/$DB_NAME?host=/cloudsql/$PROJECT:$REGION:$SQL_INSTANCE' | gcloud secrets versions add DATABASE_URL --data-file=-"
echo "  openssl rand -base64 48 | gcloud secrets versions add BETTER_AUTH_SECRET --data-file=-"
```

- [ ] **Step 3: Deploy script**

`infra/deploy.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-south1}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
REPO="${REPO:-maester}"
BUCKET="${BUCKET:-maester-private-${PROJECT}}"
QUEUE="${QUEUE:-maester-jobs}"
SQL_INSTANCE="${SQL_INSTANCE:-maester-pg}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:?set ALLOWED_ORIGINS}"
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/$REPO"
API_SA="maester-api@$PROJECT.iam.gserviceaccount.com"
WORKER_SA="maester-worker@$PROJECT.iam.gserviceaccount.com"
MIGRATE_SA="maester-migrate@$PROJECT.iam.gserviceaccount.com"
SQL_CONN="$PROJECT:$REGION:$SQL_INSTANCE"

gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker build -f apps/api/Dockerfile -t "$REGISTRY/api:$TAG" .
docker build -f apps/worker/Dockerfile -t "$REGISTRY/worker:$TAG" .
docker push "$REGISTRY/api:$TAG"
docker push "$REGISTRY/worker:$TAG"

# 1. migrations (Cloud Run job, same API image, different command)
if gcloud run jobs describe maester-migrate --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update maester-migrate --region="$REGION" --image="$REGISTRY/api:$TAG" \
    --command=node --args=dist/migrate.js --service-account="$MIGRATE_SA" \
    --set-cloudsql-instances="$SQL_CONN" --set-secrets=DATABASE_URL=DATABASE_URL:latest
else
  gcloud run jobs create maester-migrate --region="$REGION" --image="$REGISTRY/api:$TAG" \
    --command=node --args=dist/migrate.js --service-account="$MIGRATE_SA" \
    --set-cloudsql-instances="$SQL_CONN" --set-secrets=DATABASE_URL=DATABASE_URL:latest
fi
gcloud run jobs execute maester-migrate --region="$REGION" --wait

# 2. worker (internal ingress; only the API SA may invoke)
gcloud run deploy maester-worker --region="$REGION" --image="$REGISTRY/worker:$TAG" \
  --service-account="$WORKER_SA" --no-allow-unauthenticated --ingress=internal \
  --set-cloudsql-instances="$SQL_CONN" --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-env-vars="NODE_ENV=production,GCS_BUCKET=$BUCKET,DISPATCH_MODE=cloud-tasks,API_SERVICE_ACCOUNT_EMAIL=$API_SA" \
  --timeout=900 --concurrency=4 --min-instances=0 --max-instances=10
WORKER_URL=$(gcloud run services describe maester-worker --region="$REGION" --format='value(status.url)')
gcloud run services update maester-worker --region="$REGION" --update-env-vars="WORKER_URL=$WORKER_URL"
gcloud run services add-iam-policy-binding maester-worker --region="$REGION" --member="serviceAccount:$API_SA" --role="roles/run.invoker" >/dev/null

# 3. api (public)
gcloud run deploy maester-api --region="$REGION" --image="$REGISTRY/api:$TAG" \
  --service-account="$API_SA" --allow-unauthenticated \
  --set-cloudsql-instances="$SQL_CONN" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest \
  --set-env-vars="NODE_ENV=production,GCS_BUCKET=$BUCKET,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=$REGION,DISPATCH_MODE=cloud-tasks,CLOUD_TASKS_QUEUE=$QUEUE,WORKER_URL=$WORKER_URL,WORKER_INVOKER_SA=$API_SA,ALLOWED_ORIGINS=$ALLOWED_ORIGINS" \
  --timeout=1800 --concurrency=80 --min-instances=0 --max-instances=10
API_URL=$(gcloud run services describe maester-api --region="$REGION" --format='value(status.url)')
gcloud run services update maester-api --region="$REGION" --update-env-vars="BETTER_AUTH_URL=$API_URL"
echo "api: $API_URL"
echo "worker: $WORKER_URL"
```

`infra/README.md`: one paragraph each on prerequisites (`gcloud` authenticated with owner on the project, Docker), running `PROJECT=... ./infra/bootstrap.sh` once, adding the two secret versions it prints, then `PROJECT=... ALLOWED_ORIGINS=https://app.example ./infra/deploy.sh`. Note that Cloud Tasks with an OIDC token to an internal-ingress Cloud Run service works because Cloud Tasks traffic is treated as internal.

Make both scripts executable: `chmod +x infra/*.sh`.

- [ ] **Step 4: CI workflow**

`.github/workflows/ts.yml`:
```yaml
name: typescript

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: maester
          POSTGRES_PASSWORD: maester
          POSTGRES_DB: maester_test
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U maester"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
        env:
          DATABASE_URL_TEST: postgres://maester:maester@localhost:5433/maester_test
      - run: pnpm build

  deploy:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: check
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: ./infra/deploy.sh
        env:
          PROJECT: ${{ secrets.GCP_PROJECT }}
          ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS }}
```

The deploy job needs repository secrets `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_PROJECT` and a variable `ALLOWED_ORIGINS`. Until those exist the job fails on `main`; document that in `infra/README.md`.

- [ ] **Step 5: Verify**

Run: `docker build -f apps/api/Dockerfile -t maester-api:local . && docker build -f apps/worker/Dockerfile -t maester-worker:local . && bash -n infra/bootstrap.sh && bash -n infra/deploy.sh`
Expected: images build; scripts parse.

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile apps/worker/Dockerfile .dockerignore infra .github/workflows/ts.yml
git commit -m "chore: dockerfiles, gcp bootstrap and deploy scripts, typescript CI"
```

---

### Task 14: Documentation and ADR 0002

**Files:**
- Create: `docs/decisions/0002-typescript-backend.md`, `packages/contracts/README.md`, `packages/financial-engine-ts/package.json`, `packages/financial-engine-ts/README.md`
- Modify: `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `README.md`, `apps/api/README.md`, `apps/worker/README.md`, `apps/web/README.md`, `docs/README.md` (link the ADR)

- [ ] **Step 1: ADR 0002**

`docs/decisions/0002-typescript-backend.md`:
```markdown
# ADR 0002: TypeScript backend on Cloud Run

## Status

Accepted on 10 September 2026. Supersedes the Python API/worker and Next.js proposals in ADR 0001 and `ARCHITECTURE.md` sections 2–4.

## Context

The Python engine is small (about 250 lines: one Gemini call, a subtotal checker, a JSON cache). The project owner prefers TypeScript, the frontend is Svelte, and the hosted product needs an API, durable workers and shared request/response types. ADR 0001 planned to generate TypeScript from a Python OpenAPI document; that pipeline exists only because the languages would differ.

## Decision

- The hosted backend is TypeScript on Node 22: `apps/api` (Hono) and `apps/worker` (Hono, Cloud Tasks target), deployed as Cloud Run services on GCP. Vercel is not used for hosting anywhere.
- `packages/contracts` (Zod) is the single authority for API types. There is no OpenAPI code generation. The Svelte frontend imports contracts directly.
- Authentication is Better Auth with email/password, sessions in Postgres, cookies first-party to the API origin.
- PostgreSQL on Cloud SQL via Drizzle; private objects in GCS; durable job dispatch via Cloud Tasks with Postgres leasing; real-time delivery via Server-Sent Events.
- The frontend is SvelteKit/Svelte, owned separately; it may join the pnpm workspace as `apps/web`.
- The Python CLI and engine are frozen as reference behaviour until the TypeScript extraction pipeline reproduces them, then retired.

## Alternatives considered

Python FastAPI plus OpenAPI codegen (rejected: two toolchains for one developer and an extra generation step). Vercel-hosted Next.js with Vercel Workflow (rejected: owner excludes Vercel). A single Node process with an in-process queue (rejected: Cloud Tasks gives retries and worker autoscaling with no queue to operate).

## Consequences

Financial arithmetic will use decimal.js instead of Python's Decimal. Heavy local PDF processing (OCR, layout analysis), if ever needed, becomes a Python sidecar behind HTTP rather than a rewrite. Two lockfiles remain intentional until the Python members are retired.
```

- [ ] **Step 2: Contracts README (frontend integration guide)**

`packages/contracts/README.md` must contain, with concrete JSON examples that match the schemas:
1. **Origins and cookies**: the API sets an `HttpOnly` cookie named `maester.session_token`; browsers must send `credentials: "include"`; allowed origins are configured server-side (`ALLOWED_ORIGINS`); the local Vite origin `http://localhost:5173` is allowed by default in `.env.example`.
2. **Auth endpoints**: `POST /api/auth/sign-up/email {name,email,password}`, `POST /api/auth/sign-in/email {email,password}`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`; note that Better Auth's Svelte client (`better-auth/svelte`) wraps these.
3. **Error envelope** and the code table with HTTP statuses (copy from Task 5's `STATUS` map).
4. **Routes table** (copy from the spec, section 8) with one request/response example each.
5. **Upload sequence**: create upload → PUT bytes to `upload.url` with exactly `upload.headers` → finalize → subscribe to SSE → read document.
6. **SSE format**: `event: job` / `data: <Job JSON>`, `: ping` comments, `event: done`; reconnect strategy (re-open the stream; state is resent in full).
7. **Pagination**: `?cursor=&limit=` and `{ items, nextCursor }`.
8. **Types**: `import { Document, Job, ApiError } from "@maester/contracts"` for both the Zod schemas and the inferred types.

Add a test `packages/contracts/test/readme-examples.test.ts` that extracts every fenced ` ```json ` block preceded by a line `<!-- schema: <ExportName> -->` from the README and parses it with that exported schema. Write the README examples with those marker comments so the test has something to check.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const pattern = /<!-- schema: (\w+) -->\s*```json\n([\s\S]*?)```/g;
const cases = [...readme.matchAll(pattern)].map((m) => ({ name: m[1]!, json: m[2]! }));

describe("README examples", () => {
  it("has at least one example", () => expect(cases.length).toBeGreaterThan(0));
  for (const c of cases) {
    it(`${c.name} example parses`, () => {
      const schema = (contracts as Record<string, unknown>)[c.name] as { parse: (v: unknown) => unknown };
      expect(schema, `no export named ${c.name}`).toBeDefined();
      expect(() => schema.parse(JSON.parse(c.json))).not.toThrow();
    });
  }
});
```

- [ ] **Step 3: Placeholder engine package**

`packages/financial-engine-ts/package.json`:
```json
{
  "name": "@maester/financial-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "lint": "eslint .", "typecheck": "tsc -p tsconfig.json" },
  "devDependencies": { "@maester/config": "workspace:*", "@types/node": "^22.0.0", "eslint": "^9.30.0", "typescript": "^5.9.0" }
}
```
`src/index.ts`: `export const ENGINE_VERSION = "0.0.0";` plus `tsconfig.json`/`eslint.config.js` as in contracts. `README.md`: two sentences stating the extraction pipeline will live here and that the Python package at `packages/financial-engine` is the frozen reference.

- [ ] **Step 4: Update existing docs**

- `docs/ARCHITECTURE.md`: rewrite section 1 to describe the implemented TypeScript base; replace section 2's tree with the plan's file structure (keep Python members listed as frozen); in section 3 replace "Python schemas are the authority…generate TypeScript" with "`packages/contracts` is the authority; the web app imports it"; in section 4 change "FastAPI API" to "Hono API on Cloud Run", keep the flow diagram; in section 10 add a paragraph "R0.5 base" summarising what now runs; update the FastAPI footnote to Hono documentation.
- `docs/DEVELOPMENT.md`: add a "TypeScript workflow" section: `pnpm install`, `pnpm db:up`, `pnpm --filter @maester/db migrate`, `PORT=8787 pnpm dev:api`, `PORT=8788 pnpm dev:worker`, `/dev/upload`, `pnpm smoke`, `pnpm lint/typecheck/test`, migrations via `pnpm --filter @maester/db generate` after schema edits.
- `README.md`: "What works today" gains bullets for sign-in/workspaces, private uploads with verification, durable jobs with SSE progress; repository layout updated; quick start gains the pnpm commands; "not implemented yet" text no longer claims there is no API or worker.
- `apps/api/README.md`, `apps/worker/README.md`: status "implemented (base)", the routes/handlers they own, env vars, and how to run.
- `apps/web/README.md`: state that the Svelte app is owned by the project owner, consumes `@maester/contracts`, and joins the workspace by adding a `package.json` here.
- `docs/README.md`: link ADR 0002 and the spec/plan under `docs/superpowers/`.

- [ ] **Step 5: Verify**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && uv run --locked python scripts/check_workspace.py`
Expected: all PASS, including the README example test and the existing Python documentation-link check (it validates relative links in docs; fix any broken link it reports).

- [ ] **Step 6: Commit**

```bash
git add docs README.md apps/api/README.md apps/worker/README.md apps/web/README.md packages/contracts/README.md packages/contracts/test packages/financial-engine-ts pnpm-lock.yaml
git commit -m "docs: ADR 0002 typescript backend, frontend integration guide, updated architecture"
```

---

## Plan self-review notes

- **Spec coverage.** Sections 3 (layout) → Tasks 1, 2, 3, 4, 14; 4 (auth) → Task 6; 5 (database) → Task 3; 6 (jobs) → Tasks 7, 10; 7 (upload + verify) → Tasks 8, 11; 8 (API conventions, SSE, dev page) → Tasks 5, 8, 9, 12; 9 (contracts + README) → Tasks 2, 14; 10 (deployment, local dev) → Tasks 1, 12, 13; 11 (observability) → Tasks 5, 10 (pino with severity, traceId, jobId, no bodies logged); 12 (testing) → every task; 13 (docs) → Task 14.
- **Deviations from the spec, recorded here and to be mirrored into the spec:** a `packages/storage` package holds the `ObjectStore` interface (the spec placed it implicitly in the worker; both apps need it). Cloud Run is deployed by `infra/deploy.sh` with `gcloud run deploy` flags instead of service YAML files. The Better Auth `user.create.after` hook runs after the user transaction commits, so `ensurePersonalWorkspace` is its own idempotent transaction rather than part of the user insert. Cloud Tasks task names are `{jobId}-{attempt}` so a retry after a failed run does not collide with the earlier task name.
- **Type consistency checked:** `createJob(db, dispatcher, input)` is used identically in Tasks 7, 8, 9; `runJob(deps, type, jobId)` in Tasks 10, 11; `toDocument(row, latestJob)` in Tasks 6, 8; `JobTypes.DOCUMENT_VERIFY` everywhere; `RecordingDispatcher.enqueued` in Tasks 6–9; `MemoryObjectStore.put(key, bytes, contentType)` in Tasks 4, 8, 11.
