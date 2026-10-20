import { IndexerEvent, IndexerVersions, type ChunkRequest, type RangeRead } from "@maester/contracts";
import { JobFailure } from "./jobs/types.js";

type Started = Extract<IndexerEvent, { type: "started" }>;
type PageEvent = Extract<IndexerEvent, { type: "page" }>;
type ChunkEvent = Extract<IndexerEvent, { type: "chunk" }>;

export interface IndexResult {
  started: Started;
  pages: PageEvent[];
  chunks: ChunkEvent[];
  /** Null from `chunk`, which reads nothing. */
  read: RangeRead | null;
  ocrPages: number;
}

export interface IndexInput {
  pdf: Uint8Array;
  documentId: string;
  firstPage: number;
  lastPage: number;
  sectionPathBefore: string[];
  ocrPagesLeft: number;
  signal: AbortSignal;
}

export interface IndexerClient {
  /** The versions the indexer runs with. Rejects with a JobFailure. */
  versions(): Promise<IndexerVersions>;
  /** Read and chunk a page range. `onEvent` sees every line, including heartbeats. Rejects with a JobFailure. */
  index(input: IndexInput, onEvent: (event: IndexerEvent) => Promise<void>): Promise<IndexResult>;
  /** Chunk a cached range read again. */
  chunk(request: ChunkRequest, signal: AbortSignal, onEvent: (event: IndexerEvent) => Promise<void>): Promise<IndexResult>;
}

const VERSIONS_TIMEOUT_MS = 30_000;

/** Calls apps/indexer over HTTP and reads its NDJSON stream. */
export class HttpIndexerClient implements IndexerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly embeddingModel: string,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url(path), { ...init, headers: { ...(init.headers as Record<string, string>), "x-indexer-secret": this.secret }, signal });
    } catch (err) {
      if (signal.aborted) throw new JobFailure("INDEX_TIMEOUT", "the indexer call timed out or was cancelled", true);
      throw new JobFailure("INDEXER_UNAVAILABLE", `indexer request failed: ${(err as Error).message}`, true);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new JobFailure("INDEXER_UNAUTHORIZED", `indexer refused the request (${res.status})`, false);
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new JobFailure(`INDEXER_HTTP_${res.status}`, `indexer answered ${res.status}`, res.status >= 500);
    }
    return res;
  }

  async versions(): Promise<IndexerVersions> {
    const res = await this.request("/v1/versions", { method: "GET" }, AbortSignal.timeout(VERSIONS_TIMEOUT_MS));
    try {
      return IndexerVersions.parse(await res.json());
    } catch (err) {
      throw new JobFailure("INVALID_INDEXER_RESULT", `unreadable indexer versions: ${(err as Error).message.slice(0, 500)}`, false);
    }
  }

  async index(input: IndexInput, onEvent: (event: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    const res = await this.request(
      "/v1/index",
      {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
          "x-document-id": input.documentId,
          "x-page-range": `${input.firstPage}-${input.lastPage}`,
          "x-section-path": Buffer.from(JSON.stringify(input.sectionPathBefore)).toString("base64url"),
          "x-ocr-pages-left": String(input.ocrPagesLeft),
          "x-embedding-model": this.embeddingModel,
        },
        body: input.pdf,
      },
      input.signal,
    );
    return this.readStream(res, input.signal, onEvent);
  }

  async chunk(request: ChunkRequest, signal: AbortSignal, onEvent: (event: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    const res = await this.request(
      "/v1/chunk",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      signal,
    );
    return this.readStream(res, signal, onEvent);
  }

  private async readStream(res: Response, signal: AbortSignal, onEvent: (event: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    let started: Started | null = null;
    const pages: PageEvent[] = [];
    const chunks: ChunkEvent[] = [];
    const handle = async (line: string): Promise<IndexResult | null> => {
      if (!line.trim()) return null;
      let parsed: IndexerEvent;
      try {
        parsed = IndexerEvent.parse(JSON.parse(line));
      } catch (err) {
        // The message names the failing field, never the line: a line can carry document text.
        throw new JobFailure("INVALID_INDEXER_RESULT", `unreadable indexer event: ${err instanceof SyntaxError ? "not JSON" : issuePaths(err)}`, false);
      }
      await onEvent(parsed);
      switch (parsed.type) {
        case "started":
          started = parsed;
          return null;
        case "page":
          pages.push(parsed);
          return null;
        case "chunk":
          chunks.push(parsed);
          return null;
        case "error":
          throw new JobFailure(parsed.code, parsed.message, parsed.retryable);
        case "result":
          if (!started) throw new JobFailure("INVALID_INDEXER_RESULT", "the indexer answered with a result before it started", false);
          return { started, pages, chunks, read: parsed.read, ocrPages: parsed.ocrPages };
        default:
          return null;
      }
    };

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(part, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const result = await handle(line);
          if (result) return result;
        }
      }
      const result = await handle(buffer + decoder.decode());
      if (result) return result;
    } catch (err) {
      if (err instanceof JobFailure) throw err;
      if (signal.aborted) throw new JobFailure("INDEX_TIMEOUT", "the indexer call timed out or was cancelled", true);
      throw new JobFailure("INDEX_STREAM_INTERRUPTED", `indexer stream failed: ${(err as Error).message}`, true);
    }
    if (signal.aborted) throw new JobFailure("INDEX_TIMEOUT", "the indexer call timed out or was cancelled", true);
    throw new JobFailure("INDEX_STREAM_INTERRUPTED", "indexer stream ended without a result", true);
  }
}

function issuePaths(err: unknown): string {
  const issues = (err as { issues?: { path: PropertyKey[]; code: string }[] }).issues;
  return issues ? issues.slice(0, 5).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.code}`).join("; ") : "invalid shape";
}
