import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
});
