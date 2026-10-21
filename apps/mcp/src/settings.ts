import { z } from "zod";

/** A setting that is missing or wrong. `setting` names it (or them) so the host's log line says what to fix. */
export class SettingsError extends Error {
  constructor(
    readonly setting: string,
    message: string,
  ) {
    super(`${setting}: ${message}`);
    this.name = "SettingsError";
  }
}

// A host that starts the server with a blank env entry passes "", which means unset.
const blank = (v: unknown) => (v === "" ? undefined : v);

const SettingsSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MAESTER_WORKSPACE_ID: z.preprocess(blank, z.uuid().optional()),
  MAESTER_USER_EMAIL: z.preprocess(blank, z.string().min(1).optional()),
  // The text embedder (TEI) that turns a search query into a vector, as the API reads it. Unset: search is unavailable.
  EMBEDDER_URL: z.preprocess(blank, z.url().optional()),
  EMBEDDING_MODEL: z.string().default("Snowflake/snowflake-arctic-embed-l-v2.0"),
  // As the API reads it: "false" says every XBRL figure's check against its results PDF is turned off.
  XBRL_PDF_CHECK: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

export type Settings = {
  databaseUrl: string;
  workspaceId: string | null;
  userEmail: string | null;
  embedderUrl: string | null;
  embeddingModel: string;
  xbrlPdfCheck: boolean;
};

export function loadSettings(env: NodeJS.ProcessEnv): Settings {
  const parsed = SettingsSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const name = String(issue.path[0] ?? "environment");
    throw new SettingsError(name, issue.path.length === 0 ? issue.message : `${issue.message} (${name})`);
  }
  const d = parsed.data;
  if (d.MAESTER_WORKSPACE_ID === undefined && d.MAESTER_USER_EMAIL === undefined) {
    throw new SettingsError("MAESTER_WORKSPACE_ID or MAESTER_USER_EMAIL", "set one of them, so the server knows whose workspace to read");
  }
  return {
    databaseUrl: d.DATABASE_URL,
    workspaceId: d.MAESTER_WORKSPACE_ID ?? null,
    userEmail: d.MAESTER_USER_EMAIL ?? null,
    embedderUrl: d.EMBEDDER_URL ?? null,
    embeddingModel: d.EMBEDDING_MODEL,
    xbrlPdfCheck: d.XBRL_PDF_CHECK,
  };
}
