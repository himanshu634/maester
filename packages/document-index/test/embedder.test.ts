import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EMBEDDING_MODELS, EmbedderError, FakeEmbedder, TeiEmbedder, servesModel } from "../src/index.js";

const M = "Snowflake/snowflake-arctic-embed-l-v2.0";
const QWEN = "Qwen/Qwen3-Embedding-0.6B";
const VOYAGE = "voyageai/voyage-4-nano";
const GRANITE = "ibm-granite/granite-embedding-english-r2";
const vec = (n: number) => Array.from({ length: n }, () => 0.5);
let server: Server | undefined;

async function serve(replies: Array<{ status: number; body?: unknown }>) {
  const bodies: Array<{ url?: string; method?: string; body: { inputs: string[] } }> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      // A GET (the /info request) has no body.
      bodies.push({ url: req.url, method: req.method, body: raw ? JSON.parse(raw) : { inputs: [] } });
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

  it("retries a body that is cut off mid-read", async () => {
    let n = 0;
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        if (++n === 1) {
          res.writeHead(200, { "content-type": "application/json", "content-length": "5000" });
          res.write("[[0.1,");
          setTimeout(() => res.destroy(), 10);
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify([vec(1024)]));
        }
      });
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const out = await new TeiEmbedder(url, M, { backoffMs: 1 }).embed(["a"], "document");
    expect(out).toHaveLength(1);
    expect(n).toBe(2);
  });

  /** A server that reads each request and never answers it. */
  async function silent(): Promise<{ url: string; requests: () => number }> {
    let n = 0;
    server = createServer((req) => {
      n += 1;
      req.resume();
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests: () => n };
  }

  it("with retryOnTimeout false, a request that times out is not sent again", async () => {
    const s = await silent();
    const err = await new TeiEmbedder(s.url, M, { timeoutMs: 50, backoffMs: 1, retryOnTimeout: false })
      .embed(["a"], "document")
      .catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderError);
    expect(err).toMatchObject({ code: "EMBEDDER_UNAVAILABLE", retryable: true });
    expect(err.message).toBe("The embedder did not answer within 50 ms.");
    expect(s.requests()).toBe(1);
    server!.closeAllConnections();
  });

  it("by default a request that times out is sent again, as many times as retries", async () => {
    const s = await silent();
    const err = await new TeiEmbedder(s.url, M, { timeoutMs: 50, backoffMs: 1, retries: 2 }).embed(["a"], "document").catch((e) => e);
    expect(err).toMatchObject({ code: "EMBEDDER_UNAVAILABLE", retryable: true });
    expect(s.requests()).toBe(3);
    server!.closeAllConnections();
  });

  it("with retryOnTimeout false, a 503 is still retried", async () => {
    const s = await serve([{ status: 503 }, { status: 200, body: [vec(1024)] }]);
    const out = await new TeiEmbedder(s.url, M, { backoffMs: 1, retryOnTimeout: false }).embed(["a"], "document");
    expect(out).toHaveLength(1);
    expect(s.bodies).toHaveLength(2);
  });

  it("with retryOnTimeout false, a body that stops arriving past the timeout is not read again", async () => {
    let n = 0;
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        n += 1;
        res.writeHead(200, { "content-type": "application/json", "content-length": "5000" });
        res.write("[[0.1,");
      });
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const err = await new TeiEmbedder(url, M, { timeoutMs: 100, backoffMs: 1, retryOnTimeout: false }).embed(["a"], "document").catch((e) => e);
    expect(err).toMatchObject({ code: "EMBEDDER_UNAVAILABLE", retryable: true, message: "The embedder did not answer within 100 ms." });
    expect(n).toBe(1);
    server!.closeAllConnections();
  });

  it("throws on a vector of the wrong dimensions", async () => {
    const s = await serve([{ status: 200, body: [vec(768)] }]);
    const err = await new TeiEmbedder(s.url, M, { backoffMs: 1 }).embed(["a"], "document").catch((e) => e);
    expect(err).toMatchObject({ code: "EMBEDDING_FAILED", retryable: false });
    expect(err.message).toBe("The embedder answer did not match 1 vectors of 1024 dimensions.");
  });

  it("pads a 768-value answer for granite to the 1024 the column holds", async () => {
    const s = await serve([{ status: 200, body: [vec(768), vec(768)] }]);
    const out = await new TeiEmbedder(s.url, GRANITE).embed(["a", "b"], "document");
    expect(out).toHaveLength(2);
    for (const v of out) {
      expect(v).toHaveLength(1024);
      expect(v.slice(0, 768)).toEqual(vec(768));
      expect(v.slice(768).every((x) => x === 0)).toBe(true);
    }
  });

  it("refuses a 1024-value answer for granite, and does not send the request again", async () => {
    const s = await serve([{ status: 200, body: [vec(1024)] }]);
    const err = await new TeiEmbedder(s.url, GRANITE, { backoffMs: 1 }).embed(["a"], "document").catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderError);
    expect(err).toMatchObject({ code: "EMBEDDING_FAILED", retryable: false });
    expect(err.message).toBe("The embedder answer did not match 1 vectors of 768 dimensions.");
    expect(s.bodies).toHaveLength(1);
  });

  it("cuts voyage's 2048-value answer to 1024 and renormalises it", async () => {
    const v = Array.from({ length: 2048 }, () => 0);
    v[0] = 0.6;
    v[1024] = 0.8;
    const s = await serve([{ status: 200, body: [v] }]);
    const [out] = await new TeiEmbedder(s.url, VOYAGE).embed(["a"], "query");
    expect(out).toEqual([1, ...Array.from({ length: 1023 }, () => 0)]);
  });

  it("refuses a 1024-value answer for voyage", async () => {
    const s = await serve([{ status: 200, body: [vec(1024)] }]);
    const err = await new TeiEmbedder(s.url, VOYAGE).embed(["a"], "query").catch((e) => e);
    expect(err).toMatchObject({ code: "EMBEDDING_FAILED", retryable: false });
    expect(err.message).toBe("The embedder answer did not match 1 vectors of 2048 dimensions.");
  });
});

