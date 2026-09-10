import { describe, expect, it } from "vitest";
import {
  ApiError,
  CreateUploadRequest,
  DecimalString,
  Document,
  Job,
  JobTypes,
  ListQuery,
  paginated,
} from "../src/index.js";

describe("common", () => {
  it("accepts a valid error envelope", () => {
    const parsed = ApiError.parse({
      error: { code: "VALIDATION_FAILED", message: "bad", fields: [{ path: "size", message: "too big" }], traceId: "t1" },
    });
    expect(parsed.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an unknown error code", () => {
    expect(() => ApiError.parse({ error: { code: "NOPE", message: "x", traceId: "t" } })).toThrow();
  });

  it("DecimalString accepts plain decimals only", () => {
    expect(DecimalString.parse("2217.00")).toBe("2217.00");
    expect(DecimalString.parse("-5")).toBe("-5");
    expect(() => DecimalString.parse("1e3")).toThrow();
    expect(() => DecimalString.parse("NaN")).toThrow();
  });

  it("ListQuery defaults limit to 25 and caps at 100", () => {
    expect(ListQuery.parse({}).limit).toBe(25);
    expect(() => ListQuery.parse({ limit: "101" })).toThrow();
    expect(ListQuery.parse({ limit: "10" }).limit).toBe(10);
  });

  it("paginated wraps items with nextCursor", () => {
    const P = paginated(Document);
    const r = P.parse({ items: [], nextCursor: null });
    expect(r.nextCursor).toBeNull();
  });
});

describe("document", () => {
  it("CreateUploadRequest only allows PDF and positive size", () => {
    expect(CreateUploadRequest.parse({ originalName: "a.pdf", size: 10, mimeType: "application/pdf" }).size).toBe(10);
    expect(() => CreateUploadRequest.parse({ originalName: "a.png", size: 10, mimeType: "image/png" })).toThrow();
    expect(() => CreateUploadRequest.parse({ originalName: "a.pdf", size: 0, mimeType: "application/pdf" })).toThrow();
  });
});

describe("job", () => {
  it("Job round-trips", () => {
    const j = Job.parse({
      id: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10",
      workspaceId: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f11",
      type: JobTypes.DOCUMENT_VERIFY,
      subjectType: "document",
      subjectId: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f12",
      state: "queued",
      attempt: 0,
      maxAttempts: 5,
      progress: {},
      result: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-09-10T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
    expect(j.state).toBe("queued");
  });
});
