import { Readable } from "node:stream";
import { ObjectNotFoundError, type ObjectStore, type SignedDownload, type SignedUpload } from "./index.js";

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload> {
    return {
      url: `memory://upload/${key}`,
      headers: { "Content-Type": opts.contentType, "Content-Length": String(opts.contentLength) },
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload> {
    return { url: `memory://download/${key}`, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000) };
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async readStream(key: string): Promise<Readable> {
    const obj = this.objects.get(key);
    if (!obj) throw new ObjectNotFoundError(key);
    return Readable.from([Buffer.from(obj.bytes)]);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
  }
}
