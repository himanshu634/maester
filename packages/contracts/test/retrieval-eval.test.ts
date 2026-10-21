import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvalDocument, EvalRequest } from "../src/index.js";

// The same file is read by apps/eval's EvalRequestModel (eval_wire.py), so a change to one side fails the other.
const request = () => JSON.parse(readFileSync(new URL("../fixtures/eval/request.json", import.meta.url), "utf8")) as Record<string, unknown>;

describe("EvalRequest", () => {
  it("parses the shared fixture", () => {
    const parsed = EvalRequest.parse(request());
    expect(parsed.version).toBe(1);
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.questions.map((q) => q.id)).toEqual(["q001"]);
  });

  it("refuses a question id Q1 and a sha256 of 63 characters", () => {
    const r = request() as { documents: { sha256: string }[]; questions: { id: string }[] };
    expect(EvalRequest.safeParse({ ...r, questions: [{ ...r.questions[0]!, id: "Q1" }] }).success).toBe(false);
    expect(EvalRequest.safeParse({ ...r, documents: [{ ...r.documents[0]!, sha256: r.documents[0]!.sha256.slice(1) }] }).success).toBe(false);
  });

  it("refuses a field the Python twin does not know, an empty scope and another version", () => {
    const r = request() as { documents: object[]; questions: object[] };
    expect(EvalRequest.safeParse({ ...r, extra: 1 }).success).toBe(false);
    expect(EvalRequest.safeParse({ ...r, documents: [{ ...r.documents[0]!, extra: 1 }] }).success).toBe(false);
    expect(EvalRequest.safeParse({ ...r, questions: [{ ...r.questions[0]!, scope: [] }] }).success).toBe(false);
    expect(EvalRequest.safeParse({ ...r, version: 2 }).success).toBe(false);
  });
});

describe("EvalDocument", () => {
  it("takes a resolved document and one that is not stored", () => {
    const resolved = {
      filing: "aether-industries/ar-2024-25", sha256: "a".repeat(64), documentId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      state: "complete", versions: { indexVersion: "1", doclingVersion: "2.134.0", ocrEngine: "rapidocr", readerOptions: "x", chunkerVersion: "1" },
      chunks: 12, pages: [{ page: 1, source: "text_layer" }, { page: 2, source: "none" }],
    };
    expect(EvalDocument.safeParse(resolved).success).toBe(true);
    const missing = { filing: "x", sha256: "b".repeat(64), documentId: null, revisionId: null, state: null, versions: null, chunks: 0, pages: [] };
    expect(EvalDocument.safeParse(missing).success).toBe(true);
    expect(EvalDocument.safeParse({ ...resolved, pages: [{ page: 0, source: "ocr" }] }).success).toBe(false);
    expect(EvalDocument.safeParse({ ...resolved, pages: [{ page: 1, source: "scan" }] }).success).toBe(false);
    expect(EvalDocument.safeParse({ ...resolved, state: "building" }).success).toBe(false);
  });
});
