import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { importFolder, type ImportResult } from "./import.js";

/** 2 when the run stopped (signed out), else 1 when a file failed, else 0. Refused files alone exit 0. */
export function exitCodeOf(r: ImportResult): 0 | 1 | 2 {
  if (r.stopped) return 2;
  return r.failed.length > 0 ? 1 : 0;
}

const USAGE = "Usage: pnpm --filter @maester/import run import <folder> [--workspace <id>] [--api <url>]";

export async function main(argv: string[], env: NodeJS.ProcessEnv, out: (line: string) => void = console.log): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { workspace: { type: "string" }, api: { type: "string" } },
  });
  const [folderArg] = positionals;
  const workspaceId = values.workspace ?? env.MAESTER_WORKSPACE;
  const cookie = env.MAESTER_SESSION_COOKIE;
  const apiUrl = values.api ?? env.MAESTER_API_URL ?? "http://localhost:8787";
  const missing = [
    !folderArg && "a folder",
    !workspaceId && "--workspace or MAESTER_WORKSPACE",
    !cookie && "MAESTER_SESSION_COOKIE",
  ].filter(Boolean);
  if (missing.length > 0 || !folderArg || !workspaceId || !cookie) {
    out(`Missing: ${missing.join(", ")}.\n${USAGE}`);
    return 64;
  }

  // pnpm runs the script from apps/import, so a relative folder is read from where the command was typed.
  const folder = resolve(env.INIT_CWD ?? process.cwd(), folderArg);
  let total = 0;
  const result = await importFolder({
    apiUrl,
    workspaceId,
    cookie,
    folder,
    onSettled: (n, t) => {
      total = t;
      if (n % 25 === 0) out(`Handled ${n} of ${t} files.`);
    },
  });

  out(`Sent ${result.sent}. Refused ${result.refused.length}. Failed ${result.failed.length}.`);
  for (const f of result.refused) out(`Refused ${f.name}: ${f.code}`);
  for (const f of result.failed) out(`Failed ${f.name}: ${f.code}`);
  if (result.stopped) {
    const notStarted = total - result.sent - result.refused.length - result.failed.length;
    out(`Stopped: the session is signed out. ${notStarted} files were not sent. Copy a fresh cookie and run it again.`);
  } else if (total === 0) {
    out("No PDF or XML files found.");
  }
  return exitCodeOf(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (e: unknown) => {
      // The message of a file-system or network error names a path or host, never file contents.
      console.error(`Import failed: ${e instanceof Error ? e.message : "unknown error"}`);
      process.exit(1);
    },
  );
}
