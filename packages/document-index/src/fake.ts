import { createHash } from "node:crypto";
import { EmbedderError, type Embedder } from "./embedder.js";
import { embeddingInput, embeddingModel } from "./models.js";

const DEFAULT_MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";

/** Deterministic embedder for tests: equal inputs give equal unit vectors. */
export class FakeEmbedder implements Embedder {
  private failures = 0;
  constructor(readonly model: string = DEFAULT_MODEL) {
    embeddingModel(model);
  }

  /** The next `times` calls to embed throw a retryable EMBEDDING_FAILED. */
  fail(times: number): void {
    this.failures = times;
  }

  async embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new EmbedderError("EMBEDDING_FAILED", true, "The fake embedder was told to fail.");
    }
    const dims = embeddingModel(this.model).dimensions;
    return texts.map((t) => unitVector(embeddingInput(this.model, kind, t), dims));
  }
}

function unitVector(text: string, dims: number): number[] {
  const bytes: number[] = [];
  for (let block = 0; bytes.length < dims * 4; block++) {
    bytes.push(...createHash("sha256").update(`${block}:${text}`).digest());
  }
  const v = Array.from({ length: dims }, (_, i) => {
    const n = (bytes[i * 4]! << 24) | (bytes[i * 4 + 1]! << 16) | (bytes[i * 4 + 2]! << 8) | bytes[i * 4 + 3]!;
    return n / 2 ** 31;
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}
