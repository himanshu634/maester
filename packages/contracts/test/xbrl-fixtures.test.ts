import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XbrlEvent, XbrlPdfCheckRequest, XbrlPdfCheckResult } from "../src/index.js";

// The same fixtures are validated by the extractor's Pydantic models (tests/test_xbrl_contracts.py),
// so the two definitions cannot drift.
const dir = new URL("../fixtures/xbrl/", import.meta.url);
const streams = readdirSync(dir).filter((f) => f.endsWith(".ndjson"));
const json = (file: string) => JSON.parse(readFileSync(new URL(file, dir), "utf8"));
type Line = { result: { checks: { checkType: string }[]; facts: { span: string | null }[] } };
const lines = (file: string): Line[] => readFileSync(new URL(file, dir), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Line);
const TERMINAL = ["classification", "read", "text", "error"];

describe("xbrl stream fixtures", () => {
  it("exist", () => expect(streams.sort()).toEqual(["stream-classify.ndjson", "stream-error.ndjson", "stream-read.ndjson", "stream-text.ndjson"]));

  for (const file of streams) {
    it(`${file}: every line is an XbrlEvent and the stream ends with exactly one terminal event`, () => {
      const events = lines(file).map((l) => XbrlEvent.parse(l));
      const terminal = events.filter((e) => TERMINAL.includes(e.type));
      expect(terminal).toHaveLength(1);
      expect(events.at(-1)).toBe(terminal[0]);
    });
  }

  it("the read stream holds a per-share fact, a nil fact and a cash balance", () => {
    const event = XbrlEvent.parse(lines("stream-read.ndjson").at(-1));
    if (event.type !== "read") throw new Error("not a read");
    const facts = event.result.facts;
    expect(facts.some((f) => f.unitLabel === "₹ a share")).toBe(true);
    expect(facts.some((f) => f.nil && f.reportedValue === null && f.valueStatus === "unparsed")).toBe(true);
    expect(facts.some((f) => f.element === "CashAndCashEquivalentsCashFlowStatement" && f.asOfDate === null)).toBe(true);
  });

  it("the classify stream carries the unmapped-format warning", () => {
    const event = XbrlEvent.parse(lines("stream-classify.ndjson").at(-1));
    if (event.type !== "classification") throw new Error("not a classification");
    expect(event.result.warnings.map((w) => w.code)).toEqual(["XBRL_FORMAT_UNMAPPED"]);
  });
});

describe("pdf check fixtures", () => {
  it("the request has four facts, one per share and one with no value", () => {
    const request = XbrlPdfCheckRequest.parse(json("pdf-check-request.json"));
    expect(request.facts).toHaveLength(4);
    expect(request.facts.filter((f) => f.perShare)).toHaveLength(1);
    expect(request.facts.filter((f) => f.value === null)).toHaveLength(1);
  });

  it("the result has a pass with a page, a failure and two reasons", () => {
    const result = XbrlPdfCheckResult.parse(json("pdf-check-result.json"));
    expect(result.results.map((r) => [r.status, r.pageIndex, r.reason])).toEqual([
      ["passed", 3, null],
      ["failed", null, null],
      ["not_checked", null, "no_value"],
      ["not_checked", null, "scanned"],
    ]);
  });
});

describe("refusals", () => {
  it("a read whose check is xbrl_in_pdf", () => {
    const line = lines("stream-read.ndjson").at(-1)!;
    line.result.checks[0]!.checkType = "xbrl_in_pdf";
    expect(XbrlEvent.safeParse(line).success).toBe(false);
  });

  it("a fact with the span full_year", () => {
    const line = lines("stream-read.ndjson").at(-1)!;
    line.result.facts[0]!.span = "full_year";
    expect(XbrlEvent.safeParse(line).success).toBe(false);
  });

  it("a result with checkVersion 2", () => {
    const result = json("pdf-check-result.json");
    result.checkVersion = 2;
    expect(XbrlPdfCheckResult.safeParse(result).success).toBe(false);
  });
});
