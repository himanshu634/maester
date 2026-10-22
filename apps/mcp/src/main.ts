import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb } from "@maester/db";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";
import { loadSettings, SettingsError } from "./settings.js";
import { resolveWorkspace } from "./workspace.js";

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
  // Every session on this pool is read-only: Postgres refuses a write from this process.
  const db = createDb(settings.databaseUrl, { readOnly: true, max: 4 });
  let workspace;
  try {
    workspace = await resolveWorkspace(db, settings);
  } catch (e) {
    if (e instanceof SettingsError) {
      process.stderr.write(`maester-mcp: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const server = createServer({ db, workspace, embedder: null, settings, logger });
  await server.connect(new StdioServerTransport());
  logger.info("maester-mcp serving on stdio");
}

main().catch((e: unknown) => {
  process.stderr.write(`maester-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
