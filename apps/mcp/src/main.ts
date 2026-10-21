import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb, type WorkspaceRow } from "@maester/db";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";
import { loadSettings, SettingsError } from "./settings.js";

export async function main(): Promise<void> {
  let settings;
  try {
    settings = loadSettings(process.env);
  } catch (e) {
    if (e instanceof SettingsError) {
      process.stderr.write(`maester-mcp: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const logger = createLogger(process.env.LOG_LEVEL ?? "info");
  const db = createDb(settings.databaseUrl);
  // The workspace is resolved from the settings once `resolveWorkspace` exists; no tool reads it before then.
  const workspace = {} as WorkspaceRow;
  const server = createServer({ db, workspace, embedder: null, settings, logger });
  await server.connect(new StdioServerTransport());
  logger.info("maester-mcp serving on stdio");
}

main().catch((e: unknown) => {
  process.stderr.write(`maester-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
