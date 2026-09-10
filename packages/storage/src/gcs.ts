import type { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import { ObjectNotFoundError, type ObjectStore, type SignedDownload, type SignedUpload } from "./index.js";

export class GcsObjectStore implements ObjectStore {
  private readonly storage = new Storage();
  constructor(private readonly bucketName: string) {}

  private file(key: string) {
    return this.storage.bucket(this.bucketName).file(key);
  }

  async signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload> {
    const expires = Date.now() + opts.expiresInSeconds * 1000;
    const [url] = await this.file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType: opts.contentType,
      extensionHeaders: { "content-length": String(opts.contentLength) },
    });
    return {
      url,
      headers: { "Content-Type": opts.contentType, "Content-Length": String(opts.contentLength) },
      expiresAt: new Date(expires),
    };
  }

  async signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload> {
    const expires = Date.now() + opts.expiresInSeconds * 1000;
    const [url] = await this.file(key).getSignedUrl({ version: "v4", action: "read", expires });
    return { url, expiresAt: new Date(expires) };
  }

  async exists(key: string): Promise<boolean> {
    const [exists] = await this.file(key).exists();
    return exists;
  }

  async readStream(key: string): Promise<Readable> {
    if (!(await this.exists(key))) throw new ObjectNotFoundError(key);
    return this.file(key).createReadStream();
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.file(key).save(Buffer.from(bytes), { contentType, resumable: false });
  }
}
