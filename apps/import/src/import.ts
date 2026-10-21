import { readFile } from "node:fs/promises";
import { walk, type FoundFile } from "./walk.js";

export const MAX_FILE_BYTES = 52428800;
const RETRY_WAITS_MS = [1000, 2000];

export type ImportResult = {
  sent: number;
  refused: { name: string; code: string }[];
  failed: { name: string; code: string }[];
  stopped: "signed_out" | null;
};

export type ImportOptions = {
  apiUrl: string;
  workspaceId: string;
  cookie: string;
  folder: string;
  concurrency?: number;
  fetch?: typeof fetch;
  onSettled?: (n: number, total: number) => void;
};

type Outcome = { kind: "sent" } | { kind: "refused" | "failed"; code: string } | { kind: "signed_out" };

/** Why one request did not go through. Carries a status and an error code, never a body. */
class StepError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mimeOf(name: string): string {
  return name.toLowerCase().endsWith(".xml") ? "application/xml" : "application/pdf";
}

/** The API's error code from a response, or HTTP_<status> when the body has none. */
async function codeOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string") return body.error.code;
  } catch {
    // No JSON body: the status is the code.
  }
  return `HTTP_${res.status}`;
}

export async function importFolder(opts: ImportOptions): Promise<ImportResult> {
  const doFetch = opts.fetch ?? fetch;
  const api = opts.apiUrl.replace(/\/+$/, "");
  const base = `${api}/v1/workspaces/${opts.workspaceId}/documents`;
  const result: ImportResult = { sent: 0, refused: [], failed: [], stopped: null };

  const files: FoundFile[] = [];
  for await (const f of walk(opts.folder)) files.push(f);

  /** One request. A 5xx is tried again after 1 s and then 2 s; a network error is not retried. */
  async function call(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, init);
      } catch {
        throw new StepError(0, "NETWORK_ERROR");
      }
      if (res.status < 500 || attempt >= RETRY_WAITS_MS.length) return res;
      await res.arrayBuffer().catch(() => undefined);
      await sleep(RETRY_WAITS_MS[attempt]!);
    }
  }

  async function checked(res: Response): Promise<Response> {
    if (res.ok) return res;
    throw new StepError(res.status, await codeOf(res));
  }

  async function upload(file: FoundFile): Promise<void> {
    const apiHeaders = { cookie: opts.cookie, "content-type": "application/json" };
    const created = await checked(
      await call(`${base}/uploads`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ originalName: file.name, size: file.size, mimeType: mimeOf(file.name) }),
      }),
    );
    const parsed = (await created.json().catch(() => null)) as {
      document?: { id?: unknown };
      upload?: { url?: unknown; headers?: Record<string, unknown> };
    } | null;
    const id = parsed?.document?.id;
    const url = parsed?.upload?.url;
    if (typeof id !== "string" || typeof url !== "string") throw new StepError(created.status, "BAD_RESPONSE");

    // The signed URL is not the API's: it gets the signed headers and never the session cookie.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed?.upload?.headers ?? {})) {
      if (k.toLowerCase() !== "content-length" && typeof v === "string") headers[k] = v;
    }
    let body: Buffer;
    try {
      body = await readFile(file.path);
    } catch {
      throw new StepError(0, "READ_FAILED");
    }
    await checked(await call(new URL(url, `${api}/`).href, { method: "PUT", headers, body }));
    await checked(await call(`${base}/${id}/finalize`, { method: "POST", headers: apiHeaders, body: "{}" }));
  }

  async function settle(file: FoundFile): Promise<Outcome> {
    if (file.size > MAX_FILE_BYTES) return { kind: "refused", code: "UPLOAD_TOO_LARGE" };
    try {
      await upload(file);
      return { kind: "sent" };
    } catch (e) {
      if (!(e instanceof StepError)) throw e;
      if (e.status === 401) return { kind: "signed_out" };
      if (e.status === 400 || e.status === 413 || e.status === 415) return { kind: "refused", code: e.code };
      return { kind: "failed", code: e.code };
    }
  }

  let next = 0;
  let settled = 0;
  async function worker(): Promise<void> {
    while (result.stopped === null && next < files.length) {
      const file = files[next++]!;
      const outcome = await settle(file);
      if (outcome.kind === "sent") result.sent++;
      else if (outcome.kind === "refused") result.refused.push({ name: file.name, code: outcome.code });
      else if (outcome.kind === "failed") result.failed.push({ name: file.name, code: outcome.code });
      else {
        result.stopped = "signed_out";
        result.failed.push({ name: file.name, code: "UNAUTHENTICATED" });
      }
      opts.onSettled?.(++settled, files.length);
    }
  }

  const workers = Math.max(1, Math.min(opts.concurrency ?? 4, files.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return result;
}
