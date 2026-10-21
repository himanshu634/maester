import { createHash } from "node:crypto";
import { EmbedderError, toStored, type Embedder } from "./embedder.js";
import { embeddingModel } from "./models.js";

const DEFAULT_MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";

export interface FakeEmbedderOptions {
  /** What `servedModel()` answers when it is not the model itself, such as the folder TEI is started on. */
  serves?: string;
}

/**
 * Deterministic embedder for tests: equal texts give equal unit vectors, whatever the kind. It makes the values the
 * model serves and hands them to `toStored`, as the TEI client does, so a model that serves 2048 values is cut and
 * a model that keeps 768 is padded by the same code.
 */
export class FakeEmbedder implements Embedder {
  private failures = 0;
  private failure: EmbedderError | undefined;
  constructor(
    readonly model: string = DEFAULT_MODEL,
    private readonly opts: FakeEmbedderOptions = {},
  ) {
    embeddingModel(model);
  }

  /** The next `times` calls to embed throw `err` (default: a retryable EMBEDDING_FAILED). */
  fail(times: number, err?: EmbedderError): void {
    this.failures = times;
    this.failure = err;
  }

  async servedModel(): Promise<string> {
    return this.opts.serves ?? this.model;
  }

  async embed(texts: string[], _kind: "query" | "document"): Promise<number[][]> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw this.failure ?? new EmbedderError("EMBEDDING_FAILED", true, "The fake embedder was told to fail.");
    }
    const served = embeddingModel(this.model).servedDimensions;
    return texts.map((t) => toStored(this.model, unitVector(t, served)));
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
