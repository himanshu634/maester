import { describe, expect, it } from "vitest";
import type { CompanyRow } from "@maester/db";
import { groupHeld, type HeldRow } from "../src/documents/held.js";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-21T00:00:00Z");

const NO_CODES = { nameAsPrinted: null, cin: null, bseCode: null, isin: null, nseSymbol: null };
const CIN = "L12345MH1990PLC123456";

function held(n: number, over: Partial<HeldRow> = {}): HeldRow {
  return { documentId: ID(n), kind: "financial_results", otherType: null, periodEnd: "2025-09-30", ...NO_CODES, ...over };
}

function company(n: number, over: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: ID(1000 + n), workspaceId: ID(9), displayName: `Company ${n}`, country: "IN", cin: null, bseCode: null, nseSymbol: null, isin: null,
    createdByUserId: "u", createdAt: new Date(NOW.getTime() + n), updatedAt: NOW, ...over,
  };
}

describe("groupHeld", () => {
  it("makes one group of 3 files and 2 filings from two instances (two bases, one period) and a PDF of another period sharing a BSE code", () => {
    const groups = groupHeld(
      [
        held(1, { bseCode: "500999", nameAsPrinted: "Synthetic Cements Limited" }),
        held(2, { bseCode: "500999", nameAsPrinted: "Synthetic Cements Limited" }),
        held(3, { bseCode: "500999", cin: CIN, periodEnd: "2025-06-30", nameAsPrinted: "Synthetic Cements Ltd" }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: `bse:500999|cin:${CIN}`,
      nameAsPrinted: "Synthetic Cements Limited",
      cin: CIN,
      bseCode: "500999",
      files: 3,
      filings: 2,
      documentIds: [ID(1), ID(2), ID(3)],
      matches: [],
    });
  });

  it("joins an instance with only an ISIN to one with the same ISIN and a BSE code: one group of 2 files and 1 filing", () => {
    const groups = groupHeld([held(1, { isin: "INE999Z01011" }), held(2, { isin: "INE999Z01011", bseCode: "500999" })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "bse:500999|isin:INE999Z01011", files: 2, filings: 1, isin: "INE999Z01011", bseCode: "500999" });
  });

  it("leaves a file with no codes out", () => {
    expect(groupHeld([held(1), held(2, { nameAsPrinted: "No Codes Limited" })], [])).toEqual([]);
    const groups = groupHeld([held(1), held(2, { bseCode: "500999" })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.documentIds).toEqual([ID(2)]);
  });

  it("keeps groups with nothing in common apart, largest first, then by key", () => {
    const groups = groupHeld(
      [held(1, { bseCode: "500002" }), held(2, { bseCode: "500001" }), held(3, { nseSymbol: "BIG" }), held(4, { nseSymbol: "BIG" })],
      [],
    );
    expect(groups.map((g) => g.key)).toEqual(["nse:BIG", "bse:500001", "bse:500002"]);
  });

  it("chains documents through any shared value, and names every value in the key", () => {
    const groups = groupHeld([held(1, { bseCode: "500001" }), held(2, { bseCode: "500001", isin: "INE111A01011" }), held(3, { isin: "INE111A01011", bseCode: "500002" })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("bse:500001|bse:500002|isin:INE111A01011");
    expect(groups[0]!.files).toBe(3);
  });

  it("takes the most common name, the smaller one on a tie, and ignores a missing name", () => {
    const rows = (names: (string | null)[]) => names.map((nameAsPrinted, i) => held(i + 1, { bseCode: "500999", nameAsPrinted }));
    expect(groupHeld(rows(["B Ltd", "A Ltd", "B Ltd", null]), [])[0]!.nameAsPrinted).toBe("B Ltd");
    expect(groupHeld(rows(["B Ltd", "A Ltd"]), [])[0]!.nameAsPrinted).toBe("A Ltd");
    expect(groupHeld(rows([null, null]), [])[0]!.nameAsPrinted).toBeNull();
  });

  it("matches companies by CIN first, then by any code, then by name", () => {
    const byCin = company(1, { cin: CIN });
    const byCode = company(2, { bseCode: "500999" });
    const byName = company(3, { displayName: "Synthetic Cements Limited" });
    const base = { nameAsPrinted: "The Synthetic Cements Ltd.", bseCode: "500999" };
    const all = [byName, byCode, byCin];
    expect(groupHeld([held(1, { ...base, cin: CIN })], all)[0]!.matches).toEqual([byCin.id]);
    expect(groupHeld([held(1, base)], all)[0]!.matches).toEqual([byCode.id]);
    expect(groupHeld([held(1, { ...base, bseCode: "500999" })], [byName])[0]!.matches).toEqual([byName.id]);
    expect(groupHeld([held(1, { ...base, bseCode: "500999" })], [company(4, { displayName: "Other Limited" })])[0]!.matches).toEqual([]);
  });

  it("lists matches oldest company first", () => {
    const a = company(1, { isin: "INE111A01011" });
    const b = company(2, { bseCode: "500999" });
    expect(groupHeld([held(1, { isin: "INE111A01011", bseCode: "500999" })], [b, a])[0]!.matches).toEqual([a.id, b.id]);
  });

  it("with no name matches no company by name", () => {
    expect(groupHeld([held(1, { bseCode: "500999" })], [company(1)])[0]!.matches).toEqual([]);
  });

  it("held files count their filings by the same key rule", () => {
    // rows: "p1" other/investor_presentation and "p2" other/announcement, both 2026-08-14, both bse 532999
    const rows = [
      held(1, { kind: "other", otherType: "investor_presentation", periodEnd: "2026-08-14", bseCode: "532999" }),
      held(2, { kind: "other", otherType: "announcement", periodEnd: "2026-08-14", bseCode: "532999" }),
    ];
    expect(groupHeld(rows, [])[0]).toMatchObject({ files: 2, filings: 2 });
  });

  it("two others of one type and day are one filing; a not_sure file, and a file with no period, each count alone", () => {
    const bse = { bseCode: "532999" };
    expect(groupHeld([held(1, { kind: "other", otherType: "announcement", ...bse }), held(2, { kind: "other", otherType: "announcement", ...bse })], [])[0]).toMatchObject({ files: 2, filings: 1 });
    expect(groupHeld([held(1, { kind: "not_sure", ...bse }), held(2, { kind: "not_sure", ...bse })], [])[0]).toMatchObject({ files: 2, filings: 2 });
    expect(groupHeld([held(1, { periodEnd: null, ...bse }), held(2, { periodEnd: null, ...bse })], [])[0]).toMatchObject({ files: 2, filings: 2 });
    expect(groupHeld([held(1, { kind: "other", otherType: null, ...bse }), held(2, { kind: "other", otherType: "announcement", ...bse })], [])[0]).toMatchObject({ filings: 2 });
  });
});
