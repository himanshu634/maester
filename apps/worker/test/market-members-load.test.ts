import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadMembers } from "../src/market/build.js";

function file(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "members-")), "nifty500.csv");
  writeFileSync(path, text);
  return path;
}

const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() });

describe("loadMembers", () => {
  it("reads the Symbol column", () => {
    expect(loadMembers(file("Company,Symbol\nReliance,RELIANCE\n"), logger() as never)).toEqual(["RELIANCE"]);
  });

  it("logs and skips breadth for a list with no Symbol column, so the worker still starts", () => {
    const log = logger();
    expect(loadMembers(file("Company,Ticker\nReliance,RELIANCE\n"), log as never)).toEqual([]);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("warns when the list is missing", () => {
    const log = logger();
    expect(loadMembers("/nonexistent/nifty500.csv", log as never)).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });
});
