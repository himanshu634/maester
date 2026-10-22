import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb, createDb } from "@maester/db";
import { TeiEmbedder, type Embedder } from "@maester/document-index";
import { createLogger } from "./logger.js";
import { assertReadOnly, watchPool } from "./pool.js";
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
  watchPool(db, logger);
  let workspace;
  try {
    // The second lock: Postgres must say the session is read-only, or the server does not start.
    await assertReadOnly(db);
    workspace = await resolveWorkspace(db, settings);
  } catch (e) {
    if (e instanceof SettingsError) {
      process.stderr.write(`maester-mcp: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  // Search needs the embedder; without EMBEDDER_URL the other tools still work and search says it is unavailable.
  let embedder: Embedder | null = null;
  if (settings.embedderUrl !== null) {
    try {
      embedder = new TeiEmbedder(settings.embedderUrl, settings.embeddingModel, { timeoutMs: 30_000, retries: 1 });
    } catch {
      // The client refuses a model it has no entry for; the setting is the fix.
      process.stderr.write(`maester-mcp: EMBEDDING_MODEL: not a model Maester knows (${settings.embeddingModel})\n`);
      process.exit(1);
    }
  }
  const server = createServer({ db, workspace, embedder, settings, logger });
  await server.connect(new StdioServerTransport());
  logger.info("maester-mcp serving on stdio");
  // The host closes stdin to stop the server; the pool's idle clients would otherwise keep the process alive.
  process.stdin.on("close", () => {
    void server
      .close()
      .then(() => closeDb(db))
      .finally(() => process.exit(0));
  });
}

main().catch((e: unknown) => {
  process.stderr.write(`maester-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
