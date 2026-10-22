# MCP server (`apps/mcp`): system description

This document describes the MCP server in `apps/mcp`. For the full system, read the [Maester overview](maester.md). For the routes that give the same data to the web client, read the [API](api.md). The [design](../superpowers/specs/2026-10-21-mcp-server-design.md) gives the reasons for each choice.

## Terms

| Term | Meaning in this document |
| --- | --- |
| MCP | Model Context Protocol. A protocol that lets an agent call the tools of a server. |
| server | The Node program in `apps/mcp`. Its package name is `@maester/mcp`. The built file is `apps/mcp/dist/main.js`. |
| agent | A program that uses a language model and starts the server, for example Claude Code or Claude Desktop. |
| host | The application that starts the server and connects an agent to it. |
| tool | One function that an agent can call. The server registers each tool with a name, an input schema and a description. |
| investor | The person who owns the workspace and runs the agent on their own computer. |
| workspace | One row in the `workspace` table. The server reads only one workspace. |
| fact | One row in the `financial_fact` table. It is one figure from a filing, with its page or its XBRL element. |
| filing | The files for one company, one kind and one period end. |
| statement table | The table that the Research page shows for one company, one statement and one basis. Each year column comes whole from one filing. |
| passage | One chunk of the text of a filing, from the index. |
| figure | A number that Maester read from a filing, or the result of a named calculation. A number in a passage is not a figure. |
| named calculation | A function with an identifier and a version that works out a figure from facts. Maester has none yet. |
| read loader | A function in `apps/api/src/read/` that gets data from the database and returns it in the shape of `@maester/contracts`. The API routes and the server both call it. |
| answer rules | The six rules in `INSTRUCTIONS` that tell an agent how to give a figure. They come from section 10 of the [financial data layer design](../superpowers/specs/2026-10-15-financial-data-layer-design.md). |
| structured content | The `structuredContent` field of a tool result. It holds the answer as JSON that has the shape of the output schema of the tool. |
| error result | A tool result with `isError` set to true. Its text is a code and one sentence. |
| embedder | The service at `EMBEDDER_URL` that turns a search query into a vector. |
| gate | The `ServedModelGate` object. It asks the embedder which model it serves, before the server embeds a query. |
| decimal string | A number in a JSON string, for example `"1234.50"`. The server never changes it. |

## Function

The server lets an agent read the filings of one workspace from Maester's own records. The agent calls a tool. The server gives back figures with their lineage, or passages with their place in a filing. The agent writes the sentence for the investor. The server only reads data. It never writes.

The server runs on the computer of the investor. It talks to the host through standard input and standard output. It has no HTTP port, no sign-in and no token. It works out no figure. It has seven tools. If a question needs a calculation, the server tells the agent that Maester has no named calculation for it yet.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| Entry | `apps/mcp/src/main.ts` | Reads the settings. Opens a read-only database pool with a maximum of 4 connections. Finds the workspace. Connects the server to standard input and output. |
| Settings | `apps/mcp/src/settings.ts` | Reads and checks the environment variables. A blank value counts as not set. |
| Workspace | `apps/mcp/src/workspace.ts` | Finds the one workspace from `MAESTER_WORKSPACE_ID` or `MAESTER_USER_EMAIL`. |
| Server | `apps/mcp/src/server.ts` | Makes the `McpServer` object with the `instructions`. Registers the tools. |
| Instructions | `apps/mcp/src/instructions.ts` | Holds the text of the six answer rules. |
| Tools | `apps/mcp/src/tools/` | One file for each tool. `index.ts` holds `TOOL_NAMES`, the list of the tools that the server registers. `rules.ts` gives the first lines of each description. |
| Presenters | `apps/mcp/src/present/` | Pure functions that change the shapes of `@maester/contracts` into the shapes that an agent gets. They count pages from 1 and write states as words. |
| Errors | `apps/mcp/src/errors.ts` | Gives the error codes, the error result and `runTool`. `runTool` runs one call and writes one log line. |
| Logger | `apps/mcp/src/logger.ts` | Writes pino log lines to standard error (file descriptor 2). |
| Read loaders | `apps/api/src/read/` | `loadCompanyFinancials`, `listResearchCompanies` and `loadWorkspaceFilings`. The package `@maester/api` exports them as `@maester/api/read`. |
| Gate | `packages/document-index/src/gate.ts` | `ServedModelGate` checks that the embedder serves the model that the index uses. |
| Fact lookup | `packages/db/src/queries/extraction.ts` | `getFactWithSource` gets one fact with its source, for one workspace. |
| Read-only pool | `packages/db/src/client.ts` | `createDb(url, { readOnly: true })` sets `default_transaction_read_only=on` for each session. |
| Tests | `apps/mcp/test/` | Vitest tests. The tool tests use a real Postgres database. |

