import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { membersPath, workerRoot } from "../src/market/build.js";

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Nifty 500 member list path", () => {
  it("is in the existing apps/worker/data folder when run from src", () => {
    expect(dirname(membersPath())).toBe(join(WORKER, "data"));
    expect(existsSync(dirname(membersPath()))).toBe(true);
  });

  it("finds the same root from dist/ and from src/market/", () => {
    expect(workerRoot(join(WORKER, "dist", "server.js"))).toBe(WORKER);
    expect(workerRoot(join(WORKER, "src", "market", "build.ts"))).toBe(WORKER);
  });
});
