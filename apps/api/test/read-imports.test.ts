import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const READ_DIR = join(import.meta.dirname, "..", "src", "read");

describe("src/read", () => {
  const files = readdirSync(READ_DIR).filter((f) => f.endsWith(".ts"));

  it("has the loader files", () => {
    expect(files).toEqual(expect.arrayContaining(["index.ts", "financials.ts", "companies.ts", "filings.ts"]));
  });

  it.each(files)("%s imports neither hono nor the app", (file) => {
    const source = readFileSync(join(READ_DIR, file), "utf8");
    expect(source).not.toMatch(/from\s+["']hono["']/);
    expect(source).not.toMatch(/from\s+["'][^"']*\/app\.js["']/);
  });

  it("reaches no Cloud Tasks client through any file it imports", () => {
    // apps/mcp bundles these loaders; the @maester/jobs barrel would pull in @google-cloud/tasks, which it never needs.
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']@maester\/jobs["']/);
      expect(source, file).not.toMatch(/from\s+["']@google-cloud\//);
      for (const [, rel] of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)\.js["']/g)) walk(resolve(dirname(file), `${rel}.ts`));
    };
    walk(join(READ_DIR, "index.ts"));
    expect(seen.size).toBeGreaterThan(5);
  });
});
