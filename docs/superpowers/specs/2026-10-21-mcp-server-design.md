# MCP server: design

Status: draft for review, 21 October 2026. It details §8.2 of the [financial data layer](2026-10-15-financial-data-layer-design.md) and the decision in [ADR 0006](../../decisions/0006-concepts-calculations-agent-access.md): "Agents read through `apps/mcp`, a read-only stdio MCP server over the same functions the API mounts, scoped to one workspace on the investor's machine." It builds on the code in [#19](https://github.com/himanshu634/maester/pull/19) (`feat/ingestion-phases-2-6`). §11 names what it changes in the two earlier specs.

## 1. Goal

An agent the investor runs (Claude Code, Claude Desktop) can answer questions about the investor's filings from Maester's own records, and every number in its answer can be traced to a fact in a filing or to a named calculation. The agent asks; Maester answers with figures and their lineage, or with passages and where they came from; the agent writes the sentence.

It is a thin read layer over what already exists: the facts and the statement table the Research page shows, the filings the Documents page shows, and the hybrid search over the text index. It is not a new engine, a new store or a second copy of the data.

## 2. What is decided, and by whom

The investor's (ADR 0006, the data-layer spec, and this conversation):

- `apps/mcp`, TypeScript, `@modelcontextprotocol/sdk`, stdio. Read-only. One workspace. The investor's own machine; no HTTP, no tokens, no remote access.
- It calls the same functions the API routes call.
- Reviews and overrides are not tools. The agent names an issue; the investor settles it in the terminal.
- The six answer rules of data-layer §10 bind every tool.
- Figures come from facts and named calculations only. A number in a passage or in OCR text is never handed over as a figure (ingestion spec, anti-goal).
- The server covers facts, metrics and search.
- The XBRL-in-PDF check shows as "Not checked" until a stronger check passes the decoy gate (decided 21 October 2026 for the web; this design applies it to agents too).

The designer's (open to change, marked "my call" where it matters): the tool set, the two milestones, the output shapes, where the shared functions live, the read-only enforcement and the tests.

## 3. Goals, non-goals, anti-goals

**Goals**

- An agent can list the investor's companies and filings, read a statement by company, statement and basis, look up any fact by id with its full source, and search the filings' text.
- Every figure the server returns carries its fact id, filing, page (1-based) or XBRL element, basis, currency, unit, span and period, and its check and review state in words.
- An agent that is asked for a figure no fact or calculation gives is told so in a way it can repeat: "no named calculation exists for this yet", not silence.
- Adding the metric tools later (M2) changes no M1 tool's shape.

**Non-goals**

- Any write: no review, override, upload, re-read or job.
- MCP over HTTP, personal access tokens, several workspaces, several users.
- A chat screen or the Analyst page.
- Quarterly tables. The statement table is annual reports only today; results filings reach agents through `get_fact` and search until data-layer phase 4.

**Anti-goals** (a failure even if everything else works)

- A number the server computed, converted or rounded outside `@maester/financial-engine`.
- A passage's number presented as a figure, in a field or in a tool description.
- A fact, chunk or company of another workspace visible through any tool, including by guessing an id.
- A write to Postgres from this process, by any path.
- Document text, a figure or a query in a log line. On stdio this also means nothing but the protocol on stdout.
- An XBRL-in-PDF "passed" shown to an agent while the web says "Not checked".
- Consolidated and standalone figures in one answer object.

## 4. Today

What exists on #19 (mapped 21 October 2026):

| Need | Exists | Shape today |
| --- | --- | --- |
| Companies | `GET /research/companies` in `apps/api/src/routes/research.ts` | Aggregation inline in the handler over `listCompanies` and `listCompanyFilings`. |
| Filings | `GET /filings` in `routes/filings.ts` | Load inline (`listFilingRows`, `documentPipelines`, `loadXbrlFilingData`), then `buildFilings` (pure, `documents/filings.ts`). |
| Statements | `GET /companies/:id/financials` in `routes/research.ts` | Load inline (company, filings read, current revisions, facts, checks, XBRL-in-PDF checks), then `stitch` (pure, `financials/stitch.ts`). Returns every table; no statement or basis filter. |
| One fact | none | `GET /documents/:id/facts` lists a revision's facts; there is no lookup by fact id. |
| Search | `GET /search` in `routes/search.ts`, `searchChunks` in `@maester/document-index` | The served-model check is inline in the route. Hits carry text, document, company, 1-based page or element, section path, text source. |
| Metrics | none | The engine exports only the source rule. Concepts, series, the registry and `compute` are data-layer phase 1, not built. `concepts.json` exists with no TypeScript loader. |
| Workspace | `requireWorkspace`, `getWorkspaceForUser`, `listWorkspacesForUser` | Every db query takes `workspaceId` explicitly. |
| The CLI's `ask` | `apps/cli` | Puts a cached statement in a Gemini prompt and prints the answer: arithmetic inside a prompt, which ADR 0006 retires. |

So facts, statements, filings and search can be served now. Metrics cannot: there are none to serve.

## 5. Two milestones

**M1 · Facts and search** (buildable on #19): `list_companies`, `list_filings`, `get_statement`, `get_fact`, `search_filings`, and `list_metrics`, which answers an empty registry and says why. The CLI's `ask` is marked deprecated.

**M2 · Metrics** (needs data-layer phase 1 on `staging`): `list_metrics` returns the registry; `compute` returns one calculation result (data-layer §7.3); `list_concepts` and `get_series` arrive with the series; `get_statement` rows gain their concept; `get_fact` gains mapping, agreement and reviews; `list_open_issues` arrives once its issue kinds exist. The CLI's `ask` is removed.

Done when:

- **M1**: an agent connected to the server answers "What was the consolidated revenue from operations of <company> in FY2025?" with the figure, its fact id, filing and page or element, basis, unit and period, and answers "What was its revenue growth?" by saying Maester has no named calculation for it yet, without working one out. The tool tests in §10 pass.
- **M2**: the data-layer phase 2 test: an agent answers a margin or growth question with fact ids and pages, and refuses one it has no metric for.

The order between M1 and data-layer phase 1 is the investor's call (§12).

## 6. Architecture

```
Claude Code / Desktop ──stdio──▶ apps/mcp
                                   ├─ tools/*         one file per tool: input schema, description, handler
                                   ├─ present/*       pure: contract types → agent shapes (1-based pages, words for states)
                                   ├─ @maester/api/read    loaders extracted from the route handlers
                                   ├─ @maester/document-index   searchChunks, the served-model gate
                                   └─ @maester/db     createDb (read-only session), the queries
                                              │
                                           Postgres (the same database the API uses)
```

- **Process.** One Node process, started by the agent host with `node apps/mcp/dist/server.js` (or `tsx src/server.ts` in development). It reads its settings from the environment, resolves the workspace, opens one small pool and serves until stdin closes.
- **Settings.** `DATABASE_URL` (required); `MAESTER_WORKSPACE_ID`, or `MAESTER_USER_EMAIL` to take that user's first workspace (one is required; the id wins when both are set); `EMBEDDER_URL` and `EMBEDDING_MODEL` as the API reads them (search is unavailable without `EMBEDDER_URL`); `XBRL_PDF_CHECK` as the API reads it. Parsed with zod at start; a bad or missing setting, or a workspace that does not exist, ends the process with one line on stderr naming the setting.
- **Shared functions (my call).** The four inline handler bodies move into exported functions in `apps/api/src/read/` (`loadCompanyFinancials`, `listResearchCompanies`, `loadWorkspaceFilings`), and the routes call them. They take `(db, workspaceId, …)`, return contract types or `null` for not found, and import nothing from Hono. `@maester/api` gains `"exports": { "./read": "./src/read/index.ts" }`; `apps/mcp` depends on it. The served-model check moves into `@maester/document-index` as a small gate both callers hold. Moving `stitch`, `buildFilings` and `serialize` into their own package is cleaner but churns code that is still unmerged in #19; it is left for later. Watch the existing `@maester/db` → `@maester/financial-engine` dependency if anything moves into the engine.
- **One new query.** `getFactWithSource(db, workspaceId, factId)` in `@maester/db`, joined through the revision to the workspace, returning `FactWithSource` plus the document, revision and company ids, or `null`.
- **Read-only, twice (my call).** The pool sets `default_transaction_read_only=on` for its sessions, so Postgres refuses any write from this process. The server registers no tool that writes, and a test lists the tools against an allow-list.
- **Output.** Each tool declares an output schema and returns `structuredContent` plus a short text summary. Figures are decimal strings. Shapes are built by pure functions in `present/` from the contract types, so the API's shapes stay as they are and the agent gets what it needs to cite: 1-based pages, the filing's name, states in words.
- **Logs.** pino to stderr (file descriptor 2) only. A line per tool call: tool name, duration, item count, error code. Never arguments (a query or a line name can carry a figure), never results. A test fails if anything but protocol messages reaches stdout during a tool call.

## 7. Tools (M1)

Every description begins with the answer rules in two lines and ends with what to do when the tool has no answer. The server's `instructions` carry the six rules of data-layer §10 in full. Ids are UUIDs; an id that is not in the workspace gets the same `NOT_FOUND` as one that does not exist.

### 7.1 `list_companies()`

The workspace's companies: id, name, NSE symbol, BSE code, CIN, annual reports read, the latest period end read, and where it stands in words ("Read", "Reading 1 filing", "1 filing didn't read", "Nothing read yet"), as the Research list says it. From `listResearchCompanies`.

### 7.2 `list_filings(company_id?)`

The workspace's filings (the Documents page's model): per filing, the company, kind, period, the files in it (PDF, XBRL), how far each was read, which source owns each statement and basis, and why a source was left out. From `loadWorkspaceFilings`, filtered by company when given. The XBRL-in-PDF counts are replaced by "not checked" (§8).

### 7.3 `get_statement(company_id, statement, basis, from?, to?)`

One statement table: `statement` is `income_statement`, `balance_sheet` or `cash_flow`; `basis` is `consolidated` or `standalone` and is required, so the two never mix. `from` and `to` are period ends that trim the columns. From `loadCompanyFinancials`, then the one table.

- The table: company, statement, basis, unit (label, scale, currency), columns (period end, label, the filing each comes from), the note that each year comes whole from the newest filing that prints it, and the figures left out with why (no date, other currency, other unit).
- A row: the printed line name, section, subtotal, per share. It is a printed line, not a concept: the row says `"line": "as printed; no concept mapping yet"` until M2.
- A cell: `value` (decimal string or null), `printed` (as on the page), `status` in words (value, a dash printed, not readable, not printed), the unit and currency, `period_end`, `span` (`year`), `fact_id`, and `source`: the filing's name and document id, then `page` (1-based) with `of` pages for a PDF, or `element`, `context` and `decimals` for XBRL. Then `check` in a sentence (the same words as the figure panel's "Adds up"), `restated` in words when it was, and `reviewed: "not yet"` (no reviews exist until data-layer phase 3).
- No cell says how confident anything is.

