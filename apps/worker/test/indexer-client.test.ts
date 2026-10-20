import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IndexerEvent } from "@maester/contracts";
import { HttpIndexerClient } from "../src/indexer.js";
import { JobFailure } from "../src/jobs/types.js";

const fixture = (name: string) => readFileSync(new URL(`../../../packages/contracts/fixtures/index/${name}`, import.meta.url), "utf8");
const range = fixture("stream-range.ndjson");
const errorStream = fixture("stream-error.ndjson");
const chunkRequest = JSON.parse(fixture("chunk-request.json"));
const MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";

interface Seen { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }
let server: Server;
let base: string;
let seen: Seen[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(parts) });
      respond(req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const stream = (body: string) => (_: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  res.end(body);
};
const client = () => new HttpIndexerClient(base, "s3cret", MODEL);
const input = (signal = new AbortController().signal) => ({
  pdf: new TextEncoder().encode("%PDF-1.7"),
  documentId: "doc-1",
  firstPage: 1,
  lastPage: 20,
  sectionPathBefore: ["Directors' report", "Ünïcode ▸ heading"],
  ocrPagesLeft: 12,
  signal,
});
const fails = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(JobFailure);
  return err as JobFailure;
};

describe("HttpIndexerClient", () => {
  it("reads the range stream: pages, chunks, the result, and every event including heartbeats", async () => {
    seen = [];
    respond = stream(range);
    const events: IndexerEvent[] = [];
    const result = await client().index(input(), async (e) => { events.push(e); });
    expect(result.pages).toHaveLength(3);
    expect(result.chunks).toHaveLength(4);
    expect(result.started.pageCount).toBe(3);
    expect(result.read).not.toBeNull();
    expect(events.some((e) => e.type === "heartbeat")).toBe(true);

    const req = seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/index");
    expect(req.headers["x-indexer-secret"]).toBe("s3cret");
    expect(req.headers["x-document-id"]).toBe("doc-1");
    expect(req.headers["x-page-range"]).toBe("1-20");
    expect(req.headers["x-ocr-pages-left"]).toBe("12");
    expect(req.headers["x-embedding-model"]).toBe(MODEL);
    expect(JSON.parse(Buffer.from(req.headers["x-section-path"] as string, "base64url").toString())).toEqual(["Directors' report", "Ünïcode ▸ heading"]);
    expect(req.body.toString()).toBe("%PDF-1.7");
  });

  it("sends a chunk request as JSON and reads a result with no read", async () => {
    seen = [];
    const lines = range.trim().split("\n").map((l) => JSON.parse(l));
    lines[lines.length - 1] = { ...lines[lines.length - 1], read: null };
    respond = stream(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const result = await client().chunk(chunkRequest, new AbortController().signal, async () => {});
    expect(result.read).toBeNull();
    expect(seen[0]!.url).toBe("/v1/chunk");
    expect(seen[0]!.headers["x-indexer-secret"]).toBe("s3cret");
    expect(JSON.parse(seen[0]!.body.toString())).toEqual(chunkRequest);
  });

  it("reads versions", async () => {
    seen = [];
    const versions = JSON.parse(range.split("\n")[0]!).versions;
    respond = (_, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(versions)); };
    expect(await client().versions()).toEqual(versions);
    expect(seen[0]).toMatchObject({ method: "GET", url: "/v1/versions" });
    respond = (_, res) => { res.writeHead(200); res.end(JSON.stringify({ nope: 1 })); };
    expect((await fails(client().versions())).code).toBe("INVALID_INDEXER_RESULT");
  });

  it("fails INDEX_STREAM_INTERRUPTED, retryable, when the stream is cut before the result", async () => {
    const cut = range.trim().split("\n").filter((l) => !l.includes('"type": "result"')).join("\n") + "\n";
    respond = stream(cut);
    const err = await fails(client().index(input(), async () => {}));
    expect(err).toMatchObject({ code: "INDEX_STREAM_INTERRUPTED", retryable: true });
  });

  it("accepts a valid last line with no trailing newline", async () => {
    respond = stream(range.trimEnd());
    const result = await client().index(input(), async () => {});
    expect(result.chunks).toHaveLength(4);
  });

  it("fails INDEX_STREAM_INTERRUPTED, retryable, when the stream is cut in the middle of a line", async () => {
    const lines = range.trim().split("\n");
    respond = stream(lines.slice(0, 3).join("\n") + "\n" + lines[3]!.slice(0, 30));
    expect(await fails(client().index(input(), async () => {}))).toMatchObject({ code: "INDEX_STREAM_INTERRUPTED", retryable: true });
  });

  it("fails INDEXER_UNAVAILABLE, retried, when the versions body is not JSON", async () => {
    respond = (_, res) => { res.writeHead(200); res.end("<html>"); };
    expect(await fails(client().versions())).toMatchObject({ code: "INDEXER_UNAVAILABLE", retryable: true });
  });

  it("fails with the indexer's own code and retryable flag on an error event", async () => {
    respond = stream(errorStream);
    const err = await fails(client().index(input(), async () => {}));
    expect(err).toMatchObject({ code: "UNREADABLE_PDF", retryable: false });
  });

  it("fails INDEXER_UNAUTHORIZED, not retried, on 401 and 403", async () => {
    for (const status of [401, 403]) {
      respond = (_, res) => { res.writeHead(status); res.end(); };
      expect(await fails(client().index(input(), async () => {}))).toMatchObject({ code: "INDEXER_UNAUTHORIZED", retryable: false });
    }
  });

  it("fails INVALID_INDEXER_RESULT, not retried, on a line it cannot read, without quoting the line", async () => {
    respond = stream('{"type":"page","pageNumber":1,"text":"SECRET TEXT","bogus":true}\n');
    const err = await fails(client().index(input(), async () => {}));
    expect(err).toMatchObject({ code: "INVALID_INDEXER_RESULT", retryable: false });
    expect(err.message).not.toContain("SECRET TEXT");
    respond = stream("not json SECRET TEXT\n");
    const err2 = await fails(client().index(input(), async () => {}));
    expect(err2.code).toBe("INVALID_INDEXER_RESULT");
    expect(err2.message).not.toContain("SECRET TEXT");
  });

  it("fails INDEXER_HTTP_<status>, retried only for a 5xx", async () => {
    respond = (_, res) => { res.writeHead(503); res.end(); };
    expect(await fails(client().index(input(), async () => {}))).toMatchObject({ code: "INDEXER_HTTP_503", retryable: true });
    respond = (_, res) => { res.writeHead(400); res.end(); };
    expect(await fails(client().index(input(), async () => {}))).toMatchObject({ code: "INDEXER_HTTP_400", retryable: false });
  });

  it("fails INDEXER_UNAVAILABLE, retried, when nothing answers", async () => {
    const dead = new HttpIndexerClient("http://127.0.0.1:1", "s", MODEL);
    expect(await fails(dead.index(input(), async () => {}))).toMatchObject({ code: "INDEXER_UNAVAILABLE", retryable: true });
  });

  it("fails INDEX_TIMEOUT, retried, when the signal aborts before and during the call", async () => {
    respond = stream(range);
    const done = AbortSignal.abort();
    expect(await fails(client().index(input(done), async () => {}))).toMatchObject({ code: "INDEX_TIMEOUT", retryable: true });

    respond = (_, res) => { res.writeHead(200); res.write('{"type":"heartbeat"}\n'); /* never ends */ };
    const ctl = new AbortController();
    const pending = client().index(input(ctl.signal), async (e) => { if (e.type === "heartbeat") ctl.abort(); });
    expect(await fails(pending)).toMatchObject({ code: "INDEX_TIMEOUT", retryable: true });
  });
});
