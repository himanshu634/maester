import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_MODELS, STORED_DIMENSIONS, embeddingInput, embeddingModel, indexPipelineVersion, toStored,
} from "../src/index.js";

const ARCTIC = "Snowflake/snowflake-arctic-embed-l-v2.0";
const QWEN = "Qwen/Qwen3-Embedding-0.6B";
const VOYAGE = "voyageai/voyage-4-nano";
const GRANITE = "ibm-granite/granite-embedding-english-r2";

// The same files are read by the indexer's parity check (apps/indexer), so the registry cannot drift from them.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../contracts/fixtures/index/${name}`, import.meta.url), "utf8"));

const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const unit = (v: number[]): number[] => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
};
const cosine = (a: number[], b: number[]): number => {
  const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
  return dot / (Math.hypot(...a) * Math.hypot(...b));
};

describe("models", () => {
  it("throws for an unlisted model", () => {
    expect(() => embeddingModel("nope")).toThrow();
    expect(() => embeddingModel("toString")).toThrow();
  });
  it("builds the pipeline version", () => {
    expect(indexPipelineVersion(ARCTIC)).toBe(`1:${ARCTIC}`);
  });
  it("adds the prefix to a query only", () => {
    expect(embeddingInput(ARCTIC, "query", "x")).toBe("query: x");
    expect(embeddingInput(ARCTIC, "document", "x")).toBe("x");
  });

  it("the registry is the shared fixture", () => {
    expect(Object.entries(EMBEDDING_MODELS).map(([id, m]) => ({ id, ...m }))).toEqual(fixture("embedding-models.json"));
  });
  it("every model keeps at most what it is served and what the column holds", () => {
    expect(STORED_DIMENSIONS).toBe(1024);
    for (const m of Object.values(EMBEDDING_MODELS)) {
      expect(m.dimensions).toBeLessThanOrEqual(Math.min(m.servedDimensions, STORED_DIMENSIONS));
    }
  });
  it("puts Qwen's instruction before a query only", () => {
    expect(embeddingInput(QWEN, "query", "x")).toBe(EMBEDDING_MODELS[QWEN]!.queryPrefix + "x");
    expect(embeddingInput(QWEN, "document", "x")).toBe("x");
    // The model card's format is `Instruct: {task}\nQuery:{query}`, with nothing between the colon and the query.
    expect(embeddingInput(QWEN, "query", "x")).toMatch(/^Instruct: .+\nQuery:x$/);
  });
  it("puts voyage's two prompts before a query and a document", () => {
    expect(embeddingInput(VOYAGE, "query", "x")).toBe("Represent the query for retrieving supporting documents: x");
    expect(embeddingInput(VOYAGE, "document", "x")).toBe("Represent the document for retrieval: x");
  });
  it("puts no prompt before granite's text", () => {
    expect(embeddingInput(GRANITE, "query", "x")).toBe("x");
    expect(embeddingInput(GRANITE, "document", "x")).toBe("x");
  });

  it("the parity fixture holds five queries and five documents of synthetic text", () => {
    const parity = fixture("embedding-parity.json") as { queries: string[]; documents: string[] };
    expect(Object.keys(parity).sort()).toEqual(["documents", "queries"]);
    for (const texts of [parity.queries, parity.documents]) {
      expect(texts).toHaveLength(5);
      expect(texts.every((t) => typeof t === "string" && t.trim().length > 0)).toBe(true);
    }
    expect([...parity.queries, ...parity.documents].every((t) => t.includes("Synthetic Cements Limited"))).toBe(true);
  });
});

describe("toStored", () => {
  it("pads a 768-dimension vector with zeros, and cosine is unchanged", () => {
    const a = unit([1, 1, ...zeros(766)]);
    const b = unit([0, 1, ...zeros(766)]);
    const [sa, sb] = [toStored(GRANITE, a), toStored(GRANITE, b)] as [number[], number[]];
    expect(sa).toHaveLength(1024);
    expect(sa.slice(0, 768)).toEqual(a);
    expect(sa.slice(768).every((x) => x === 0)).toBe(true);
    expect(cosine(sa, sb)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(cosine(sa, sb)).toBeCloseTo(cosine(a, b), 12);
  });
  it("does not renormalise a vector it only padded", () => {
    const v = [...zeros(767), 2];
    expect(toStored(GRANITE, v)[767]).toBe(2);
  });
  it("cuts voyage's 2048 values to the first 1024 and renormalises", () => {
    const v = zeros(2048);
    v[0] = 0.6;
    v[1024] = 0.8;
    expect(toStored(VOYAGE, v)).toEqual([1, ...zeros(1023)]);
  });
  it("leaves a vector that is served whole and kept whole as it is", () => {
    const v = unit(Array.from({ length: 1024 }, (_, i) => i + 1));
    expect(toStored(ARCTIC, v)).toEqual(v);
    expect(toStored(QWEN, v)).toEqual(v);
  });
  it("refuses an answer of the wrong served length", () => {
    expect(() => toStored(GRANITE, zeros(1024))).toThrow(/768/);
    expect(() => toStored(VOYAGE, zeros(1024))).toThrow(/2048/);
    expect(() => toStored(ARCTIC, zeros(768))).toThrow(/1024/);
    expect(() => toStored(GRANITE, zeros(1024))).toThrowError(expect.objectContaining({ code: "EMBEDDING_FAILED", retryable: false }));
  });
  it("refuses a model that is not listed", () => {
    expect(() => toStored("nope", zeros(1024))).toThrow(/Unknown embedding model/);
  });
});
