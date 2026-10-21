import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exitCodeOf } from "../src/cli.js";
import { importFolder, type ImportResult } from "../src/import.js";
import { walk } from "../src/walk.js";

const WS = "11111111-1111-4111-8111-111111111111";
const COOKIE = "maester.session_token=abc";

type Upload = { name: string; mime: string; size: number };
type Handler = (req: IncomingMessage, res: ServerResponse, ctx: { body: Buffer; path: string }) => boolean;

/** A stand-in for the API: the three endpoints, with hooks to make one of them fail. */
class FakeApi {
  server!: Server;
  url = "";
  uploads: Upload[] = [];
  puts: { path: string; headers: IncomingMessage["headers"]; bytes: number }[] = [];
  finalized: string[] = [];
  cookies: (string | undefined)[] = [];
  inFlight = 0;
  maxInFlight = 0;
  uploadCount = 0;
  /** Return true when the hook answered the request itself. */
  hook: Handler = () => false;
  relativeUrls = false;
  delayMs = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => void this.handle(req, res, Buffer.concat(chunks)));
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse, body: Buffer): Promise<void> {
    const path = req.url ?? "";
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.hook(req, res, { body, path })) return;
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.method === "POST" && path === `/v1/workspaces/${WS}/documents/uploads`) {
        this.cookies.push(req.headers.cookie);
        const input = JSON.parse(body.toString()) as { originalName: string; size: number; mimeType: string };
        this.uploads.push({ name: input.originalName, mime: input.mimeType, size: input.size });
        const id = `doc-${++this.uploadCount}`;
        const blob = `/dev/blobs/${id}?sig=x`;
        json(201, {
          document: { id },
          upload: {
            method: "PUT",
            url: this.relativeUrls ? blob : `${this.url}${blob}`,
            headers: { "Content-Type": input.mimeType, "Content-Length": String(input.size), "x-signed": "yes" },
            expiresAt: "2030-01-01T00:00:00Z",
          },
        });
      } else if (req.method === "PUT" && path.startsWith("/dev/blobs/")) {
        this.puts.push({ path, headers: req.headers, bytes: body.length });
        res.writeHead(200).end();
      } else if (req.method === "POST" && path.endsWith("/finalize")) {
        this.cookies.push(req.headers.cookie);
        this.finalized.push(path.split("/").at(-2)!);
        json(200, { document: {}, job: {} });
      } else {
        json(404, { error: { code: "NOT_FOUND" } });
      }
    } finally {
      this.inFlight--;
    }
  }
}

function errorBody(res: ServerResponse, status: number, code: string): true {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code, message: "x", traceId: "t" } }));
  return true;
}

let api: FakeApi;
let dir: string;

beforeEach(async () => {
  api = new FakeApi();
  await api.start();
  dir = await mkdtemp(join(tmpdir(), "maester-import-"));
});

afterEach(async () => {
  await api.stop();
  await rm(dir, { recursive: true, force: true });
});

async function files(names: string[]): Promise<void> {
  for (const n of names) {
    await mkdir(join(dir, n, ".."), { recursive: true });
    await writeFile(join(dir, n), `content of ${n}`);
  }
}

const run = (extra: Partial<Parameters<typeof importFolder>[0]> = {}) =>
  importFolder({ apiUrl: api.url, workspaceId: WS, cookie: COOKIE, folder: dir, ...extra });

describe("walk", () => {
  it("goes depth first in sorted order, takes pdf and xml in any case, and skips the rest", async () => {
    await files(["b.pdf", "a/z.XML", "a/y.Pdf", "a/.hidden.pdf", "Thumbs.db", "desktop.ini", ".DS_Store", "notes.txt", "c/d/e.xml"]);
    await symlink(join(dir, "a"), join(dir, "linked"));
    await symlink(join(dir, "b.pdf"), join(dir, "link.pdf"));
    const seen: string[] = [];
    for await (const f of walk(dir)) {
      seen.push(f.path.slice(dir.length + 1));
      expect(f.name).toBe(f.path.split("/").at(-1));
      expect(f.size).toBeGreaterThan(0);
    }
    expect(seen).toEqual(["a/y.Pdf", "a/z.XML", "b.pdf", "c/d/e.xml"]);
  });

  it("skips a hidden folder", async () => {
    await files([".git/x.pdf", "ok.pdf"]);
    const seen: string[] = [];
    for await (const f of walk(dir)) seen.push(f.name);
    expect(seen).toEqual(["ok.pdf"]);
  });
});

