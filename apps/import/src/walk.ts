import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export type FoundFile = { path: string; name: string; size: number };

const SKIPPED_NAMES = new Set(["thumbs.db", "desktop.ini"]);
const TAKEN = /\.(pdf|xml)$/i;

/**
 * The PDF and XML files under a folder, depth first, in sorted order. A name that starts with "."
 * (a folder too) is skipped, with Thumbs.db and desktop.ini. A symbolic link is never followed.
 */
export async function* walk(folder: string): AsyncGenerator<FoundFile> {
  const entries = await readdir(folder, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIPPED_NAMES.has(entry.name.toLowerCase())) continue;
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && TAKEN.test(entry.name)) {
      yield { path, name: entry.name, size: (await lstat(path)).size };
    }
  }
}