## Operation

1. The host starts `node apps/mcp/dist/main.js` with the settings in the environment.
2. `loadSettings` checks the environment. If a setting is wrong, the server writes one line to standard error that names the setting. Then it stops with exit code 1.
3. `createDb` opens the pool with `readOnly` true. Postgres then refuses each write from the server.
4. `resolveWorkspace` finds the workspace. If `MAESTER_WORKSPACE_ID` has a value, the server uses that workspace. If not, it uses the first workspace of the user with `MAESTER_USER_EMAIL`. If it finds none, the server stops as in step 2.
5. `createServer` registers the tools and the `instructions`. The server then reads messages on standard input until the host closes it.
6. The agent reads the descriptions of the tools. Each description starts with the answer rules in two lines and ends with what the agent does when the tool has no answer.
7. The agent calls a tool. The SDK checks the input against the input schema. If the input is wrong, the agent gets an error result from the SDK.
8. The handler of the tool calls a read loader or a query, always with the ID of the workspace. If the input has an ID that is not in the workspace, the handler gives `NOT_FOUND`. The sentence is the same for an ID that does not exist.
9. A presenter changes the data into the answer. It copies each decimal string without a change. It writes `null` with a reason for each value that Maester does not know.
10. `runTool` writes one log line to standard error: the tool, the time in milliseconds, the number of items and the error code. The line has no argument and no result.
11. The server sends the answer as structured content with a short text summary.

### The tools

| Tool | Input | Answer |
| --- | --- | --- |
| `list_companies` | None | The companies: ID, name, NSE symbol, BSE code, CIN, the number of annual reports read, the newest period end read and where each stands in words. It calls `listResearchCompanies`. |
| `list_filings` | `company_id` (optional) | The filings: company, kind, period, files, how far Maester read each file, the source of each statement and basis, and why a source has no use. It calls `loadWorkspaceFilings`. |
| `get_statement` | `company_id`, `statement`, `basis`, and optional `from` and `to` | One statement table, as the Research page gets it. `statement` is `income_statement`, `balance_sheet` or `cash_flow`. `basis` is `consolidated` or `standalone`. It calls `loadCompanyFinancials`. |
| `get_filing_facts` | `document_id`, and optional `statement` and `basis` | The facts of the current revision of one document, each in the shape of `get_fact`. It is the way to the figures of a results filing. |
| `get_fact` | `fact_id` | One fact with all that a citation needs. It calls `getFactWithSource`. |
| `search_filings` | `query`, and optional `company_id` and `limit` | Passages from the text index. `limit` is 8 by default and at most 20. It calls `searchChunks` after the gate. |
| `list_metrics` | None | An empty list and the sentence that Maester has no named calculations yet. |

Rules for the answers:

