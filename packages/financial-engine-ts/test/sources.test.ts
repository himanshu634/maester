import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOURCE_RULE_VERSION,
  annualSlotOf,
  coveringXbrl,
  planPdfNumbers,
  rankSlotCandidates,
  slotKey,
  slotOwner,
  type PdfNumbersInput,
  type PdfNumbersPlan,
  type Slot,
  type SlotCandidate,
  type XbrlDocInput,
} from "../src/index.js";

type Fixture = {
  version: number;
  rank: { name: string; candidates: SlotCandidate[]; expected: string[] }[];
  annual: { name: string; filing: Parameters<typeof annualSlotOf>[0]; fact: Parameters<typeof annualSlotOf>[1]; expected: Slot | null }[];
  plan: { name: string; pdf: PdfNumbersInput; xbrl: XbrlDocInput[]; expected: PdfNumbersPlan }[];
  covering: { name: string; pdf: PdfNumbersInput; xbrl: XbrlDocInput[]; expected: string[] }[];
};

// One fixture for this function and its Python twin (maester_eval.source_rule); its expectations were worked out by hand.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/source-rule.json", import.meta.url), "utf8")) as Fixture;

describe("the source rule", () => {
  it("is the fixture's version", () => {
    expect(SOURCE_RULE_VERSION).toBe(fixture.version);
  });

  it("keys a slot by its six parts, an instant as 'instant'", () => {
    const slot: Slot = { companyId: "co-cem", filingKind: "annual_report", statement: "income_statement", basis: "consolidated", periodEnd: "2026-03-31", span: "year" };
    expect(slotKey(slot)).toBe("co-cem|annual_report|income_statement|consolidated|2026-03-31|year");
    expect(slotKey({ ...slot, statement: "balance_sheet", span: null })).toBe("co-cem|annual_report|balance_sheet|consolidated|2026-03-31|instant");
  });

  describe("rankSlotCandidates and slotOwner", () => {
    it.each(fixture.rank.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      const input = structuredClone(c.candidates);
      expect(rankSlotCandidates(input).map((r) => r.revisionId)).toEqual(c.expected);
      expect(slotOwner(input)?.revisionId ?? null).toBe(c.expected[0] ?? null);
      expect(input).toEqual(c.candidates); // the input is not reordered
    });
  });

  describe("annualSlotOf", () => {
    it.each(fixture.annual.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expect(annualSlotOf(c.filing, c.fact)).toEqual(c.expected);
    });
  });

  describe("planPdfNumbers", () => {
    it.each(fixture.plan.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expect(planPdfNumbers(c.pdf, c.xbrl)).toEqual(c.expected);
    });
  });

  describe("coveringXbrl", () => {
    it.each(fixture.covering.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expect(coveringXbrl(c.pdf, c.xbrl)).toEqual(c.expected);
    });
  });
});
