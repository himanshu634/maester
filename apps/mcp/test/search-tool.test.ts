import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { FakeEmbedder } from "@maester/document-index";
import { SEARCH_FIGURES_SENTENCE } from "../src/present/search.js";
import { createHarness, textOf, type Chunk, type Harness } from "./harness.js";

const embedder = new FakeEmbedder();
const MODEL = embedder.model;
const UNAVAILABLE = "SEARCH_UNAVAILABLE: Search is not available: the embedder is not running or serves another model.";

let h: Harness;
let withSearch: Awaited<ReturnType<Harness["connectServer"]>>;
let mismatched: Awaited<ReturnType<Harness["connectServer"]>>;
let arDoc: string;
let xbrlDoc: string;

/** One document with the given chunks, indexed with this file's embedder. */
const seedIndexed = (ws: string, userId: string, companyId: string | null, name: string, chunks: Chunk[]) => h.seedIndexed(ws, userId, companyId, name, chunks, embedder);

beforeAll(async () => {
  h = await createHarness();
  const co = h.a.companies.synthetic!;
  arDoc = await seedIndexed(h.a.workspace.id, h.a.userId, co, "AR 2026.pdf", [
    { text: "The board met six times in the year", sectionPath: ["Governance"], pageNumber: 9 },
    { text: "Kilns ran at ninety percent of capacity", sectionPath: ["Operations"], pageNumber: 12, textSource: "ocr" },
    ...Array.from({ length: 10 }, (_, i) => ({ text: `Dispatch volumes note ${i}`, pageNumber: 20 + i })),
  ]);
  xbrlDoc = await seedIndexed(h.a.workspace.id, h.a.userId, co, "Results.xml", [
    { text: "Revenue from operations for the quarter", pageNumber: null, element: "RevenueFromOperations", textSource: "xbrl" },
  ]);
  await seedIndexed(h.a.workspace.id, h.a.userId, h.a.companies.harbour!, "Harbour AR.pdf", [{ text: "Harbour berth upgrade completed", pageNumber: 3 }]);
  await seedIndexed(h.b.workspace.id, h.b.userId, h.b.companies.other!, "Other AR.pdf", [{ text: "The board met six times in the year", pageNumber: 5 }]);
  withSearch = await h.connectServer(embedder);
  mismatched = await h.connectServer(new FakeEmbedder(MODEL, { serves: "some/other-model" }));
});
afterAll(async () => {
  await withSearch.close();
  await mismatched.close();
  await h.close();
});

type Passage = { text: string; filing: string; document_id: string; company_id: string | null; page: number | null; element: string | null; text_source: string; kind: string; section: string[] };
const search = (args: Record<string, unknown>, c = withSearch.client) => c.callTool({ name: "search_filings", arguments: args });
const passagesOf = (res: unknown) => (res as { structuredContent: { figures: string; passages: Passage[] } }).structuredContent;

describe("search_filings", () => {
  it("returns passages with the filing, the 1-based page, the text source and the fixed figures sentence", async () => {
    const res = await search({ query: "The board met six times in the year" });
    expect(res.isError).toBeFalsy();
    const body = passagesOf(res);
    expect(body.figures).toBe(SEARCH_FIGURES_SENTENCE);
    expect(body.passages[0]).toMatchObject({
      text: "The board met six times in the year", filing: "AR 2026.pdf", document_id: arDoc, company_id: h.a.companies.synthetic, page: 9, element: null,
      text_source: "text layer", kind: "prose", section: ["Governance"],
    });
    const ocr = (await search({ query: "Kilns ran at ninety percent of capacity" })).structuredContent as { passages: Passage[] };
    expect(ocr.passages[0]).toMatchObject({ page: 12, text_source: "OCR" });
    expect(textOf(res)).toContain(SEARCH_FIGURES_SENTENCE);
  });

  it("gives an XBRL passage its element and no page", async () => {
    const body = passagesOf(await search({ query: "Revenue from operations for the quarter" }));
    expect(body.passages[0]).toMatchObject({ document_id: xbrlDoc, page: null, element: "RevenueFromOperations", text_source: "XBRL" });
  });

  it("never returns another workspace's chunks", async () => {
    const res = await search({ query: "The board met six times in the year", limit: 20 });
    const all = JSON.stringify(res);
    expect(all).not.toContain("Other AR.pdf");
    expect(passagesOf(res).passages.every((p) => p.filing !== "Other AR.pdf")).toBe(true);
  });

  it("narrows to one company", async () => {
    const body = passagesOf(await search({ query: "berth", company_id: h.a.companies.harbour }));
    expect(body.passages.length).toBeGreaterThan(0);
    expect(body.passages.every((p) => p.company_id === h.a.companies.harbour)).toBe(true);
  });

  it("answers NOT_FOUND for another workspace's company", async () => {
    const res = await search({ query: "board", company_id: h.b.companies.other });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/^NOT_FOUND: /);
  });

  it("returns 8 passages when no limit is given and trims the query", async () => {
    const res = await search({ query: "  Dispatch volumes note  " });
    expect(passagesOf(res).passages).toHaveLength(8);
    expect(textOf(res)).toMatch(/^8 passages\./);
  });

  it("honours a limit of at most 20", async () => {
    expect(passagesOf(await search({ query: "Dispatch volumes note", limit: 3 })).passages).toHaveLength(3);
  });

  it("refuses a limit above 20, an empty query and a query over 500 characters, never UNAVAILABLE", async () => {
    for (const args of [{ query: "board", limit: 21 }, { query: "   " }, { query: "x".repeat(501) }, { query: "board", limit: 0 }]) {
      const res = await search(args);
      expect(res.isError, JSON.stringify(args).slice(0, 40)).toBe(true);
      expect(textOf(res)).toMatch(/Input validation error/);
      expect(textOf(res)).not.toContain("UNAVAILABLE");
    }
  });

  it("answers SEARCH_UNAVAILABLE without an embedder, while list_companies still answers", async () => {
    const res = await h.client.callTool({ name: "search_filings", arguments: { query: "board" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(UNAVAILABLE);
    expect(res.structuredContent).toBeUndefined();
    const companies = await h.client.callTool({ name: "list_companies", arguments: {} });
    expect(companies.isError).toBeFalsy();
  });

  it("answers SEARCH_UNAVAILABLE when the embedder serves another model", async () => {
    const res = await search({ query: "board" }, mismatched.client);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(UNAVAILABLE);
    const companies = await mismatched.client.callTool({ name: "list_companies", arguments: {} });
    expect(companies.isError).toBeFalsy();
  });

  it("answers SEARCH_UNAVAILABLE when the embedder fails while embedding the query", async () => {
    const failing = new FakeEmbedder();
    const c = await h.connectServer(failing);
    try {
      failing.fail(1);
      const res = await search({ query: "board" }, c.client);
      expect(res.isError).toBe(true);
      expect(textOf(res)).toBe(UNAVAILABLE);
    } finally {
      await c.close();
    }
  });

  it("says no passage matched in words when the company has nothing indexed", async () => {
    const empty = crypto.randomUUID();
    await h.db.insert(schema.company).values({ id: empty, workspaceId: h.a.workspace.id, displayName: "Unindexed Limited", country: "IN", createdByUserId: h.a.userId });
    const res = await search({ query: "board", company_id: empty });
    expect(res.isError).toBeFalsy();
    expect(passagesOf(res).passages).toEqual([]);
    expect(passagesOf(res).figures).toBe(SEARCH_FIGURES_SENTENCE);
    expect(textOf(res)).toMatch(/^No passage matched\./);
  });
});
