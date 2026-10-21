import { STORED_DIMENSIONS, embeddingInput, embeddingModel } from "./models.js";

export interface Embedder {
  model: string;
  /** Vectors of `STORED_DIMENSIONS` values each: what `toStored` makes of the embedder's answer. */
  embed(texts: string[], kind: "query" | "document"): Promise<number[][]>;
  /** The model the embedder itself says it serves (text-embeddings-inference: `model_id` of `GET /info`). */
  servedModel(): Promise<string>;
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

/**
 * Whether the model an embedder says it serves is `model`. text-embeddings-inference reports the `--model-id` it was
 * started with, and Compose starts it on a folder (`/models/embed/<id>`), so the folder's tail names the model too.
 * The tail must start at a path separator: `XSnowflake/...` is another model than `Snowflake/...`.
 */
export function servesModel(served: string, model: string): boolean {
  return served === model || served.endsWith(`/${model}`);
}

/**
 * What an embedder's answer for one text becomes before it is stored or compared: the first `dimensions` values,
 * renormalised to unit length when any were cut, then padded with zeros to `STORED_DIMENSIONS`. Padding adds nothing
 * to a dot product or a norm, so cosine between two stored vectors equals cosine between the originals. This is the
 * only place a vector is cut or padded. An answer whose length is not what the model serves is refused, not guessed at.
 */
export function toStored(model: string, served: number[]): number[] {
  const m = embeddingModel(model);
  if (served.length !== m.servedDimensions) {
    throw new EmbedderError(
      "EMBEDDING_FAILED",
      false,
      `The embedder answered ${served.length} values for ${model}, which serves ${m.servedDimensions}.`,
    );
  }
  let kept = served.slice(0, m.dimensions);
  if (m.dimensions < m.servedDimensions) {
    const norm = Math.sqrt(kept.reduce((sum, x) => sum + x * x, 0));
    if (!(norm > 0)) {
      throw new EmbedderError("EMBEDDING_FAILED", false, `The first ${m.dimensions} values of the answer for ${model} have no length.`);
    }
    kept = kept.map((x) => x / norm);
  }
  return kept.concat(new Array<number>(STORED_DIMENSIONS - kept.length).fill(0));
}

export interface TeiOptions {
  timeoutMs?: number;
  /** Retries after the first attempt (default 3). */
  retries?: number;
  /** First wait before a retry; doubles each time (default 1000). */
  backoffMs?: number;
  /**
   * Whether a request that ran past `timeoutMs` is sent again (default true). The embedder keeps
   * working on a request the client gave up on, so a retry only queues behind it: a caller that
   * retries the whole job later sets this to false.
   */
  retryOnTimeout?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TeiEmbedder implements Embedder {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly retryOnTimeout: boolean;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    opts: TeiOptions = {},
  ) {
    embeddingModel(model);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.retries = opts.retries ?? 3;
    this.backoffMs = opts.backoffMs ?? 1000;
    this.retryOnTimeout = opts.retryOnTimeout ?? true;
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
      const signal = AbortSignal.timeout(this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal,
        });
      } catch {
        if (signal.aborted && !this.retryOnTimeout) throw this.timedOut();
        last = new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not answer.");
        continue;
      }
      if (res.ok) {
        let text: string;
        try {
          text = await res.text();
        } catch {
          if (signal.aborted && !this.retryOnTimeout) throw this.timedOut();
          last = new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder answer was cut short.");
          continue;
        }
        return this.check(this.parse(text), texts.length);
      }
      if (res.status >= 500 || res.status === 429) {
        last = new EmbedderError("EMBEDDING_FAILED", true, `The embedder answered ${res.status}.`);
        continue;
      }
      throw new EmbedderError("EMBEDDING_FAILED", false, `The embedder refused the request (${res.status}).`);
    }
    throw last ?? new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not answer.");
  }

  private timedOut(): EmbedderError {
    return new EmbedderError("EMBEDDER_UNAVAILABLE", true, `The embedder did not answer within ${this.timeoutMs} ms.`);
  }

  private parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new EmbedderError("EMBEDDING_FAILED", false, "The embedder answer was not JSON.");
    }
  }

  /**
   * Which model the embedder serves, from `GET /info`: one request, with the timeout and no retry. Whatever goes
   * wrong, the answer is the same: the embedder did not say, and the caller may try again later.
   */
  async servedModel(): Promise<string> {
    const unsaid = () => new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not say which model it serves.");
    let info: unknown;
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/info`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw unsaid();
      info = await res.json();
    } catch {
      throw unsaid();
    }
    const modelId = typeof info === "object" && info !== null ? (info as Record<string, unknown>).model_id : undefined;
    if (typeof modelId !== "string") throw unsaid();
    return modelId;
  }

  private check(data: unknown, count: number): number[][] {
    const served = embeddingModel(this.model).servedDimensions;
    const ok =
      Array.isArray(data) &&
      data.length === count &&
      data.every(
        (v) => Array.isArray(v) && v.length === served && v.every((n) => typeof n === "number"),
      );
    if (!ok) {
      throw new EmbedderError(
        "EMBEDDING_FAILED",
        false,
        `The embedder answer did not match ${count} vectors of ${served} dimensions.`,
      );
    }
    return (data as number[][]).map((v) => toStored(this.model, v));
  }
}
