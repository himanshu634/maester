import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BrokerError, decimal, sha256hex } from "../../src/kit/index.js";

describe("decimal", () => {
  it('keeps "1512.4" from the number 1512.4', () => {
    expect(decimal(1512.4, "price")).toBe("1512.4");
  });

  it("keeps a decimal string as printed, trimmed", () => {
    expect(decimal(" 0.50 ", "price")).toBe("0.50");
  });

  it('refuses 1e21, "ten" and NaN as BROKER_ANSWER_UNREADABLE', () => {
    for (const bad of [1e21, "ten", Number.NaN]) {
      expect(() => decimal(bad, "quantity")).toThrow(BrokerError);
      expect(() => decimal(bad, "quantity")).toThrow(expect.objectContaining({ code: "BROKER_ANSWER_UNREADABLE" }));
    }
  });
});

describe("sha256hex", () => {
  it('equals sha256 of "ab" for ("a", "b")', () => {
    expect(sha256hex("a", "b")).toBe(createHash("sha256").update("ab").digest("hex"));
  });
});
