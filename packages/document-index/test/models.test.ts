import { describe, expect, it } from "vitest";
import { embeddingInput, embeddingModel, indexPipelineVersion } from "../src/index.js";

const M = "Snowflake/snowflake-arctic-embed-l-v2.0";

describe("models", () => {
  it("throws for an unlisted model", () => {
    expect(() => embeddingModel("nope")).toThrow();
    expect(() => embeddingModel("toString")).toThrow();
  });
  it("builds the pipeline version", () => {
    expect(indexPipelineVersion(M)).toBe(`1:${M}`);
  });
  it("adds the prefix to a query only", () => {
    expect(embeddingInput(M, "query", "x")).toBe("query: x");
    expect(embeddingInput(M, "document", "x")).toBe("x");
  });
});
