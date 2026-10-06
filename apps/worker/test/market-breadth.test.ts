import { describe, expect, it } from "vitest";
import { breadthOn } from "../src/market/breadth.js";
import { readMembers } from "../src/market/members.js";

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));

describe("breadthOn", () => {
  it("counts members above their 200-day average and net 52-week highs", () => {
    const d = days(260);
    const rising = d.map((day, i) => ({ day, value: 100 + i })); // above average, at a high
    const falling = d.map((day, i) => ({ day, value: 400 - i })); // below average, at a low
    const [last] = breadthOn(new Map([["UP", rising], ["DOWN", falling]]), [d.at(-1)!]);
    expect(last).toEqual({ day: d.at(-1), above200: 50, netHighs: 0 });
  });

  it("leaves out a member without enough history, never counting it as below", () => {
    const d = days(260);
    const rising = d.map((day, i) => ({ day, value: 100 + i }));
    const newListing = d.slice(-30).map((day, i) => ({ day, value: 50 + i }));
    const [last] = breadthOn(new Map([["UP", rising], ["NEW", newListing]]), [d.at(-1)!]);
    expect(last!.above200).toBe(100);
    expect(last!.netHighs).toBe(100);
  });

  it("gives null when no member has enough history", () => {
    const d = days(20);
    const [last] = breadthOn(new Map([["A", d.map((day) => ({ day, value: 1 }))]]), [d.at(-1)!]);
    expect(last).toEqual({ day: d.at(-1), above200: null, netHighs: null });
  });

  it("counts a member only when it has a close on that day", () => {
    const d = days(260);
    const rising = d.map((day, i) => ({ day, value: 100 + i }));
    const stopped = d.slice(0, 255).map((day, i) => ({ day, value: 400 - i })); // no close on the last day
    const [last] = breadthOn(new Map([["UP", rising], ["HALTED", stopped]]), [d.at(-1)!]);
    expect(last).toEqual({ day: d.at(-1), above200: 100, netHighs: 100 });
  });

  it("works out each requested day from the closes up to that day", () => {
    const d = days(300);
    // Rises for 260 days, then falls: above its average on day 259, a 52-week high there, neither later.
    const series = d.map((day, i) => ({ day, value: i < 260 ? 100 + i : 359 - 5 * (i - 259) }));
    const out = breadthOn(new Map([["X", series]]), [d[259]!, d[299]!]);
    expect(out).toEqual([
      { day: d[259], above200: 100, netHighs: 100 },
      { day: d[299], above200: 0, netHighs: 0 },
    ]);
  });
});

describe("readMembers", () => {
  it("reads the Symbol column, with quoted names that hold commas and a byte-order mark", () => {
    const url = new URL("./fixtures/nifty500-sample.csv", import.meta.url);
    expect(readMembers(url)).toEqual(["RELIANCE", "TCS", "M&M", "BAJAJ-AUTO"]);
  });

  it("gives an empty list when the file is not there", () => {
    expect(readMembers("/nonexistent/nifty500.csv")).toEqual([]);
  });
});
