# @maester/mcp

A read-only MCP server over stdio, for one workspace on the investor's machine. Design:
`docs/superpowers/specs/2026-10-21-mcp-server-design.md`. stdout carries the MCP protocol only; logs go to stderr.

Commands (from the repo root): `pnpm --filter @maester/mcp test | typecheck | lint | build`. `dev` runs
`tsx --env-file=../../.env src/main.ts`; `start` runs `node dist/main.js`.

Settings: `DATABASE_URL` (required); `MAESTER_WORKSPACE_ID` or `MAESTER_USER_EMAIL` (one is required, the id wins);
`EMBEDDER_URL`, `EMBEDDING_MODEL`, `XBRL_PDF_CHECK` as the API reads them. A blank value counts as unset.

## SDK names (`@modelcontextprotocol/sdk` 1.32.1)

Read from the installed `dist/esm`. Later tasks use exactly these.

- Server class: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
  `new McpServer({ name, version }, { instructions })`. `instructions` is a `ServerOptions` field; a client reads it
  with `client.getInstructions()`. The low-level `Server` is `mcpServer.server`.
- Tool registration: `server.registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }, cb)`.
  `server.tool(...)` is deprecated. `inputSchema` and `outputSchema` are zod raw shapes (`{ id: z.uuid() }`) or
  zod object schemas (zod 4 works). `cb(args, extra)` returns a `CallToolResult`:
  `{ content: [{ type: "text", text }], structuredContent?, isError? }`.
- `structuredContent`: with an `outputSchema`, a non-error result must carry `structuredContent` matching it, or the
  server throws `-32602`. The advertised JSON schema has `additionalProperties: false`, and the client checks
  `structuredContent` against it even when `isError` is true. So an error result carries its `code` and sentence in
  `content` text only (no `structuredContent`), or the tool declares no `outputSchema`.
- Input errors: input that fails the `inputSchema` does not throw to the client. The client gets
  `{ isError: true, content: [{ type: "text", text: "MCP error -32602: Input validation error: ..." }] }`.
- Empty server: `McpServer` installs its `tools/list` and `tools/call` handlers (and the `tools` capability) only when
  the first tool is registered, so a server with none answers "method not found". `createServer` calls the private,
  idempotent `server["setToolRequestHandlers"]()` once so an empty server lists `[]`. Registering tools after it is fine.
- stdio: `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`; `await server.connect(new StdioServerTransport())`
  reads stdin and writes stdout.
- In-memory pair for tests: `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js`
  returns `[clientSide, serverSide]`; `await Promise.all([server.connect(serverSide), client.connect(clientSide)])` with
  `Client` from `@modelcontextprotocol/sdk/client/index.js`. `client.listTools()` and `client.callTool({ name, arguments })`.
