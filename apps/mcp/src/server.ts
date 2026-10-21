import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db, WorkspaceRow } from "@maester/db";
import type { Embedder } from "@maester/document-index";
import { INSTRUCTIONS } from "./instructions.js";
import type { Logger } from "./logger.js";
import type { Settings } from "./settings.js";

export type ServerDeps = {
  db: Db;
  workspace: WorkspaceRow;
  embedder: Embedder | null;
  settings: Settings;
  logger: Logger;
};

export function createServer(_deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "maester", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  // McpServer answers tools/list only once a tool is registered, so an empty server would say "method not found".
  // This is its own idempotent handler setup (the one registerTool runs); it is private in the typings only.
  server["setToolRequestHandlers"]();
  return server;
}
