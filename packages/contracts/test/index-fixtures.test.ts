import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChunkRequest, ChunkTextRequest, ChunkTextResponse, contextualize, DOCUMENT_INDEX_SUBJECT, IndexerEvent, JobTypes } from "../src/index.js";

// The same files are read by the indexer's Pydantic models (apps/indexer/tests/test_contracts.py).
const dir = new URL("../fixtures/index/", import.meta.url);
const text = (f: string) => readFileSync(new URL(f, dir), "utf8");
const lines = (f: string) =>
  text(f)
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("indexer stream fixtures", () => {
  for (const file of ["stream-range.ndjson", "stream-error.ndjson"]) {
    it(`${file}: every line is an IndexerEvent and the stream ends with one terminal event`, () => {
      const events = lines(file).map((l) => IndexerEvent.parse(l));
      const terminal = events.filter((e) => e.type === "result" || e.type === "error");
      expect(terminal).toHaveLength(1);
      expect(events.at(-1)).toBe(terminal[0]);
    });
  }

  it("the range stream covers the cases the worker handles", () => {
    const events = lines("stream-range.ndjson").map((l) => IndexerEvent.parse(l));
    const chunks = events.flatMap((e) => (e.type === "chunk" ? [e] : []));
    expect(chunks).toHaveLength(4);
    expect(new Set(chunks.map((c) => c.textSource))).toEqual(new Set(["text_layer", "ocr", "mixed"]));
    expect(chunks.some((c) => c.kind === "table")).toBe(true);
    expect(events.some((e) => e.type === "page" && e.itemsOcr > 0)).toBe(true);
  });

  it("refuses an unknown text source and page 0", () => {
    const chunk = lines("stream-range.ndjson").find((l) => l.type === "chunk")!;
    const page = lines("stream-range.ndjson").find((l) => l.type === "page")!;
    expect(IndexerEvent.safeParse({ ...chunk, textSource: "scan" }).success).toBe(false);
    expect(IndexerEvent.safeParse({ ...page, pageNumber: 0 }).success).toBe(false);
    expect(IndexerEvent.safeParse({ ...chunk, seq: -1 }).success).toBe(false);
  });

  it("takes PAGE_UNREADABLE for a page Docling could not read", () => {
    const page = lines("stream-range.ndjson").find((l) => l.type === "page")!;
    expect(IndexerEvent.safeParse({ ...page, text: "", noneReason: "PAGE_UNREADABLE" }).success).toBe(true);
  });

  it("refuses an unknown field instead of dropping it", () => {
    const page = lines("stream-range.ndjson").find((l) => l.type === "page")!;
    const result = lines("stream-range.ndjson").find((l) => l.type === "result")! as { read: Record<string, unknown> };
    expect(IndexerEvent.safeParse({ ...page, unexpected: true }).success).toBe(false);
    expect(IndexerEvent.safeParse({ ...result, read: { ...result.read, unexpected: true } }).success).toBe(false);
    const request = JSON.parse(text("chunk-request.json")) as Record<string, unknown>;
    expect(ChunkRequest.safeParse({ ...request, unexpected: true }).success).toBe(false);
  });
});

describe("ChunkRequest", () => {
  it("parses the fixture", () => {
    expect(ChunkRequest.parse(JSON.parse(text("chunk-request.json"))).read.pages).toHaveLength(3);
  });
});

describe("ChunkTextRequest and ChunkTextResponse", () => {
  const request = () => JSON.parse(text("chunk-text-request.json")) as Record<string, unknown>;
  const response = () => JSON.parse(text("chunk-text-response.json")) as { chunks: Record<string, unknown>[] };

  it("parse their fixtures, which cover a prose and a table chunk across two blocks", () => {
    expect(ChunkTextRequest.parse(request()).blocks).toHaveLength(2);
    const parsed = ChunkTextResponse.parse(response());
    expect(parsed.chunks.map((c) => [c.seq, c.kind, c.basis])).toEqual([[0, "prose", "consolidated"], [1, "table", "consolidated"]]);
    expect(parsed.versions.tokenizer).toBe(ChunkTextRequest.parse(request()).embeddingModel);
  });

  it("take no basis other than the two, and a null one", () => {
    expect(ChunkTextRequest.safeParse({ ...request(), basis: null }).success).toBe(true);
    expect(ChunkTextRequest.safeParse({ ...request(), basis: "unknown" }).success).toBe(false);
  });

  it("refuse an unknown field, a negative seq and a chunk with no element", () => {
    const r = response();
    expect(ChunkTextRequest.safeParse({ ...request(), unexpected: true }).success).toBe(false);
    expect(ChunkTextResponse.safeParse({ ...r, unexpected: true }).success).toBe(false);
    expect(ChunkTextResponse.safeParse({ ...r, chunks: [{ ...r.chunks[0], seq: -1 }] }).success).toBe(false);
    expect(ChunkTextResponse.safeParse({ ...r, chunks: [{ ...r.chunks[0], element: undefined }] }).success).toBe(false);
  });
});

describe("contextualize", () => {
  const cases = JSON.parse(text("contextualize.json")) as { sectionPath: string[]; text: string; expected: string }[];
  it("has the empty, one and three entry cases", () => {
    expect(cases.map((c) => c.sectionPath.length)).toEqual([0, 1, 3]);
  });
  for (const c of cases) {
    it(`gives the expected text for a path of ${c.sectionPath.length}`, () => {
      expect(contextualize(c.sectionPath, c.text)).toBe(c.expected);
    });
  }
});

describe("job constants", () => {
  it("names the index job", () => {
    expect(JobTypes.DOCUMENT_INDEX).toBe("document.index");
    expect(DOCUMENT_INDEX_SUBJECT).toBe("document_index");
  });
});
