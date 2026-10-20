import { embeddingInput, embeddingModel } from "./models.js";

export interface Embedder {
  model: string;
  embed(texts: string[], kind: "query" | "document"): Promise<number[][]>;
}

export class EmbedderError extends Error {
  constructor(
    readonly code: "EMBEDDING_FAILED" | "EMBEDDER_UNAVAILABLE",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "EmbedderError";
  }
}

export interface TeiOptions {
  timeoutMs?: number;
  /** Retries after the first attempt (default 3). */
  retries?: number;
  /** First wait before a retry; doubles each time (default 1000). */
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TeiEmbedder implements Embedder {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    opts: TeiOptions = {},
  ) {
    embeddingModel(model);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.retries = opts.retries ?? 3;
    this.backoffMs = opts.backoffMs ?? 1000;
  }

  async embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body = JSON.stringify({
      inputs: texts.map((t) => embeddingInput(this.model, kind, t)),
      normalize: true,
      truncate: false,
    });
    let last: EmbedderError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(this.backoffMs * 2 ** (attempt - 1));
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        last = new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not answer.");
        continue;
      }
      if (res.ok) return this.check(await this.read(res), texts.length);
      if (res.status >= 500 || res.status === 429) {
        last = new EmbedderError("EMBEDDING_FAILED", true, `The embedder answered ${res.status}.`);
        continue;
      }
      throw new EmbedderError("EMBEDDING_FAILED", false, `The embedder refused the request (${res.status}).`);
    }
    throw last ?? new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not answer.");
  }

  private async read(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new EmbedderError("EMBEDDING_FAILED", false, "The embedder answer was not JSON.");
    }
  }

  private check(data: unknown, count: number): number[][] {
    const dims = embeddingModel(this.model).dimensions;
    const ok =
      Array.isArray(data) &&
      data.length === count &&
      data.every(
        (v) => Array.isArray(v) && v.length === dims && v.every((n) => typeof n === "number"),
      );
    if (!ok) {
      throw new EmbedderError(
        "EMBEDDING_FAILED",
        false,
        `The embedder answer did not match ${count} vectors of ${dims} dimensions.`,
      );
    }
    return data as number[][];
  }
}
