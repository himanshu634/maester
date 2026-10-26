import { describe, expect, it } from "vitest";
import { ConfirmCompanyRequest, InPdfCount, StatementSource } from "../src/index.js";

const NEW = { displayName: "Synthetic Cements Limited", country: "IN" };

describe("filings contracts", () => {
  it("ConfirmCompanyRequest takes an identity with at least one identifier and a company, existing or new", () => {
    const id = crypto.randomUUID();
    expect(ConfirmCompanyRequest.parse({ identity: { bseCode: "500999" }, company: { id } }).company).toEqual({ id });
    expect(ConfirmCompanyRequest.parse({ identity: { isin: "INE999Z01011", nseSymbol: "SYN" }, company: { new: { ...NEW, cin: "L26940MH2001PLC123456" } } })).toBeTruthy();
  });

  it("ConfirmCompanyRequest refuses an empty identity, a malformed code, an unknown key and a missing company", () => {
    for (const body of [
      { identity: {}, company: { new: NEW } },
      { identity: { bseCode: undefined }, company: { new: NEW } },
      { identity: { bseCode: "5009" }, company: { new: NEW } },
      { identity: { bseCode: "500999", name: "x" }, company: { new: NEW } },
      { identity: { bseCode: "500999" }, company: {} },
      { identity: { bseCode: "500999" } },
    ]) {
      expect(ConfirmCompanyRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("a statement source gives a reason from the contract's list and nothing else", () => {
    const base = { statement: "cash_flow", source: null, xbrlDocumentId: null, xbrlSpans: [], pdfDocumentId: null, pdfPages: [], reason: "not_in_filing", inPdf: null };
    expect(StatementSource.safeParse(base).success).toBe(true);
    expect(StatementSource.safeParse({ ...base, reason: "unknown" }).success).toBe(false);
    expect(StatementSource.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("InPdfCount names the facts not found by id and the reason none was checked", () => {
    expect(InPdfCount.safeParse({ found: 0, checked: 0, notFound: [], notChecked: "not_yet" }).success).toBe(true);
    expect(InPdfCount.safeParse({ found: 0, checked: 0, notFound: ["x"], notChecked: null }).success).toBe(false);
  });
});