When the company has no annual report read, the answer says so; when the basis has no table, it says which bases exist.

### 7.4 `get_fact(fact_id)`

Everything a citation needs for one fact, from `getFactWithSource`: the line as printed, the value and printed text, unit, currency, basis, period start and end, span, the filing (name, kind, period) and its source (page 1-based of N, or element and context), the revision's checks that name this fact, in sentences, and whether this fact is the one the statement table shows for its line and year or was superseded by a newer filing. Results filings' facts (quarters, half years) are reachable here even though no table shows them yet.

### 7.5 `search_filings(query, company_id?, limit?)`

Passages from the text index: `searchChunks` behind the served-model gate. `limit` defaults to 8 and is at most 20 (my call: an agent's context, not the API's 50). A hit: the passage text, the filing's name and document id, the company, the page (1-based) or the XBRL element, the section path, whether the text came from the text layer or OCR, and the chunk kind.

The result carries a fixed `figures` field: "Passages are context. A number in a passage is not a figure Maester has read or checked; use get_statement or get_fact for figures." The description says the same. The server does not strip numbers from passages: a passage is evidence of what a filing says, and editing it would make it something the filing did not say.

When search is unavailable (no `EMBEDDER_URL`, the embedder is down, or it serves another model than the index was built with), the tool returns an error result, `SEARCH_UNAVAILABLE`, with one sentence, and the other tools keep working.