- Each cell and each fact has its fact ID, its source, its basis, its currency, its unit, its span and its period.
- The source of a figure from a PDF is the filing name, the document ID and the page, counted from 1. The source of a figure from XBRL is the element, the context and the decimals.
- The check, the restated state and the reviewed state are sentences. The reviewed state is "not yet", because no review exists.
- `get_statement` needs the basis, so one answer never mixes consolidated and standalone figures.
- `get_statement` gives each row as a printed line name. A row has no concept yet.
- `get_fact` gives the value in the unit of the filing. If the fact is a cell of the statement table, the answer also gives the value in the unit of the table.
- `search_filings` gives the passages in a `passages` list. A fixed `figures` field says that a number in a passage is not a figure. The server does not remove numbers from passages.
- Each XBRL fact has a check of its figure against the results PDF. The server says "not checked" for this check while `XBRL_IN_PDF_RESULT_SHOWN` is false. The web client does the same.
- The server adds, subtracts, divides, rounds and converts nothing. The eslint rules of `apps/mcp` stop the use of `Number`, `parseFloat`, `parseInt` and `decimal.js` in `src`.

## States and errors

| State or error | Cause | Result |
| --- | --- | --- |
| Settings error | `DATABASE_URL` has no value, a setting has a wrong value, or neither `MAESTER_WORKSPACE_ID` nor `MAESTER_USER_EMAIL` has a value. | The server writes `maester-mcp: <setting>: <message>` to standard error and stops with exit code 1. |
| Workspace not found | `MAESTER_WORKSPACE_ID` is not a workspace, or the email has no user with a workspace. | The same as a settings error. |
| `NOT_FOUND` | An ID is not in the workspace, or it does not exist. | An error result with one sentence. |
| `INVALID_INPUT` | The input does not fit the input schema. | An error result. The SDK writes the message. |
| `SEARCH_UNAVAILABLE` | `EMBEDDER_URL` has no value, the embedder does not answer, or it serves a model other than `EMBEDDING_MODEL`. | An error result for `search_filings` only. The other tools continue to work. |
| `UNAVAILABLE` | The database does not answer, or a handler throws an error. | An error result with the sentence "Maester's database did not answer." The server logs the code only. |
| Write refused | Code in the server tries to write to the database. | Postgres refuses the write with code 25006. |
| No named calculation | The agent asks for a figure that no fact and no named calculation gives. | `list_metrics` gives an empty list with the reason. The agent must say that Maester cannot calculate the figure yet. |

An error result carries its code and sentence in the text only. It has no structured content, because the client checks the structured content against the output schema also when `isError` is true.

## Data

### What the server reads

- The `workspace`, `user` and `membership` rows, to find the workspace.
- The `company`, `document`, `document_classification`, `extraction_revision`, `financial_fact`, `source_reference` and `extraction_check` rows, through the read loaders and `getFactWithSource`.
- The `xbrl_in_pdf` check rows, to know if a check ran. The server shows them as "not checked".
- The chunks of the text index, through `searchChunks`.
- The embedder, for a vector of each search query.

### What the server writes

- Log lines on standard error. A line has the tool, the time, the number of items and the error code. It has no argument, no result and no document text.
- Nothing to the database and nothing to standard output except the MCP protocol.

### Environment variables

| Variable | Default | Use |
| --- | --- | --- |
| `DATABASE_URL` | No default. The server stops without it. | The Postgres database. Use the database of the main checkout, `postgres://maester:maester@localhost:5433/maester`. |
| `MAESTER_WORKSPACE_ID` | Not set | The ID of the workspace. If both this and the email have a value, this one wins. |
| `MAESTER_USER_EMAIL` | Not set | The email of a user. The server uses the first workspace of this user. |
| `EMBEDDER_URL` | Not set | The embedder. If not set, `search_filings` gives `SEARCH_UNAVAILABLE`. |
| `EMBEDDING_MODEL` | `Snowflake/snowflake-arctic-embed-l-v2.0` | The model of the index. It must be the model that the embedder serves. |
| `XBRL_PDF_CHECK` | `true` | Set the same value as the API. With `false`, the check of an XBRL figure against its results PDF is off. |
| `LOG_LEVEL` | `info` | The level of the pino logger. |

## Procedures

### To build the server

1. Open a terminal in the repository root.
2. Install the dependencies:

   ```bash
   pnpm install
   ```

3. Build the server:

   ```bash
   pnpm --filter @maester/mcp build
   ```

4. Make sure that the file `apps/mcp/dist/main.js` exists.

