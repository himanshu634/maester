import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EmbedderError, FakeEmbedder, TeiEmbedder } from "../src/index.js";

const M = "Snowflake/snowflake-arctic-embed-l-v2.0";
const vec = (n: number) => Array.from({ length: n }, () => 0.5);
let server: Server | undefined;

async function serve(replies: Array<{ status: number; body?: unknown }>) {
  const bodies: Array<{ url?: string; body: { inputs: string[] } }> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push({ url: req.url, body: JSON.parse(raw) });
      const r = replies[Math.min(bodies.length - 1, replies.length - 1)]!;
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
}

afterEach(async () => {
  if (server) await new Promise((ok) => server!.close(ok));
  server = undefined;
});

describe("TeiEmbedder", () => {
  it("prefixes a query, not a document", async () => {
    const s = await serve([{ status: 200, body: [vec(1024)] }]);
    const e = new TeiEmbedder(s.url, M);
    await e.embed(["what is the dividend"], "query");
    await e.embed(["the dividend"], "document");
    expect(s.bodies[0]!.url).toBe("/embed");
    expect(s.bodies[0]!.body).toEqual({ inputs: ["query: what is the dividend"], normalize: true, truncate: false });
    expect(s.bodies[1]!.body.inputs).toEqual(["the dividend"]);
  });

  it("succeeds after two 503 answers", async () => {
    const s = await serve([{ status: 503 }, { status: 503 }, { status: 200, body: [vec(1024)] }]);
    const out = await new TeiEmbedder(s.url, M, { backoffMs: 1 }).embed(["a"], "document");
    expect(out).toHaveLength(1);
    expect(s.bodies).toHaveLength(3);
  });

  it("throws EMBEDDING_FAILED, retryable, after four 503 answers", async () => {
    const s = await serve([{ status: 503 }]);
    const err = await new TeiEmbedder(s.url, M, { backoffMs: 1 }).embed(["a"], "document").catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderError);
    expect(err).toMatchObject({ code: "EMBEDDING_FAILED", retryable: true });
    expect(s.bodies).toHaveLength(4);
  });

  it("does not retry a 413 or 422", async () => {
    for (const status of [413, 422]) {
      const s = await serve([{ status }]);
      const err = await new TeiEmbedder(s.url, M, { backoffMs: 1 }).embed(["a"], "document").catch((e) => e);
      expect(err).toMatchObject({ code: "EMBEDDING_FAILED", retryable: false });
      expect(s.bodies).toHaveLength(1);
      await new Promise((ok) => server!.close(ok));
      server = undefined;
    }
  });

  it("throws EMBEDDER_UNAVAILABLE when the connection is refused", async () => {
    const s = await serve([{ status: 200 }]);
    await new Promise((ok) => server!.close(ok));
    server = undefined;
    const err = await new TeiEmbedder(s.url, M, { backoffMs: 1, retries: 1 }).embed(["a"], "document").catch((e) => e);
    expect(err).toMatchObject({ code: "EMBEDDER_UNAVAILABLE", retryable: true });
  });

  it("throws on a vector of the wrong dimensions", async () => {
    const s = await serve([{ status: 200, body: [vec(768)] }]);
    const err = await new TeiEmbedder(s.url, M, { backoffMs: 1 }).embed(["a"], "document").catch((e) => e);
    expect(err).toMatchObject({ code: "EMBEDDING_FAILED", retryable: false });
  });
});

describe("FakeEmbedder", () => {
  it("gives equal unit vectors for equal texts", async () => {
    const f = new FakeEmbedder();
    const [a, b, c] = await f.embed(["same", "same", "other"], "document");
    expect(a).toHaveLength(1024);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 6);
  });
  it("fails the requested number of times", async () => {
    const f = new FakeEmbedder();
    f.fail(2);
    await expect(f.embed(["a"], "query")).rejects.toMatchObject({ retryable: true });
    await expect(f.embed(["a"], "query")).rejects.toBeInstanceOf(EmbedderError);
    await expect(f.embed(["a"], "query")).resolves.toHaveLength(1);
  });
});