describe("importFolder", () => {
  it("uploads 3 PDFs and 2 XML files with the right MIME types and skips the rest", async () => {
    await files(["1.pdf", "2.pdf", "3.pdf", "a.xml", "b.XML", ".DS_Store", "notes.txt"]);
    const settled: [number, number][] = [];
    const result = await run({ onSettled: (n, total) => settled.push([n, total]) });
    expect(result).toEqual({ sent: 5, refused: [], failed: [], stopped: null });
    expect(api.uploads.map((u) => [u.name, u.mime]).sort()).toEqual([
      ["1.pdf", "application/pdf"],
      ["2.pdf", "application/pdf"],
      ["3.pdf", "application/pdf"],
      ["a.xml", "application/xml"],
      ["b.XML", "application/xml"],
    ]);
    expect(api.puts).toHaveLength(5);
    expect(api.finalized.sort()).toEqual(["doc-1", "doc-2", "doc-3", "doc-4", "doc-5"]);
    expect(settled.at(-1)).toEqual([5, 5]);
    expect(settled).toHaveLength(5);
  });

  it("sends the cookie to the API, and the signed headers but no cookie to the signed URL", async () => {
    await files(["1.pdf"]);
    await run();
    expect(api.cookies).toEqual([COOKIE, COOKIE]);
    const put = api.puts[0]!;
    expect(put.headers["x-signed"]).toBe("yes");
    expect(put.headers["content-type"]).toBe("application/pdf");
    expect(put.headers.cookie).toBeUndefined();
    expect(put.bytes).toBe("content of 1.pdf".length);
    expect(put.headers["content-length"]).toBe(String(put.bytes));
  });

  it("has at most 4 requests in flight at once", async () => {
    await files(Array.from({ length: 12 }, (_, i) => `f${i}.pdf`));
    api.delayMs = 15;
    const result = await run();
    expect(result.sent).toBe(12);
    expect(api.maxInFlight).toBe(4);
  });

  it("honours a smaller concurrency", async () => {
    await files(Array.from({ length: 6 }, (_, i) => `f${i}.pdf`));
    api.delayMs = 10;
    await run({ concurrency: 2 });
    expect(api.maxInFlight).toBe(2);
  });

  it("lists a 413 as refused and goes on", async () => {
    await files(["a.pdf", "b.pdf", "c.pdf"]);
    api.hook = (req, res, { body }) =>
      req.method === "POST" && req.url!.endsWith("/uploads") && body.toString().includes('"b.pdf"')
        ? errorBody(res, 413, "UPLOAD_TOO_LARGE")
        : false;
    const result = await run({ concurrency: 1 });
    expect(result).toEqual({ sent: 2, refused: [{ name: "b.pdf", code: "UPLOAD_TOO_LARGE" }], failed: [], stopped: null });
    expect(api.finalized).toHaveLength(2);
  });

  it("lists a 400 as refused with its code", async () => {
    await files(["a.pdf"]);
    api.hook = (req, res) => (req.url!.endsWith("/uploads") ? errorBody(res, 400, "VALIDATION_FAILED") : false);
    const result = await run();
    expect(result.refused).toEqual([{ name: "a.pdf", code: "VALIDATION_FAILED" }]);
    expect(result.sent).toBe(0);
  });

  it("stops new uploads on a 401 and says it was signed out", async () => {
    await files(["1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf"]);
    let n = 0;
    api.hook = (req, res) => (req.method === "POST" && req.url!.endsWith("/uploads") && ++n === 3 ? errorBody(res, 401, "UNAUTHENTICATED") : false);
    const result = await run({ concurrency: 1 });
    expect(result.stopped).toBe("signed_out");
    expect(result.sent).toBe(2);
    expect(result.failed).toEqual([{ name: "3.pdf", code: "UNAUTHENTICATED" }]);
    expect(api.uploads.map((u) => u.name)).toEqual(["1.pdf", "2.pdf"]);
    expect(n).toBe(3);
  });

  it("lets the files already started finish after a 401", async () => {
    await files(["1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf", "6.pdf"]);
    let n = 0;
    api.delayMs = 20;
    api.hook = (req, res) => (req.method === "POST" && req.url!.endsWith("/uploads") && ++n === 1 ? errorBody(res, 401, "UNAUTHENTICATED") : false);
    const result = await run({ concurrency: 2 });
    expect(result.stopped).toBe("signed_out");
    // File 2 was already in flight when file 1 was refused, so it finishes; 3 to 6 never start.
    expect(result.sent).toBe(1);
    expect(n).toBe(2);
  });

  it("retries a 503 once and then succeeds", async () => {
    await files(["a.pdf"]);
    let n = 0;
    api.hook = (req, res) => (req.method === "PUT" && ++n === 1 ? errorBody(res, 503, "INTERNAL") : false);
    const result = await run();
    expect(result).toEqual({ sent: 1, refused: [], failed: [], stopped: null });
    expect(n).toBe(2);
  });

  it("fails a file after the PUT answers 5xx three times", async () => {
    await files(["a.pdf"]);
    let n = 0;
    api.hook = (req, res) => (req.method === "PUT" ? (n++, errorBody(res, 500, "INTERNAL")) : false);
    const result = await run();
    expect(n).toBe(3);
    expect(result.failed).toEqual([{ name: "a.pdf", code: "INTERNAL" }]);
    expect(result.sent).toBe(0);
    expect(api.finalized).toEqual([]);
  }, 10_000);

  it("names a failure with no JSON body by its status", async () => {
    await files(["a.pdf"]);
    api.hook = (req, res) => (req.url!.endsWith("/finalize") ? (res.writeHead(409).end("nope"), true) : false);
    const result = await run();
    expect(result.failed).toEqual([{ name: "a.pdf", code: "HTTP_409" }]);
  });

  it("fails a file on a network error and goes on", async () => {
    await files(["a.pdf", "b.pdf"]);
    let n = 0;
    api.hook = (req, res) => (req.method === "POST" && req.url!.endsWith("/uploads") && ++n === 1 ? (res.socket!.destroy(), true) : false);
    const result = await run({ concurrency: 1 });
    expect(result.failed).toEqual([{ name: "a.pdf", code: "NETWORK_ERROR" }]);
    expect(result.sent).toBe(1);
  });

  it("refuses a 60 MB sparse file locally, without a request", async () => {
    await files(["ok.pdf"]);
    const big = join(dir, "big.pdf");
    await writeFile(big, "");
    await truncate(big, 60 * 1024 * 1024);
    const result = await run();
    expect(result.refused).toEqual([{ name: "big.pdf", code: "UPLOAD_TOO_LARGE" }]);
    expect(result.sent).toBe(1);
    expect(api.uploads.map((u) => u.name)).toEqual(["ok.pdf"]);
  });

  it("resolves a relative signed URL against the API URL", async () => {
    await files(["a.pdf"]);
    api.relativeUrls = true;
    const result = await run({ apiUrl: `${api.url}/` });
    expect(result.sent).toBe(1);
    expect(api.puts[0]!.path).toMatch(/^\/dev\/blobs\/doc-1\?sig=x$/);
  });

  it("uses the injected fetch", async () => {
    await files(["a.pdf"]);
    const seen: string[] = [];
    const fetchStub = (async (input: string | URL, init?: RequestInit) => {
      seen.push(`${init?.method} ${String(input)}`);
      if (String(input).endsWith("/uploads")) {
        return Response.json({ document: { id: "d" }, upload: { url: "https://signed.example/x", headers: {} } }, { status: 201 });
      }
      return Response.json({}, { status: 200 });
    }) as typeof fetch;
    const result = await run({ fetch: fetchStub, apiUrl: "http://api.invalid" });
    expect(result.sent).toBe(1);
    expect(seen).toEqual([
      `POST http://api.invalid/v1/workspaces/${WS}/documents/uploads`,
      "PUT https://signed.example/x",
      `POST http://api.invalid/v1/workspaces/${WS}/documents/d/finalize`,
    ]);
  });
});

describe("exitCodeOf", () => {
  const base: ImportResult = { sent: 3, refused: [], failed: [], stopped: null };
  it("is 2 for a stopped run, 1 for a failure, 0 for refusals alone", () => {
    expect(exitCodeOf({ ...base, stopped: "signed_out", failed: [{ name: "a", code: "X" }] })).toBe(2);
    expect(exitCodeOf({ ...base, failed: [{ name: "a", code: "X" }] })).toBe(1);
    expect(exitCodeOf({ ...base, refused: [{ name: "a", code: "UPLOAD_TOO_LARGE" }] })).toBe(0);
    expect(exitCodeOf(base)).toBe(0);
  });
});
