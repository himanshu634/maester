import { GoogleAuth } from "google-auth-library";
import { ClassifyResponse, ExtractorEvent, type ClassificationResult, type ExtractionResult } from "@maester/contracts";
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

export interface ExtractorClient {
  /**
   * Stream an extraction. `onEvent` sees every line, including heartbeats;
   * the promise resolves with the result or rejects with a JobFailure.
   */
  extract(input: ExtractRequest, onEvent: (event: ExtractorEvent) => Promise<void>): Promise<ExtractionResult>;
  /** Work out what a PDF is. Resolves with the answers or rejects with a JobFailure. */
  classify(input: ClassifyRequest): Promise<ClassificationResult>;
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
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/pdf", "x-document-id": input.documentId, ...headers, ...(await this.authHeaders()) },
        body: input.pdf,
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

    const decoder = new TextDecoder();
    let buffer = "";
    const handle = async (line: string): Promise<ExtractionResult | null> => {
      if (!line.trim()) return null;
      let parsed: ExtractorEvent;
      try {
        parsed = ExtractorEvent.parse(JSON.parse(line));
      } catch (err) {
        throw new JobFailure("INVALID_EXTRACTOR_RESULT", `unreadable extractor event: ${(err as Error).message.slice(0, 500)}`, false);
      }
      await onEvent(parsed);
      if (parsed.type === "error") throw new JobFailure(parsed.code, parsed.message, parsed.retryable);
      return parsed.type === "result" ? parsed.result : null;
    };

    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
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
      throw new JobFailure("EXTRACTOR_STREAM_INTERRUPTED", `extractor stream failed: ${(err as Error).message}`, true);
    }
    throw new JobFailure("EXTRACTOR_STREAM_INTERRUPTED", "extractor stream ended without a result", true);
  }
}
