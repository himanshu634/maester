import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db, WorkspaceRow } from "@maester/db";
import { ServedModelGate, type Embedder } from "@maester/document-index";
import { INSTRUCTIONS } from "./instructions.js";
import type { Logger } from "./logger.js";
import type { Settings } from "./settings.js";
import { registerTools } from "./tools/index.js";

export type ServerDeps = {
  db: Db;
  workspace: WorkspaceRow;
  embedder: Embedder | null;
  settings: Settings;
  logger: Logger;
};

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "maester", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  // One gate for the process: a success is kept next to the embedder it checked, a failure is asked again.
  registerTools(server, deps, deps.embedder ? new ServedModelGate(deps.embedder) : null);
  return server;
}