### 7.6 `list_metrics()`

In M1: an empty list and the sentence "Maester has no named calculations yet. Do not work out growth, margins, ratios or any other figure from the facts; say that Maester cannot calculate it yet." In M2: the registry (id, version, what it measures, inputs, spans, unit).

### 7.7 Errors

Tool errors are MCP error results (`isError: true`) with `code` and one sentence: `NOT_FOUND`, `INVALID_INPUT` (the schema's message), `SEARCH_UNAVAILABLE`, `UNAVAILABLE` (the database did not answer). A thrown error is caught, logged by code and returned as `UNAVAILABLE`; no stack, query or text goes to the agent or the log.

## 8. The rules, enforced in the server

Tool descriptions ask; the server makes sure. Each line below has a test.

| Rule | How |
| --- | --- |
| Figures only from facts or calculations | Figures leave only through `get_statement` and `get_fact`, which read facts. No tool adds, divides, rounds or converts; `present/` copies decimal strings and never parses them into numbers. |
| No passage as a figure | `search_filings` returns passages in a `passages` list with the fixed `figures` field; no field of a hit is a number but its page and ranks. |
| Unknown stays unknown | A missing value is `null` with its reason in words, never `0` or `""`. |
| Lineage on every figure | The cell and fact shapes make `fact_id`, `source`, basis, unit, currency, span and period required. |
| Bases never mix | `basis` is a required input of `get_statement`; one table per answer. |
| State said in words | Check, restated and reviewed are sentences, as the figure panel says them. |
| XBRL-in-PDF not shown as checked | `present/` writes "not checked" for every XBRL-in-PDF result while `XBRL_IN_PDF_RESULT_SHOWN` is false (a constant in `apps/mcp` naming `docs/eval/2026-10-21-xbrl-map-v1.md`, the same switch as the web's). |
| One workspace | The workspace is fixed at start; every query takes it; `get_fact` and every id input are tested with an id from a second workspace. |
| Read-only | Read-only sessions in Postgres; a tool allow-list test; a test that a write through the server's pool fails. |
| Nothing on stdout but protocol; no text in logs | A test captures stdout and stderr around each tool call. |

## 9. Connecting an agent

`DEVELOPMENT.md` gains a section: build (`pnpm --filter @maester/mcp build`), then add the server to Claude Code (`claude mcp add maester --env DATABASE_URL=… --env MAESTER_USER_EMAIL=… -- node <repo>/apps/mcp/dist/server.js`) and to Claude Desktop (`claude_desktop_config.json`, the same command and env), with the TEI URL for search. It names the database it connects to: the investor's local Postgres from the main checkout, never a worktree's.

## 10. Testing

- **Unit, no database:** `present/` over fixture `StatementTable`, `FinancialFact`, `SearchHit` and `WorkspaceFilings` values: 1-based pages, words for states, null with reasons, XBRL-in-PDF shown as not checked, decimal strings copied untouched (a value like `"1234.50"` keeps its trailing zero).
- **Tools, seeded database:** an in-memory MCP client against the server, on the `--rm` test Postgres the API tests use, seeded with two workspaces: each tool's answer; every id input with the other workspace's id (`NOT_FOUND`); a write through the pool refused; the tool list equal to the allow-list; stdout carrying only protocol messages; search with the `FakeEmbedder`, and unavailable with none or a mismatched model.
- **The API, unchanged:** the extracted loaders keep the routes' existing tests passing without edits to their expectations.
- **Live, by the investor (no paid call in tests):** connect Claude Code to the server on the real database and ask the two M1 questions of §5. The agent's model is the investor's own session; nothing in the test suite calls a model.

No evaluation run is due: M1 changes no prompt, mapping rule, taxonomy, reader, check or metric. M2's metrics ship with their fixtures and the eval run data-layer phase 1 requires.

## 11. What this changes in earlier specs

Named, not bent:

- **Data-layer §8.2's tool list** becomes:

  | §8.2 tool | Here |
  | --- | --- |
  | `list_companies()` | M1, as listed; open issue counts arrive with `list_open_issues` in M2. |
  | `list_concepts()` | M2. |
  | `list_metrics()` | M1 answers an empty registry with the reason; M2 fills it. |
  | `get_series(…)` | M2. Until then `get_statement` serves printed lines, keyed by printed name, not concept. |
  | `compute(…)` | M2. |
  | `get_fact(fact_id)` | M1 without mapping, agreement, alternate reading and reviews (none exist yet); M2 adds them. |
  | `list_open_issues(company_id?)` | M2, once the issue kinds exist (data-layer phases 1 and 3). |
  | new: `get_statement`, `list_filings`, `search_filings` | M1. |

- **Data-layer §11, phase 2** is split into M1 and M2 (§5). M2 keeps phase 2's done-when.
- **Ingestion spec §3**, which put "MCP tools over the index" out of scope for that spec: this spec takes them in, as `search_filings`, under its anti-goal that a number from a chunk is never handed to an agent as a figure.

## 12. Open for the investor

1. **Order.** Build M1 now on #19, and M2 after data-layer phase 1; or build data-layer phase 1 first, so the server lands once, with metrics. M1 alone answers printed figures and searches text, and refuses every calculation.

## 13. Left to the builder

- The exact SDK API (server class, tool registration, stdio and in-memory transports) and its zod 4 support, confirmed against the version installed in the first task, not from memory.
- The names and file layout inside `apps/mcp`, within §6.
- Whether `loadWorkspaceFilings` keeps the pipeline view's embedding model argument or reads it from settings.
- How the text summary beside `structuredContent` reads, within the rules.
