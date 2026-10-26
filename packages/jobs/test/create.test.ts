import { describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS_BY_TYPE, maxAttemptsFor } from "../src/index.js";

describe("maxAttemptsFor", () => {
  it("gives the jobs that call a paid model 2 attempts", () => {
    expect(maxAttemptsFor(JobTypes.DOCUMENT_CLASSIFY)).toBe(2);
    expect(maxAttemptsFor(JobTypes.DOCUMENT_EXTRACT)).toBe(2);
    expect(MAX_ATTEMPTS_BY_TYPE).toEqual({ "document.classify": 2, "document.extract": 2 });
  });

  it("gives every other type the default", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
    expect(maxAttemptsFor(JobTypes.DOCUMENT_VERIFY)).toBe(5);
    expect(maxAttemptsFor("test.anything")).toBe(5);
    expect(maxAttemptsFor("toString")).toBe(5);
  });
});
