import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskObjectStore, ObjectNotFoundError, verifyBlobSignature } from "../src/index.js";

const SECRET = "local-dispatch-secret";
const KEY = "workspaces/w1/documents/d1/original.pdf";

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

describe("DiskObjectStore", () => {
  let root: string;
  let store: DiskObjectStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "maester-disk-"));
    store = new DiskObjectStore(root, { baseUrl: "http://localhost:8787", secret: SECRET });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("put / exists / readStream round trip across nested keys", async () => {
    expect(await store.exists(KEY)).toBe(false);
    await store.put(KEY, new TextEncoder().encode("%PDF-1.4 hello"), "application/pdf");
    expect(await store.exists(KEY)).toBe(true);
    expect((await readAll(await store.readStream(KEY))).toString()).toBe("%PDF-1.4 hello");
    expect(await store.contentType(KEY)).toBe("application/pdf");
  });

  it("readStream rejects with ObjectNotFoundError", async () => {
    await expect(store.readStream("missing")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("survives a second store over the same directory", async () => {
    await store.put(KEY, new TextEncoder().encode("%PDF-"), "application/pdf");
    expect(await new DiskObjectStore(root).exists(KEY)).toBe(true);
  });

  it("rejects keys that escape the root", async () => {
    await expect(store.put("../escape", new Uint8Array([1]), "application/pdf")).rejects.toThrow(/invalid object key/);
  });

  it("signs an upload URL that verifies for PUT only", async () => {
    const signed = await store.signUpload(KEY, { contentType: "application/pdf", contentLength: 5, expiresInSeconds: 900 });
    expect(signed.headers["Content-Type"]).toBe("application/pdf");
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const url = new URL(signed.url);
    expect(url.origin).toBe("http://localhost:8787");
    expect(decodeURIComponent(url.pathname)).toBe(`/dev/blobs/${KEY}`);
    const expires = Number(url.searchParams.get("expires"));
    const sig = url.searchParams.get("signature")!;
    expect(verifyBlobSignature(SECRET, "PUT", KEY, expires, sig)).toBe(true);
    expect(verifyBlobSignature(SECRET, "GET", KEY, expires, sig)).toBe(false);
    expect(verifyBlobSignature("other-secret", "PUT", KEY, expires, sig)).toBe(false);
  });

  it("rejects an expired signature", async () => {
    const signed = await store.signDownload(KEY, { expiresInSeconds: 60 });
    const url = new URL(signed.url);
    const expires = Number(url.searchParams.get("expires"));
    const sig = url.searchParams.get("signature")!;
    expect(verifyBlobSignature(SECRET, "GET", KEY, expires, sig)).toBe(true);
    expect(verifyBlobSignature(SECRET, "GET", KEY, expires, sig, Date.now() + 120_000)).toBe(false);
  });

  it("throws when signing without signing options", async () => {
    await expect(new DiskObjectStore(root).signDownload(KEY, { expiresInSeconds: 60 })).rejects.toThrow(/signing options/);
  });
});
