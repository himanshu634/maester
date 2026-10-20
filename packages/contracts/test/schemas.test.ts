import { describe, expect, it } from "vitest";
import {
  ApiError,
  CreateUploadRequest,
  DecimalString,
  Document,
  DocumentFormat,
  DocumentVerifyResult,
  ExtractedCheck,
  ExtractionCheck,
  IntakeState,
  Isin,
  Job,
  JobTypes,
  ListQuery,
  Me,
  Membership,
  paginated,
  RejectionCode,
  toResultsSpan,
  XBRL_CHECK_SUBJECT,
  XBRL_PDF_CHECK_VERSION,
  XbrlFormat,
  XbrlPdfNotChecked,
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
      companyId: null,
      originalName: "test.pdf",
      declaredSize: 1024,
      declaredMime: "application/pdf",
      format: "pdf" as const,
      state: "stored" as const,
      contentSha256: "a".repeat(64),
      sizeBytes: 1024,
      rejectionCode: null,
      intakeState: null,
      duplicateOfDocumentId: null,
      classification: null,
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
  it("CreateUploadRequest takes an optional company and only allows PDF with a positive size", () => {
    const companyId = "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f12";
    expect(CreateUploadRequest.parse({ companyId, originalName: "a.pdf", size: 10, mimeType: "application/pdf" }).size).toBe(10);
    expect(CreateUploadRequest.parse({ originalName: "a.pdf", size: 10, mimeType: "application/pdf" }).companyId).toBeUndefined();
    expect(() => CreateUploadRequest.parse({ companyId: "not-a-uuid", originalName: "a.pdf", size: 10, mimeType: "application/pdf" })).toThrow();
    expect(() => CreateUploadRequest.parse({ companyId, originalName: "a.png", size: 10, mimeType: "image/png" })).toThrow();
    expect(() => CreateUploadRequest.parse({ companyId, originalName: "a.pdf", size: 0, mimeType: "application/pdf" })).toThrow();
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
      code: "UNSUPPORTED_TYPE",
    });
    expect(rejected.outcome).toBe("rejected");
    if (rejected.outcome === "rejected") expect(rejected.code).toBe("UNSUPPORTED_TYPE");
  });

  it("DocumentVerifyResult rejects invalid variants", () => {
    expect(() =>
      DocumentVerifyResult.parse({
        outcome: "stored",
        code: "UNSUPPORTED_TYPE",
      })
    ).toThrow();

    expect(() =>
      DocumentVerifyResult.parse({
        outcome: "nope",
      })
    ).toThrow();
  });
});

describe("XBRL contracts", () => {
  const check = {
    checkType: "subtotal",
    statement: "income_statement",
    basis: "consolidated",
    section: null,
    periodLabel: "Year ended 31 Mar 2026",
    subjectLabel: "Total income",
    status: "passed",
    expected: "10.00",
    actual: "10.00",
    detail: "adds up",
  };

  it("RejectionCode drops NOT_A_PDF for UNSUPPORTED_TYPE", () => {
    expect(RejectionCode.parse("UNSUPPORTED_TYPE")).toBe("UNSUPPORTED_TYPE");
    expect(() => RejectionCode.parse("NOT_A_PDF")).toThrow();
    expect(RejectionCode.options).toEqual(["UNSUPPORTED_TYPE", "TOO_LARGE", "OBJECT_MISSING"]);
  });

  it("a document has a format, pdf or xbrl", () => {
    expect(DocumentFormat.options).toEqual(["pdf", "xbrl"]);
    expect(() => DocumentFormat.parse("xml")).toThrow();
  });

  it("IntakeState has waiting_for_xbrl", () => {
    expect(IntakeState.parse("waiting_for_xbrl")).toBe("waiting_for_xbrl");
  });

  it("toResultsSpan maps the fact span to the classification span, and other to null", () => {
    expect(toResultsSpan("year")).toBe("full_year");
    expect(toResultsSpan("quarter")).toBe("quarter");
    expect(toResultsSpan("half_year")).toBe("half_year");
    expect(toResultsSpan("nine_months")).toBe("nine_months");
    expect(toResultsSpan("other")).toBeNull();
  });

  it("Isin is twelve characters: two letters, nine letters or digits and a check digit", () => {
    expect(Isin.parse("INE246F01010")).toBe("INE246F01010");
    expect(() => Isin.parse("INE246F0101")).toThrow();
    expect(() => Isin.parse("ine246f01010")).toThrow();
    expect(() => Isin.parse("INE246F0101A")).toThrow();
  });

  it("the wire's check types are two, and the API's are three", () => {
    expect(ExtractedCheck.parse(check).checkType).toBe("subtotal");
    expect(() => ExtractedCheck.parse({ ...check, checkType: "xbrl_in_pdf" })).toThrow();
    const row = { ...check, id: "6d5d1b0a-1e5e-4f6b-9f5d-2a4e1c9b7f10", checkType: "xbrl_in_pdf" };
    expect(ExtractionCheck.parse(row).checkType).toBe("xbrl_in_pdf");
  });

  it("the XBRL jobs, the check subject and the check version", () => {
    expect(JobTypes.DOCUMENT_XBRL).toBe("document.xbrl");
    expect(JobTypes.DOCUMENT_XBRL_CHECK).toBe("document.xbrl_check");
    expect(XBRL_CHECK_SUBJECT).toBe("xbrl_pdf_check");
    expect(XBRL_PDF_CHECK_VERSION).toBe(1);
  });

  it("XbrlFormat names a family, a kind, an id and whether the kind is mapped", () => {
    const f = XbrlFormat.parse({ family: "in-capmkt", kind: "ind_as", id: "in-capmkt/ind_as", mapped: true });
    expect(f.mapped).toBe(true);
    expect(XbrlFormat.parse({ family: null, kind: "unknown", id: null, mapped: false }).family).toBeNull();
    expect(() => XbrlFormat.parse({ family: "other", kind: "ind_as", id: null, mapped: true })).toThrow();
    expect(() => XbrlFormat.parse({ family: null, kind: "insurance", id: null, mapped: false })).toThrow();
  });

  it("XbrlPdfNotChecked has the seven reasons", () => {
    expect(XbrlPdfNotChecked.options).toEqual(["no_pdf", "scanned", "no_statement_pages", "disabled", "no_value", "no_unit", "not_yet"]);
  });
});