### To connect Claude Code

1. Start the Postgres database of the main checkout, as [development](../DEVELOPMENT.md) section 3 shows.
2. Build the server.
3. Replace `<repo>` with the path of the main checkout, and the email with your email, then add the server:

   ```bash
   claude mcp add maester \
     --env DATABASE_URL=postgres://maester:maester@localhost:5433/maester \
     --env MAESTER_USER_EMAIL=you@example.com \
     --env EMBEDDER_URL=http://localhost:8792 \
     -- node <repo>/apps/mcp/dist/main.js
   ```

4. To use Claude Desktop, read [development](../DEVELOPMENT.md) section 15.

### To run the tests

1. Start a test Postgres database that has the database `maester_test_mcp`.
2. Set the URL of the database:

   ```bash
   export DATABASE_URL_TEST_MCP=postgres://maester:maester@localhost:5433/maester_test_mcp
   ```

3. Run the tests, the type check and the lint:

   ```bash
   pnpm --filter @maester/mcp test
   pnpm --filter @maester/mcp typecheck
   pnpm --filter @maester/mcp lint
   ```

Note: no test calls a language model. The tests use the `FakeEmbedder`, so no embedder is necessary.

### To run the server from source

1. Set the environment variables in `.env`.
2. Run the server:

   ```bash
   pnpm --filter @maester/mcp dev
   ```

Note: the server reads standard input. In a terminal it waits for MCP messages and does nothing else.

## Warnings and cautions

WARNING: The server gives your filings and figures to the agent, and so to the model of the agent. Connect only an agent that you trust with this data.

CAUTION: Do not point `DATABASE_URL` at the database of a worktree. That database has no filings, and an agent can then say that Maester has no data.

CAUTION: Build the server again after each change. The host starts the built file, not the source.

## Limits

- The server only reads data. It cannot review, correct, upload or read a filing again.
- It serves one workspace. It has no HTTP, no sign-in and no token.
- It has no named calculation. An agent cannot get growth, a margin or a ratio from it. M2 of the design adds them.
- `get_statement` has annual reports only. The figures of a results filing come from `get_filing_facts`, as that one filing prints them.
- A row of a statement table is a printed line. It has no concept, and it has no review.
- A passage can have a number in it. The server does not mark which numbers are right.
- The result of the check of an XBRL figure against its PDF shows as "not checked" until a stronger check passes.
- The server does not limit the rate of calls, and it has no cache.

## Sources

- [apps/mcp/package.json](../../apps/mcp/package.json)
- [apps/mcp/tsup.config.ts](../../apps/mcp/tsup.config.ts)
- [apps/mcp/eslint.config.js](../../apps/mcp/eslint.config.js)
- [apps/mcp/README.md](../../apps/mcp/README.md)
- [apps/mcp/src/main.ts](../../apps/mcp/src/main.ts)
- [apps/mcp/src/settings.ts](../../apps/mcp/src/settings.ts)
- [apps/mcp/src/workspace.ts](../../apps/mcp/src/workspace.ts)
- [apps/mcp/src/server.ts](../../apps/mcp/src/server.ts)
- [apps/mcp/src/instructions.ts](../../apps/mcp/src/instructions.ts)
- [apps/mcp/src/errors.ts](../../apps/mcp/src/errors.ts)
- [apps/mcp/src/logger.ts](../../apps/mcp/src/logger.ts)
- [apps/mcp/src/tools/](../../apps/mcp/src/tools/)
- [apps/mcp/src/present/](../../apps/mcp/src/present/)
- [apps/mcp/test/](../../apps/mcp/test/)
- [apps/api/src/read/](../../apps/api/src/read/)
- [packages/document-index/src/gate.ts](../../packages/document-index/src/gate.ts)
- [packages/db/src/client.ts](../../packages/db/src/client.ts)
- [packages/db/src/queries/extraction.ts](../../packages/db/src/queries/extraction.ts)
- [MCP server design](../superpowers/specs/2026-10-21-mcp-server-design.md)
