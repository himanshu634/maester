# MCP server M1 (facts and search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only stdio MCP server, `apps/mcp`, that gives an agent the investor's companies, filings, statements, facts and text search, every figure with its lineage, and refuses every calculation until M2.

**Architecture:** The API's inline route bodies become exported loaders in `apps/api/src/read/`, which both the routes and `apps/mcp` call. `apps/mcp` holds tools (input schema, description, handler) and pure presenters (contract types → agent shapes). It reads Postgres through a read-only pool, for one workspace fixed at start, and logs to stderr only.

**Tech Stack:** TypeScript (ESM, Node 22), `@modelcontextprotocol/sdk` ^1.32 (zod 4 peer), zod ^4.1, drizzle/pg through `@maester/db`, pino, vitest ^4.1, tsup.

**Spec:** [MCP server design](../specs/2026-10-21-mcp-server-design.md). Background: [financial data layer](../specs/2026-10-15-financial-data-layer-design.md) §8.2 and §10, [ADR 0006](../../decisions/0006-concepts-calculations-agent-access.md).

**Base:** branch `feat/mcp-server` from `feat/ingestion-phases-2-6` (#19), PR into it; retarget to `staging` once #19 merges.

## Global Constraints

- Read-only: no tool writes; the pool sets `default_transaction_read_only=on`.
- One workspace: `MAESTER_WORKSPACE_ID`, else the first workspace of `MAESTER_USER_EMAIL`; every query takes it.
- Figures are decimal strings copied from the read functions. `apps/mcp/src` never parses one: `Number(`, `parseFloat`, `parseInt` on figures and `decimal.js` are banned there by lint.
- Unknown is `null` with its reason in words, never `0` or `""`.
- Every figure carries `fact_id`, source (filing name and document id; 1-based `page` with `of`, or XBRL `element`, `context`, `decimals`), basis, unit label, scale, currency, span and period.
- XBRL-in-PDF results are shown as "not checked" while `XBRL_IN_PDF_RESULT_SHOWN` is `false`.
- stdout carries MCP protocol only. Logs: pino to stderr, one line per call with tool, duration, item count and error code; never arguments, results or document text.
- Errors: `isError: true` results with `code` (`NOT_FOUND`, `INVALID_INPUT`, `SEARCH_UNAVAILABLE`, `UNAVAILABLE`) and one sentence; an id from another workspace gets the same `NOT_FOUND` as a missing one.
- `search_filings`: `limit` default 8, max 20; the fixed `figures` sentence: "Passages are context. A number in a passage is not a figure Maester has read or checked; use get_statement or get_fact for figures."
- `list_metrics` in M1 answers `metrics: []` and: "Maester has no named calculations yet. Do not work out growth, margins, ratios or any other figure from the facts; say that Maester cannot calculate it yet."
- No paid model call in any test. No `docker compose up` in a worktree: tests use the `--rm` test Postgres on port 5433, database `maester_test_mcp`.
- Commits end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A company with no annual report read, or a basis with no table:** `get_statement` says so in words and names the bases that exist; it must not return an empty table that reads as "no figures". Test in Task 7.
- **A fact from an older revision of the same document** (the filing was read again): `get_fact` still answers, marked `superseded: "read again on <date>"`, and its `in_table` points to the current reading. Test in Task 7.
- **A value with trailing zeros or a negative sign** (`"-1234.50"`, `"0.00"`): copied untouched into every shape. Test in Task 5.
- **The embedder comes up after the server** (TEI's 120 s start): the first search fails `SEARCH_UNAVAILABLE`, a later one succeeds without a restart. Test in Task 3.
- **A UUID-shaped id that is malformed in case or has spaces**, and a non-UUID: `INVALID_INPUT`, not `UNAVAILABLE` and not a stack. Test in Task 9.

---

### Task 1: Scaffold `apps/mcp` and confirm the SDK

**Files:**
- Create: `apps/mcp/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `src/settings.ts`, `src/server.ts`, `src/main.ts`, `test/settings.test.ts`, `test/server.test.ts`
- Modify: `pnpm-workspace.yaml` (add `apps/mcp`), `scripts/db/init.sql` and `.github/workflows/ts.yml` (create `maester_test_mcp`; pass `DATABASE_URL_TEST_MCP`)

**Interfaces:**
- Produces: `loadSettings(env: NodeJS.ProcessEnv): Settings` with `Settings = { databaseUrl: string; workspaceId: string | null; userEmail: string | null; embedderUrl: string | null; embeddingModel: string; xbrlPdfCheck: boolean }` (throws `SettingsError` naming the setting); `createServer(deps: ServerDeps): McpServer` with `ServerDeps = { db: Db; workspace: WorkspaceRow; embedder: Embedder | null; settings: Settings; logger: Logger }`; `main()` in `src/main.ts` wires stdio.

- [ ] **Step 1:** `pnpm add @modelcontextprotocol/sdk@^1.32 zod pino` in `apps/mcp`, workspace deps as `workspace:*` (`@maester/api`, `@maester/contracts`, `@maester/db`, `@maester/document-index`). Package name `@maester/mcp`, scripts as `apps/api`'s (`dev` = `tsx --env-file=../../.env src/main.ts`, `start` = `node dist/main.js`). tsup entry `{ main: "src/main.ts" }` with the API's `noExternal` and `createRequire` banner.
- [ ] **Step 2:** Read the installed SDK's `server/mcp.js`, `server/stdio.js` and `inMemory.js` and write down, in `apps/mcp/README.md`, the names used: the server class, the tool registration call with `inputSchema`/`outputSchema`, `structuredContent`, the server `instructions` option, and the linked in-memory transport pair. Later tasks use exactly these names.
- [ ] **Step 3: Write the failing tests**
  - `settings.test.ts`: `loadSettings({DATABASE_URL, MAESTER_USER_EMAIL: "a@b.c"})` gives `workspaceId: null, userEmail: "a@b.c", embeddingModel: "Snowflake/snowflake-arctic-embed-l-v2.0", xbrlPdfCheck` as the API's default; missing `DATABASE_URL` throws naming `DATABASE_URL`; neither workspace setting throws naming both; a non-UUID `MAESTER_WORKSPACE_ID` throws naming it.
  - `server.test.ts`: a client over the in-memory pair lists tools and gets `[]`; the server's `instructions` contains each of the six answer rules of data-layer §10 (assert on "fact id", "never adds, divides, compares or ranks", "null with its reason", "consolidated and standalone never mix", "unreviewed", "No advice words").
- [ ] **Step 4:** Run `pnpm --filter @maester/mcp test`; expect FAIL (modules missing).
- [ ] **Step 5:** Implement `loadSettings` (zod over the env, parsed the way `apps/api/src/env.ts` parses `EMBEDDER_URL`, `EMBEDDING_MODEL`, `XBRL_PDF_CHECK`), `createServer` with the instructions text in `src/instructions.ts`, and `main()` that loads settings, prints a `SettingsError` as one stderr line and exits 1.
- [ ] **Step 6:** Run test, lint and typecheck for `@maester/mcp`; expect PASS.
- [ ] **Step 7:** Commit `feat(mcp): scaffold apps/mcp with settings and an empty stdio server`.

### Task 2: Extract the read loaders from the API routes

**Files:**
- Create: `apps/api/src/read/index.ts`, `read/financials.ts`, `read/companies.ts`, `read/filings.ts`
- Modify: `apps/api/src/routes/research.ts`, `routes/filings.ts`, `apps/api/package.json` (`"exports": { "./read": "./src/read/index.ts" }`)

**Interfaces:**
- Produces:
  - `loadCompanyFinancials(db: Db, workspaceId: string, companyId: string, opts: { xbrlPdfCheck: boolean }): Promise<CompanyFinancials | null>` (null when the company is not in the workspace). `filingPdfOf` and `counts` move with it.
  - `listResearchCompanies(db: Db, workspaceId: string): Promise<ResearchCompanies>`.
  - `loadWorkspaceFilings(db: Db, workspaceId: string, opts: { embeddingModel: string; xbrlPdfCheck: boolean }): Promise<WorkspaceFilings>`.
  - `read/index.ts` re-exports these three, `toFact`, `toCompany` and `toRevision` from `serialize.ts`. Nothing under `read/` imports `hono`.

- [ ] **Step 1:** Move each handler body into its loader unchanged; the route calls the loader and throws `HttpError("NOT_FOUND", "company not found")` on `null`.
- [ ] **Step 2:** Add `apps/api/test/read-imports.test.ts`: reading every file under `src/read/` finds no `from "hono"` and no `../app.js`.
- [ ] **Step 3:** Run `pnpm --filter @maester/api test`; expect every existing test to PASS with no change to their expectations (`research.test.ts`, `filings.test.ts`, `stitch.test.ts`, `in-pdf.test.ts`, `filings-build.test.ts`).
- [ ] **Step 4:** Commit `refactor(api): read loaders for financials, companies and filings, shared with apps/mcp`.

### Task 3: The served-model gate in `@maester/document-index`

**Files:**
- Create: `packages/document-index/src/gate.ts`, `packages/document-index/test/gate.test.ts`
- Modify: `packages/document-index/src/index.ts`, `apps/api/src/routes/search.ts`

**Interfaces:**
- Produces: `class ServedModelGate { constructor(embedder: Embedder); check(): Promise<{ ok: true } | { ok: false; code: "EMBEDDER_MODEL_MISMATCH" | EmbedderError["code"]; served: string | null }> }`. A success is kept; a failure or mismatch is not, so the next `check()` asks again.

- [ ] **Step 1: Write the failing tests** with `FakeEmbedder` (or a stub whose `servedModel` is scripted): serving the labelled model gives `{ok: true}` and a second `check()` does not call `servedModel` again; serving another model gives `{ok: false, code: "EMBEDDER_MODEL_MISMATCH", served: "<other>"}`; a `servedModel` that throws `EmbedderError("EMBEDDER_UNAVAILABLE", …)` gives that code, and a following call that succeeds gives `{ok: true}` (the TEI-starts-late case from Review Focus).
- [ ] **Step 2:** Run `pnpm --filter @maester/document-index test`; expect FAIL.
- [ ] **Step 3:** Implement with `servesModel`; move the route's comment about TEI starting late onto the class. The search route holds one gate and keeps its log lines and `SEARCH_UNAVAILABLE` answers.
- [ ] **Step 4:** Run document-index and api tests (`search.test.ts` unchanged); expect PASS.
- [ ] **Step 5:** Commit `refactor(search): the served-model check as a gate both the API and apps/mcp hold`.

### Task 4: `getFactWithSource` and a read-only pool in `@maester/db`

**Files:**
- Modify: `packages/db/src/client.ts`, `packages/db/src/queries/extraction.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/fact-lookup.test.ts`, `packages/db/test/client.test.ts`

**Interfaces:**
- Produces:
  - `createDb(connectionString: string, opts?: { readOnly?: boolean; max?: number }): Db`. `readOnly` sets the pool's `options: "-c default_transaction_read_only=on"`; default behaviour unchanged.
  - `getFactWithSource(db: Db, workspaceId: string, factId: string): Promise<FactLookup | null>` with `FactLookup = FactWithSource & { documentId: string; companyId: string | null; revision: ExtractionRevisionRow; isCurrentRevision: boolean; filing: { originalName: string; kind: string | null; periodEnd: string | null; pageCount: number } }`.

- [ ] **Step 1: Write the failing tests**
  - `client.test.ts`: a `readOnly` pool's `INSERT INTO waitlist_entry …` rejects with Postgres code `25006`; a default pool's succeeds.
  - `fact-lookup.test.ts`, seeding two workspaces as the existing db tests do: a page fact returns its `source.pageIndex`, `xbrl: null`, `isCurrentRevision: true`; an XBRL fact returns its `xbrl.element`; the same fact id asked from the other workspace returns `null`; a fact of a revision replaced by a newer one returns `isCurrentRevision: false`; a random UUID returns `null`.
- [ ] **Step 2:** Run `pnpm --filter @maester/db test`; expect FAIL.
- [ ] **Step 3:** Implement: one select joining `financial_fact` → `extraction_revision` → `document` (and the current classification for kind and period), left joins to `source_reference` and `xbrl_source`, every table filtered by `workspaceId`; `isCurrentRevision` compares with `getCurrentRevision`'s rule.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(db): look up one fact by id within a workspace; read-only pools`.

### Task 5: Presenters

**Files:**
- Create: `apps/mcp/src/present/table.ts`, `present/fact.ts`, `present/check.ts`, `present/search.ts`, `present/filings.ts`, `present/words.ts`, `present/flags.ts`
- Modify: `apps/mcp/eslint.config.js` (`no-restricted-syntax` / `no-restricted-imports` for `Number(`, `parseFloat`, `parseInt`, `decimal.js` under `src/`)
- Test: `apps/mcp/test/present.test.ts`

**Interfaces:**
- Consumes: contract types `StatementTable`, `FinancialCell`, `FinancialFact`, `SearchHit`, `WorkspaceFilings`; `FactLookup` (Task 4).
- Produces (all pure; each has a zod output schema exported beside it as `…Schema`):
  - `presentTable(company: Company, filings: CompanyFiling[], table: StatementTable): StatementAnswer`
  - `presentCell(cell: FinancialCell, column: FinancialColumn, unit: TableUnit, filings: CompanyFiling[]): CellAnswer`
  - `presentFact(fact: FinancialFact, filing: FactFiling, extra: { superseded: string | null; inTable: InTableAnswer | null }): FactAnswer`
  - `checkSentence(check: CellCheck, source: CellSource | null): string`
  - `presentHits(hits: SearchHit[]): SearchAnswer` (with the fixed `figures` sentence)
  - `presentFilings(filings: WorkspaceFilings, companyId: string | null): FilingsAnswer`
  - `XBRL_IN_PDF_RESULT_SHOWN = false` in `flags.ts`, with a comment naming `docs/eval/2026-10-21-xbrl-map-v1.md`.

- [ ] **Step 1: Write the failing tests** over fixture values:
  - a page cell with `pageIndex: 212, pageCount: 286` gives `source.page: 213, source.of: 286`; an XBRL cell gives `element`, `context`, `decimals` and no `page`.
  - `value: "-1234.50"` and `"0.00"` come out as the same strings; a `missing` cell gives `value: null, reason: "not printed"`; `unparsed` gives `"not readable"`; `dash` gives `value: null, printed: "–", reason: "a dash printed on the page"`.
  - `checkSentence` for passed is "Adds up"; for a failed subtotal with `expected "1243.00"`, `actual "1234.00"` is exactly "No. The lines add up to 1234.00; the page prints 1243.00."; for a component, "Part of {subject}, which adds up" / "which doesn't add up"; `not_checked` is "Not checked".
  - every XBRL-in-PDF status (`passed`, `failed`) presents as `"not checked"` while the flag is false.
  - rows carry `line: "as printed; no concept mapping yet"`; cells carry `reviewed: "not yet"`, `span: "year"`, and the table's unit label, scale and currency.
  - `presentHits` returns `passages` with `page` (copied, already 1-based) and the `figures` sentence verbatim; `presentFilings(…, companyId)` keeps only that company.
  - `presentFact` gives `reported_value` and `printed` with `unit_label`, `scale`, `currency`, and `in_table.value` only beside `in_table.unit`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Words for states follow `apps/web/src/lib/content/research.ts` where the web has them; the failed-check sentence drops the web's difference (spec §7.3).
- [ ] **Step 4:** Run test and lint; add a scratch `Number("1")` in `present/table.ts`, confirm lint fails, remove it.
- [ ] **Step 5:** Commit `feat(mcp): presenters from contract shapes to cited agent answers`.

### Task 6: Workspace, harness, and the list tools

**Files:**
- Create: `apps/mcp/src/workspace.ts`, `src/tools/list-companies.ts`, `tools/list-filings.ts`, `tools/list-metrics.ts`, `src/tools/index.ts`, `src/errors.ts`, `apps/mcp/test/harness.ts`, `test/list-tools.test.ts`
- Modify: `src/server.ts`, `src/main.ts`

**Interfaces:**
- Consumes: Task 1's `createServer`, Task 2's loaders, Task 5's presenters.
- Produces:
  - `resolveWorkspace(db: Db, settings: Settings): Promise<WorkspaceRow>` (throws `SettingsError` "MAESTER_WORKSPACE_ID: no such workspace" or "MAESTER_USER_EMAIL: no user with a workspace").
  - `toolError(code: ToolErrorCode, sentence: string)` and `runTool(name, logger, fn)` in `errors.ts`: logs one line (tool, ms, items, code), turns a thrown error into `UNAVAILABLE` "Maester's database did not answer."
  - `TOOL_NAMES` in `tools/index.ts`, the allow-list.
  - `test/harness.ts`: `createHarness(): Promise<{ client; db; a: Seeded; b: Seeded; seedFiling(...); close() }>` seeding two users' workspaces on `DATABASE_URL_TEST_MCP` (default `postgres://maester:maester@localhost:5433/maester_test_mcp`), with `seedFiling` copied from `apps/api/test/research.test.ts`'s helper; the server under test is built on a `readOnly` pool for workspace `a`, seeding uses a writable one.

- [ ] **Step 1: Write the failing tests**
  - `resolveWorkspace` by id, by email (first workspace by `createdAt`), id winning over email, and both failures.
  - `list_companies`: workspace `a`'s two companies with name, NSE, BSE, CIN, `annual_reports_read`, `latest_period_end`, and `state` "Read" / "Nothing read yet"; workspace `b`'s company absent.
  - `list_filings` with and without `company_id`; another workspace's company id gives `NOT_FOUND`.
  - `list_metrics` returns `metrics: []` and the Global Constraints sentence verbatim.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the tools, each description opening with the two-line rule summary and ending with what to do when there is no answer.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(mcp): workspace resolution and the companies, filings and metrics tools`.

### Task 7: `get_statement`, `get_filing_facts`, `get_fact`

**Files:**
- Create: `apps/mcp/src/tools/get-statement.ts`, `tools/get-filing-facts.ts`, `tools/get-fact.ts`, `apps/mcp/test/figure-tools.test.ts`

**Interfaces:**
- Consumes: `loadCompanyFinancials`, `toFact`, `listFactsWithSources`, `getCurrentRevision`, `getDocument`, `getFactWithSource`, Task 5's presenters.
- Produces: inputs `get_statement { company_id: uuid; statement: "income_statement" | "balance_sheet" | "cash_flow"; basis: "consolidated" | "standalone"; from?: IsoDate; to?: IsoDate }`, `get_filing_facts { document_id: uuid; statement?; basis? }`, `get_fact { fact_id: uuid }`.

- [ ] **Step 1: Write the failing tests**, seeding a company with AR 2025 (PDF, page 198) and AR 2026 (XBRL), plus a results filing for 2026-06-30:
  - `get_statement(consolidated income_statement)` gives one table, columns oldest first, each cell with `fact_id`, `source`, unit, `period_end`, `span: "year"`, `check`, `reviewed: "not yet"`; `from: "2026-01-01"` keeps only the 2026 column.
  - `basis: "standalone"` with none read answers "No standalone income statement has been read for this company. Read: consolidated." (Review Focus); a company with no annual report read answers "No annual report of this company has been read yet."
  - `get_filing_facts(results document)` returns its facts with `span` and `period_start`; a document of workspace `b` gives `NOT_FOUND`; a kept (unread) document answers in words.
  - `get_fact` on the AR 2026 XBRL fact gives `reported_value`, `element`, and `in_table.value` with `in_table.unit`; on a 2025 fact that AR 2026 restates, `in_table` names "AR 2026" as the filing that fills the year; on the results fact, `in_table` says no table shows results yet; on a fact of a revision read again, `superseded` is set (Review Focus); workspace `b`'s fact id gives `NOT_FOUND`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `get_fact` finds `in_table` by loading the company's financials and matching the cell whose `factId` equals the fact; it never recomputes a cell.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(mcp): statement, filing facts and fact tools with lineage`.

### Task 8: `search_filings`

**Files:**
- Create: `apps/mcp/src/tools/search-filings.ts`, `apps/mcp/test/search-tool.test.ts`
- Modify: `src/main.ts` (build `TeiEmbedder(settings.embedderUrl, settings.embeddingModel, { timeoutMs: 30_000, retries: 1 })` when set)

**Interfaces:**
- Consumes: `searchChunks`, `ServedModelGate` (Task 3), `presentHits`.
- Produces: input `{ query: string (trim, 1..500); company_id?: uuid; limit?: int 1..20, default 8 }`.

- [ ] **Step 1: Write the failing tests** with `FakeEmbedder` and chunks seeded as `packages/document-index`'s search tests seed them: hits carry passage text, filing name, 1-based `page` or `element`, `text_source`, and the `figures` sentence; `limit: 21` gives `INVALID_INPUT`; another workspace's chunks never appear; no embedder gives `SEARCH_UNAVAILABLE` "Search is not available: the embedder is not running or serves another model." while `list_companies` still answers; a mismatched served model gives the same.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(mcp): search_filings over the text index, passages only`.

### Task 9: Guards

**Files:**
- Create: `apps/mcp/test/guards.test.ts`, `apps/mcp/test/stdio.test.ts`

- [ ] **Step 1: Write the tests**
  - the listed tools equal `TOOL_NAMES` exactly: `list_companies`, `list_filings`, `get_statement`, `get_filing_facts`, `get_fact`, `search_filings`, `list_metrics`.
  - every id input with `"not-a-uuid"`, `" <uuid> "` and an upper-case UUID of a missing row gives `INVALID_INPUT` or `NOT_FOUND`, never `UNAVAILABLE` or a stack (Review Focus).
  - with the database closed, a tool gives `UNAVAILABLE` and the log line has the code and no SQL.
  - a recording pino destination over every tool call: no line contains a seeded line name, figure, passage or query string.
  - `stdio.test.ts`: spawn the built server (`node dist/main.js`) with test settings, send `initialize` and a `tools/call` for `get_statement`; every stdout line parses as a JSON-RPC message, and stderr has the log lines.
- [ ] **Step 2:** Run; fix what fails in the owning file.
- [ ] **Step 3:** Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` at the root; expect PASS.
- [ ] **Step 4:** Commit `test(mcp): allow-list, ids, logs and stdout guards`.

### Task 10: Docs, the CLI's `ask`, and the PR

**Files:**
- Modify: `docs/DEVELOPMENT.md`, `docs/systems/packages.md` or a new `docs/systems/mcp.md` (ASD-STE100, as the other system docs), `docs/systems/api.md` (the read loaders), `docs/systems/cli.md`, `apps/cli/src/maester_cli/cli.py`, `apps/cli/README.md` if present, `.claude/skills/financial-figures/SKILL.md` (MCP row: M1 built), `docs/superpowers/specs/2026-10-15-financial-data-layer-design.md` §8.2 (one line pointing to the MCP spec's §11)

- [ ] **Step 1:** `DEVELOPMENT.md` gains "Connect an agent": build, the `claude mcp add maester --env DATABASE_URL=… --env MAESTER_USER_EMAIL=… --env EMBEDDER_URL=… -- node <repo>/apps/mcp/dist/main.js` command, the Claude Desktop `claude_desktop_config.json` block with the same command and env, and that it points at the main checkout's Postgres on 5433, never a worktree's.
- [ ] **Step 2:** `ask` prints to stderr, before it answers: "`maester ask` is deprecated: connect an agent to Maester's MCP server instead (see docs/DEVELOPMENT.md). It is removed once the server calculates." Add a CLI test that the warning is printed (no model call: the test stops at the missing cache).
- [ ] **Step 3:** Write the system doc; run the `writing-ste` check over it.
- [ ] **Step 4:** Commit `docs(mcp): connecting an agent, system docs, ask deprecated`; push; open the PR into `feat/ingestion-phases-2-6` with the live check below as the investor's open item.
- [ ] **Step 5 (investor, live):** connect Claude Code to the server on the real database and ask: "What was the consolidated revenue from operations of <company> in FY2025?" (expect the figure, fact id, filing, page or element, basis, unit, period) and "What was its revenue growth?" (expect: Maester has no named calculation for it yet, and no figure worked out).
