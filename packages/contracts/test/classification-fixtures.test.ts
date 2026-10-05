import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChangeClassificationRequest, ClassifyResponse } from "../src/index.js";

// tests/test_classification_contracts.py validates the same files with Pydantic.
const dir = new URL("../fixtures/classification/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("classifier fixtures", () => {
  it("exist", () => expect(files.length).toBe(3));
  for (const file of files) {
    it(`${file} is a ClassifyResponse`, () => {
      expect(ClassifyResponse.safeParse(JSON.parse(readFileSync(new URL(file, dir), "utf8"))).success).toBe(true);
    });
  }
  it("rejects a quote over 300 characters", () => {
    const body = JSON.parse(readFileSync(new URL("result-annual-report.json", dir), "utf8"));
    body.result.evidence[0].quote = "x".repeat(301);
    expect(ClassifyResponse.safeParse(body).success).toBe(false);
  });
});

describe("ChangeClassificationRequest", () => {
  const basedOn = "00000000-0000-4000-8000-000000000000";
  it("needs at least one change", () => {
    expect(ChangeClassificationRequest.safeParse({ basedOn }).success).toBe(false);
  });
  it("refuses not_sure as an investor answer", () => {
    expect(ChangeClassificationRequest.safeParse({ basedOn, kind: "not_sure" }).success).toBe(false);
  });
  it("accepts a new company with identifiers", () => {
    const r = ChangeClassificationRequest.safeParse({
      basedOn,
      company: { new: { displayName: "Synthetic Cements Limited", country: "IN", cin: "L26940MH2001PLC123456", bseCode: "532123", nseSymbol: "SYNCEM" } },
    });
    expect(r.success).toBe(true);
  });
  it("rejects a malformed CIN", () => {
    const r = ChangeClassificationRequest.safeParse({ basedOn, company: { new: { displayName: "X Ltd", country: "IN", cin: "123" } } });
    expect(r.success).toBe(false);
  });
});
