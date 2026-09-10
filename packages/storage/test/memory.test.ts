import { describe, expect, it } from "vitest";
import { MemoryObjectStore, ObjectNotFoundError } from "../src/index.js";

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

describe("MemoryObjectStore", () => {
  it("put / exists / readStream round trip", async () => {
    const store = new MemoryObjectStore();
    expect(await store.exists("k")).toBe(false);
    await store.put("k", new TextEncoder().encode("%PDF-1.4 hello"), "application/pdf");
    expect(await store.exists("k")).toBe(true);
    expect((await readAll(await store.readStream("k"))).toString()).toBe("%PDF-1.4 hello");
  });

  it("readStream rejects with ObjectNotFoundError", async () => {
    const store = new MemoryObjectStore();
    await expect(store.readStream("missing")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("signUpload returns a memory URL with required headers and expiry", async () => {
    const store = new MemoryObjectStore();
    const s = await store.signUpload("k", { contentType: "application/pdf", contentLength: 5, expiresInSeconds: 60 });
    expect(s.url).toBe("memory://upload/k");
    expect(s.headers["Content-Type"]).toBe("application/pdf");
    expect(s.headers["Content-Length"]).toBe("5");
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
