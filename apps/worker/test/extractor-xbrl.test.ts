import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { XbrlEvent, XbrlPdfCheckRequest } from "@maester/contracts";
import { HttpExtractorClient } from "../src/extractor.js";
import { JobFailure } from "../src/jobs/types.js";

const fixture = (name: string) => readFileSync(new URL(`../../../packages/contracts/fixtures/xbrl/${name}`, import.meta.url), "utf8");
const SECRET = "extractor-test-secret";

type Reply = (res: ServerResponse) => void;
let reply: Reply;
let seen: { headers: IncomingMessage["headers"]; url: string; body: Buffer }[] = [];
let server: Server;
let client: HttpExtractorClient;

const stream = (name: string): Reply => (res) => {
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  res.end(fixture(name));
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ headers: req.headers, url: req.url ?? "", body: Buffer.concat(chunks) });
      reply(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = new HttpExtractorClient(url, { kind: "secret", secret: SECRET }, 10_000);
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  seen = [];
});

const instance = new TextEncoder().encode("<xbrl/>");
const noop = async () => {};

describe("ExtractorClient.xbrl", () => {
  it("classify resolves the classification and posts the instance with its mode", async () => {
    reply = stream("stream-classify.ndjson");
    const events: XbrlEvent["type"][] = [];
    const result = await client.xbrl({ instance, documentId: "d1", mode: "classify" }, async (e) => { events.push(e.type); });
    expect(result.format.id).toBe("in-capmkt/banking");
    expect(result.bseCode).toBe("500998");
    expect(events).toEqual(["started", "heartbeat", "classification"]);
    expect(seen[0]!.url).toBe("/v1/xbrl");
    expect(seen[0]!.headers["x-xbrl-mode"]).toBe("classify");
    expect(seen[0]!.headers["x-document-id"]).toBe("d1");
    expect(seen[0]!.headers["x-extractor-secret"]).toBe(SECRET);
    expect(seen[0]!.body.toString()).toBe("<xbrl/>");
  });

  it("read resolves the read result", async () => {
    reply = stream("stream-read.ndjson");
    const result = await client.xbrl({ instance, documentId: "d1", mode: "read" }, noop);
    expect(result.pipelineVersion).toBe("xbrl-1");
    expect(result.facts.length).toBeGreaterThan(0);
    expect(seen[0]!.headers["x-xbrl-mode"]).toBe("read");
  });

  it("text resolves the text result", async () => {
    reply = stream("stream-text.ndjson");
    const result = await client.xbrl({ instance, documentId: "d1", mode: "text" }, noop);
    expect(result.textVersion).toBe("1");
    expect(seen[0]!.headers["x-xbrl-mode"]).toBe("text");
  });

  it("an error event fails with its own code and is not retried", async () => {
    reply = stream("stream-error.ndjson");
    const events: string[] = [];
    const err = await client.xbrl({ instance, documentId: "d1", mode: "read" }, async (e) => { events.push(e.type); }).catch((e) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect(err).toMatchObject({ code: "XBRL_UNREADABLE", retryable: false });
    expect(events).toEqual(["started", "error"]);
  });

  it("a stream that ends without a result is a retryable interruption", async () => {
    reply = (res) => {
      res.writeHead(200);
      res.end(fixture("stream-classify.ndjson").split("\n")[0] + "\n");
    };
    const err = await client.xbrl({ instance, documentId: "d1", mode: "classify" }, noop).catch((e) => e);
    expect(err).toMatchObject({ code: "EXTRACTOR_STREAM_INTERRUPTED", retryable: true });
  });

  it("a connection cut mid-stream is a retryable interruption", async () => {
    reply = (res) => {
      res.writeHead(200);
      res.write(fixture("stream-classify.ndjson").split("\n")[0] + "\n");
      setTimeout(() => res.destroy(), 20);
    };
    const err = await client.xbrl({ instance, documentId: "d1", mode: "classify" }, noop).catch((e) => e);
    expect(err).toMatchObject({ code: "EXTRACTOR_STREAM_INTERRUPTED", retryable: true });
  });

  it("an unreadable event is a permanent INVALID_EXTRACTOR_RESULT", async () => {
    reply = (res) => {
      res.writeHead(200);
      res.end('{"type":"classification","result":{"kind":"brochure"}}\n');
    };
    const err = await client.xbrl({ instance, documentId: "d1", mode: "classify" }, noop).catch((e) => e);
    expect(err).toMatchObject({ code: "INVALID_EXTRACTOR_RESULT", retryable: false });
  });

  it("a refused request keeps the shared HTTP mapping", async () => {
    reply = (res) => { res.writeHead(503); res.end("{}"); };
    const err = await client.xbrl({ instance, documentId: "d1", mode: "classify" }, noop).catch((e) => e);
    expect(err).toMatchObject({ code: "EXTRACTOR_HTTP_503", retryable: true });
  });
});

describe("ExtractorClient.xbrlPdfCheck", () => {
  const request = JSON.parse(fixture("pdf-check-request.json")) as XbrlPdfCheckRequest;

  it("sends a multipart body with the parts pdf and request and resolves the result", async () => {
    reply = (res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(fixture("pdf-check-result.json")); };
    const result = await client.xbrlPdfCheck({ pdf: new TextEncoder().encode("%PDF-1.4 x"), documentId: "d2", request });
    expect(result.checkVersion).toBe(1);
    expect(result.results).toHaveLength(4);
    const call = seen[0]!;
    expect(call.url).toBe("/v1/xbrl/pdf-check");
    expect(call.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(call.headers["x-document-id"]).toBe("d2");
    expect(call.headers["x-extractor-secret"]).toBe(SECRET);
    const body = call.body.toString("latin1");
    expect(body).toMatch(/name="pdf"/);
    expect(body).toMatch(/name="request"/);
    expect(body).toContain("%PDF-1.4 x");
    expect(body).toContain(request.facts[0]!.factId);
  });

  it("an error answer becomes its own JobFailure", async () => {
    reply = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", code: "UNREADABLE_PDF", retryable: false, message: "x" }));
    };
    const err = await client.xbrlPdfCheck({ pdf: new TextEncoder().encode("%PDF"), documentId: "d2", request }).catch((e) => e);
    expect(err).toMatchObject({ code: "UNREADABLE_PDF", retryable: false });
  });

  it("an answer of another check version is a permanent INVALID_EXTRACTOR_RESULT", async () => {
    const body = JSON.parse(fixture("pdf-check-result.json"));
    body.checkVersion = 2;
    reply = (res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const err = await client.xbrlPdfCheck({ pdf: new TextEncoder().encode("%PDF"), documentId: "d2", request }).catch((e) => e);
    expect(err).toMatchObject({ code: "INVALID_EXTRACTOR_RESULT", retryable: false });
  });
});
