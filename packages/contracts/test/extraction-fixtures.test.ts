import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DecimalString, ExtractorEvent } from "../src/index.js";

// The same fixtures are validated by the Python extractor's Pydantic models
// (tests/test_extraction_contracts.py), so the two definitions cannot drift.
const dir = new URL("../fixtures/extraction/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ndjson"));

describe("extractor stream fixtures", () => {
  it("exist", () => expect(files.length).toBeGreaterThan(0));

  for (const file of files) {
    it(`${file}: every line is an ExtractorEvent and the stream ends with exactly one terminal event`, () => {
      const lines = readFileSync(new URL(file, dir), "utf8").trim().split("\n");
      const events = lines.map((l) => ExtractorEvent.parse(JSON.parse(l)));
      const terminal = events.filter((e) => e.type === "result" || e.type === "error");
      expect(terminal).toHaveLength(1);
      expect(events.at(-1)).toBe(terminal[0]);
    });
  }
});

describe("DecimalString", () => {
  it("rejects exponent notation", () => {
    expect(DecimalString.safeParse("1E+5").success).toBe(false);
    expect(DecimalString.safeParse("100000").success).toBe(true);
  });
});
