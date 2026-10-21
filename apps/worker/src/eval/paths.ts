import path from "node:path";

/**
 * A path given on the command line, made absolute. `pnpm --filter @maester/worker <script>` runs the script in
 * apps/worker, but the person typed the path relative to the folder they started pnpm in, which pnpm passes as
 * INIT_CWD. Without INIT_CWD (the script run directly) it is the current folder.
 */
export function cliPath(p: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.isAbsolute(p) ? p : path.resolve(env.INIT_CWD ?? process.cwd(), p);
}
