import { GoogleAuth } from "google-auth-library";
import {
  ClassifyResponse,
  ExtractorEvent,
  XbrlEvent,
  XbrlPdfCheckResult,
  type ClassificationResult,
  type ExtractionResult,
  type XbrlClassification,
  type XbrlMode,
  type XbrlPdfCheckRequest,
  type XbrlReadResult,
  type XbrlTextResult,
} from "@maester/contracts";
import { JobFailure } from "./jobs/types.js";

export interface ExtractRequest {
  pdf: Uint8Array;
  documentId: string;
  companyName: string | null;
}

export interface ClassifyRequest {
  pdf: Uint8Array;
  documentId: string;
}

export interface XbrlRequest<M extends XbrlMode> {
  instance: Uint8Array;
  documentId: string;
  mode: M;
}

export interface XbrlPdfCheckInput {
  pdf: Uint8Array;
  documentId: string;
  request: XbrlPdfCheckRequest;
}

export interface ExtractorClient {
  /**
   * Stream an extraction. `onEvent` sees every line, including heartbeats;
   * the promise resolves with the result or rejects with a JobFailure.
   */
  extract(input: ExtractRequest, onEvent: (event: ExtractorEvent) => Promise<void>): Promise<ExtractionResult>;
  /** Work out what a PDF is. Resolves with the answers or rejects with a JobFailure. */
  classify(input: ClassifyRequest): Promise<ClassificationResult>;
  /**
   * Read an XBRL instance in one mode. `onEvent` sees every line, including heartbeats; the promise resolves with the
   * mode's result or rejects with a JobFailure (an `error` event is its own failure).
   */
  xbrl(input: XbrlRequest<"classify">, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlClassification>;
  xbrl(input: XbrlRequest<"read">, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlReadResult>;
  xbrl(input: XbrlRequest<"text">, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlTextResult>;
  /** Look for an XBRL revision's values on a PDF's statement pages. A multipart POST with the parts `pdf` and `request`. */
  xbrlPdfCheck(input: XbrlPdfCheckInput): Promise<XbrlPdfCheckResult>;
}

export type ExtractorAuth = { kind: "secret"; secret: string } | { kind: "oidc" };

/** Calls apps/extractor over HTTP and reads its NDJSON stream. */
export class HttpExtractorClient implements ExtractorClient {
  private readonly auth = new GoogleAuth();

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: ExtractorAuth,
    private readonly timeoutMs: number,
  ) {}

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.credentials.kind === "secret") return { "x-extractor-secret": this.credentials.secret };
    // Cloud Run IAM: an ID token whose audience is the extractor's URL.
    const client = await this.auth.getIdTokenClient(this.baseUrl);
    const headers = await client.getRequestHeaders(this.baseUrl);
    const authorization = headers.get("authorization");
    if (!authorization) throw new JobFailure("EXTRACTOR_UNAUTHORIZED", "could not obtain an ID token for the extractor", true);
    return { authorization };
  }

  private async post(path: string, input: { pdf: Uint8Array; documentId: string }, headers: Record<string, string>): Promise<Response> {
    return this.send(path, { "content-type": "application/pdf", "x-document-id": input.documentId, ...headers }, input.pdf);
  }