describe("servedModel", () => {
  const QWEN_FOLDER = "/models/embed/Qwen/Qwen3-Embedding-0.6B";

  it("servedModel reads /info", async () => {
    const s = await serve([{ status: 200, body: { model_id: QWEN_FOLDER, model_sha: null, served_model_name: QWEN_FOLDER } }]);
    const served = await new TeiEmbedder(s.url, QWEN).servedModel();
    expect(served).toBe(QWEN_FOLDER);
    expect(s.bodies).toEqual([{ url: "/info", method: "GET", body: { inputs: [] } }]);
    expect(servesModel(served, QWEN)).toBe(true);
    expect(servesModel(served, M)).toBe(false);
  });

  it("asks /info once per call, and a base URL with a trailing slash does not double it", async () => {
    const s = await serve([{ status: 200, body: { model_id: QWEN_FOLDER } }]);
    const e = new TeiEmbedder(`${s.url}//`, QWEN);
    await e.servedModel();
    await e.servedModel();
    expect(s.bodies.map((b) => `${b.method} ${b.url}`)).toEqual(["GET /info", "GET /info"]);
  });

  it("servesModel is true for the id itself and for a folder that ends in it, and for nothing else", () => {
    expect(servesModel("Snowflake/snowflake-arctic-embed-l-v2.0", M)).toBe(true);
    expect(servesModel("/models/embed/Snowflake/snowflake-arctic-embed-l-v2.0", M)).toBe(true);
    expect(servesModel("/models/embed/XSnowflake/snowflake-arctic-embed-l-v2.0", M)).toBe(false);
    expect(servesModel("/models/embed/Qwen/Qwen3-Embedding-0.6B", M)).toBe(false);
    expect(servesModel("snowflake-arctic-embed-l-v2.0", M)).toBe(false);
    expect(servesModel("", M)).toBe(false);
  });

  const unavailable = { code: "EMBEDDER_UNAVAILABLE", retryable: true, message: "The embedder did not say which model it serves." };

  it("an /info with no model_id is EMBEDDER_UNAVAILABLE", async () => {
    for (const body of [{}, { model_id: 7 }, { model_id: null }, { served_model_name: QWEN_FOLDER }, [], "text"]) {
      const s = await serve([{ status: 200, body }]);
      const err = await new TeiEmbedder(s.url, QWEN).servedModel().catch((e) => e);
      expect(err, JSON.stringify(body)).toBeInstanceOf(EmbedderError);
      expect(err).toMatchObject(unavailable);
      expect(s.bodies).toHaveLength(1);
      await new Promise((ok) => server!.close(ok));
      server = undefined;
    }
  });

  it("an /info that is refused or not JSON is EMBEDDER_UNAVAILABLE, and is not asked again", async () => {
    const refused = await serve([{ status: 503, body: { model_id: QWEN_FOLDER } }]);
    expect(await new TeiEmbedder(refused.url, QWEN).servedModel().catch((e) => e)).toMatchObject(unavailable);
    expect(refused.bodies).toHaveLength(1);
    await new Promise((ok) => server!.close(ok));

    server = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not json");
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await new TeiEmbedder(url, QWEN).servedModel().catch((e) => e)).toMatchObject(unavailable);
  });

  it("an embedder that is down or does not answer within the timeout is EMBEDDER_UNAVAILABLE", async () => {
    const s = await serve([{ status: 200 }]);
    await new Promise((ok) => server!.close(ok));
    server = undefined;
    expect(await new TeiEmbedder(s.url, QWEN).servedModel().catch((e) => e)).toMatchObject(unavailable);

    let requests = 0;
    server = createServer((req) => {
      requests += 1;
      req.resume();
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await new TeiEmbedder(url, QWEN, { timeoutMs: 50 }).servedModel().catch((e) => e)).toMatchObject(unavailable);
    expect(requests).toBe(1);
    server.closeAllConnections();
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
  it("gives a query and a document of equal text the same vector", async () => {
    const f = new FakeEmbedder();
    const [q] = await f.embed(["same"], "query");
    const [d] = await f.embed(["same"], "document");
    expect(q).toEqual(d);
  });
  it("fails with a custom error", async () => {
    const f = new FakeEmbedder();
    f.fail(1, new EmbedderError("EMBEDDER_UNAVAILABLE", true, "down"));
    await expect(f.embed(["a"], "query")).rejects.toMatchObject({ code: "EMBEDDER_UNAVAILABLE" });
    await expect(f.embed(["a"], "query")).resolves.toHaveLength(1);
  });
  it("gives every listed model unit vectors of the stored length, padded where the model serves fewer values", async () => {
    for (const model of Object.keys(EMBEDDING_MODELS)) {
      const [v] = await new FakeEmbedder(model).embed(["same"], "document");
      expect(v, model).toHaveLength(1024);
      expect(Math.hypot(...v!), model).toBeCloseTo(1, 6);
      expect(v!.slice(EMBEDDING_MODELS[model]!.dimensions).every((x) => x === 0), model).toBe(true);
    }
  });
  it("serves the model it was made for, or the one it was told to", async () => {
    expect(await new FakeEmbedder().servedModel()).toBe(M);
    expect(await new FakeEmbedder(QWEN).servedModel()).toBe(QWEN);
    expect(await new FakeEmbedder(M, { serves: "/models/embed/Qwen/Qwen3-Embedding-0.6B" }).servedModel()).toBe("/models/embed/Qwen/Qwen3-Embedding-0.6B");
  });
  it("is told to fail on embed only", async () => {
    const f = new FakeEmbedder();
    f.fail(1);
    await expect(f.servedModel()).resolves.toBe(M);
    await expect(f.embed(["a"], "query")).rejects.toBeInstanceOf(EmbedderError);
  });
  it("fails the requested number of times", async () => {
    const f = new FakeEmbedder();
    f.fail(2);
    await expect(f.embed(["a"], "query")).rejects.toMatchObject({ retryable: true });
    await expect(f.embed(["a"], "query")).rejects.toBeInstanceOf(EmbedderError);
    await expect(f.embed(["a"], "query")).resolves.toHaveLength(1);
  });
});
