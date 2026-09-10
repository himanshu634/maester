import { describe, expect, it } from "vitest";
import {
  ApiError,
  CreateUploadRequest,
  DecimalString,
  Document,
  DocumentVerifyResult,
  Job,
  JobTypes,
  ListQuery,
  Me,
  Membership,
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
    const validDoc = {
      id: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10",
      workspaceId: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f11",
      originalName: "test.pdf",
      declaredSize: 1024,
      declaredMime: "application/pdf",
      state: "stored" as const,
      contentSha256: "a".repeat(64),
      sizeBytes: 1024,
      rejectionCode: null,
      createdAt: "2026-09-10T00:00:00.000Z",
      storedAt: "2026-09-10T01:00:00.000Z",
      latestJob: null,
    };
    const r = P.parse({ items: [validDoc], nextCursor: "cursor123" });
    expect(r.items[0]!.id).toBe("6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10");
    expect(r.nextCursor).toBe("cursor123");
    expect(() => P.parse({ items: [{ id: "not-a-uuid" }], nextCursor: null })).toThrow();
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

describe("workspace", () => {
  it("Me accepts valid structure with user and workspaces", () => {
    const me = Me.parse({
      user: {
        id: "user123",
        name: "John Doe",
        email: "john@example.com",
      },
      workspaces: [
        {
          id: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10",
          name: "My Workspace",
          ownerUserId: "user123",
          locale: "en-US",
          createdAt: "2026-09-10T00:00:00.000Z",
        },
      ],
    });
    expect(me.user.id).toBe("user123");
    expect(me.workspaces[0]!.name).toBe("My Workspace");
  });

  it("Membership rejects invalid role", () => {
    expect(() =>
      Membership.parse({
        id: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10",
        workspaceId: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f11",
        userId: "user123",
        role: "admin",
        state: "active",
      })
    ).toThrow();
  });
});

describe("payloads", () => {
  it("DocumentVerifyResult accepts both stored and rejected variants", () => {
    const stored = DocumentVerifyResult.parse({
      outcome: "stored",
      sha256: "a".repeat(64),
      sizeBytes: 10,
    });
    expect(stored.outcome).toBe("stored");
    if (stored.outcome === "stored") expect(stored.sha256).toBe("a".repeat(64));

    const rejected = DocumentVerifyResult.parse({
      outcome: "rejected",
      code: "NOT_A_PDF",
    });
    expect(rejected.outcome).toBe("rejected");
    if (rejected.outcome === "rejected") expect(rejected.code).toBe("NOT_A_PDF");
  });

  it("DocumentVerifyResult rejects invalid variants", () => {
    expect(() =>
      DocumentVerifyResult.parse({
        outcome: "stored",
        code: "NOT_A_PDF",
      })
    ).toThrow();

    expect(() =>
      DocumentVerifyResult.parse({
        outcome: "nope",
      })
    ).toThrow();
  });
});
