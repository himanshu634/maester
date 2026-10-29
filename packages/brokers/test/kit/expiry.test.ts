import { describe, expect, it } from "vitest";
import { sessionExpiry } from "../../src/kit/index.js";

describe("sessionExpiry", () => {
  const rule = { kind: "daily", at: "06:00", timeZone: "Asia/Kolkata" } as const;
  it("is 06:00 IST the next morning for a sign-in after 06:00", () => {
    // 09:00 IST on 19 Oct is 03:30 UTC; 06:00 IST on 20 Oct is 00:30 UTC.
    expect(sessionExpiry(rule, new Date("2026-10-19T03:30:00Z")).toISOString()).toBe("2026-10-20T00:30:00.000Z");
  });
  it("is 06:00 IST the same morning for a sign-in before 06:00", () => {
    // 05:00 IST on 19 Oct is 23:30 UTC on 18 Oct.
    expect(sessionExpiry(rule, new Date("2026-10-18T23:30:00Z")).toISOString()).toBe("2026-10-19T00:30:00.000Z");
  });
  it("counts hours from the sign-in", () => {
    expect(sessionExpiry({ kind: "hours", hours: 24 }, new Date("2026-10-19T03:30:00Z")).toISOString()).toBe("2026-10-20T03:30:00.000Z");
  });
});