  /** POST a body and map a transport or HTTP failure to a JobFailure. A FormData body sets its own content type. */
  private async send(path: string, headers: Record<string, string>, body: Uint8Array | FormData): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { ...headers, ...(await this.authHeaders()) },
        body: body as RequestInit["body"],
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof JobFailure) throw err;
      throw new JobFailure("EXTRACTOR_UNAVAILABLE", `extractor request failed: ${(err as Error).message}`, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new JobFailure("EXTRACTOR_UNAUTHORIZED", `extractor refused the request (${res.status})`, false);
    }
    if (res.status === 413) throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", "the document is too large to extract", false);
    if (!res.ok || !res.body) {
      throw new JobFailure(`EXTRACTOR_HTTP_${res.status}`, `extractor answered ${res.status}`, res.status >= 500);
    }
    return res;
  }

  async classify(input: ClassifyRequest): Promise<ClassificationResult> {
    const res = await this.post("/v1/classify", input, {});
    let parsed: ClassifyResponse;
    try {
      parsed = ClassifyResponse.parse(await res.json());
    } catch (err) {
      throw new JobFailure("INVALID_CLASSIFIER_RESULT", `unreadable classifier answer: ${(err as Error).message.slice(0, 500)}`, false);
    }
    if (parsed.type === "error") throw new JobFailure(parsed.code, parsed.message, parsed.retryable);
    return parsed.result;
  }

  async extract(input: ExtractRequest, onEvent: (event: ExtractorEvent) => Promise<void>): Promise<ExtractionResult> {
    const res = await this.post("/v1/extract", input, input.companyName ? { "x-company-name": encodeURIComponent(input.companyName) } : {});
    return readNdjson(res, ExtractorEvent, onEvent, (e) => (e.type === "result" ? e.result : null));
  }

  xbrl(input: XbrlRequest<"classify">, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlClassification>;
  xbrl(input: XbrlRequest<"read">, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlReadResult>;
  xbrl(input: XbrlRequest<"text">, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlTextResult>;
  async xbrl(input: XbrlRequest<XbrlMode>, onEvent: (event: XbrlEvent) => Promise<void>): Promise<XbrlClassification | XbrlReadResult | XbrlTextResult> {
    const res = await this.send(
      "/v1/xbrl",
      { "content-type": "application/xml", "x-document-id": input.documentId, "x-xbrl-mode": input.mode },
      input.instance,
    );
    const terminal = { classify: "classification", read: "read", text: "text" }[input.mode];
    return readNdjson(res, XbrlEvent, onEvent, (e) => (e.type === terminal && "result" in e ? e.result : null));
  }

  async xbrlPdfCheck(input: XbrlPdfCheckInput): Promise<XbrlPdfCheckResult> {
    const form = new FormData();
    form.append("pdf", new Blob([input.pdf], { type: "application/pdf" }), "document.pdf");
    form.append("request", JSON.stringify(input.request));
    const res = await this.send("/v1/xbrl/pdf-check", { "x-document-id": input.documentId }, form);
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new JobFailure("INVALID_EXTRACTOR_RESULT", `unreadable XBRL check answer: ${(err as Error).message.slice(0, 500)}`, false);
    }
    const failed = ClassifyResponse.safeParse(body);
    if (failed.success && failed.data.type === "error") throw new JobFailure(failed.data.code, failed.data.message, failed.data.retryable);
    const parsed = XbrlPdfCheckResult.safeParse(body);
    if (!parsed.success) throw new JobFailure("INVALID_EXTRACTOR_RESULT", `unreadable XBRL check answer: ${parsed.error.message.slice(0, 500)}`, false);
    return parsed.data;
  }
}

/**
 * Read an NDJSON response line by line. `onEvent` sees each parsed event, then an `error` event throws as its own
 * JobFailure; `pick` returns the result of the terminal event, or null for any other line. A stream that ends or breaks
 * with no result is retryable.
 */
async function readNdjson<E extends { type: string }, R>(
  res: Response,
  schema: { parse(value: unknown): E },
  onEvent: (event: E) => Promise<void>,
  pick: (event: E) => R | null,
): Promise<R> {
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = async (line: string): Promise<R | null> => {
    if (!line.trim()) return null;
    let parsed: E;
    try {
      parsed = schema.parse(JSON.parse(line));
    } catch (err) {
      throw new JobFailure("INVALID_EXTRACTOR_RESULT", `unreadable extractor event: ${(err as Error).message.slice(0, 500)}`, false);
    }
    await onEvent(parsed);
    if (parsed.type === "error") {
      const e = parsed as unknown as { code: string; message: string; retryable: boolean };
      throw new JobFailure(e.code, e.message, e.retryable);
    }
    return pick(parsed);
  };

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const result = await handle(line);
        if (result !== null) return result;
      }
    }
    const result = await handle(buffer + decoder.decode());
    if (result !== null) return result;
  } catch (err) {
    if (err instanceof JobFailure) throw err;
    throw new JobFailure("EXTRACTOR_STREAM_INTERRUPTED", `extractor stream failed: ${(err as Error).message}`, true);
  }
  throw new JobFailure("EXTRACTOR_STREAM_INTERRUPTED", "extractor stream ended without a result", true);
}
