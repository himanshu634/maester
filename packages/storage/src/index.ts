import type { Readable } from "node:stream";

export interface SignedUpload { url: string; headers: Record<string, string>; expiresAt: Date }
export interface SignedDownload { url: string; expiresAt: Date }

export interface ObjectStore {
  signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload>;
  signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload>;
  exists(key: string): Promise<boolean>;
  readStream(key: string): Promise<Readable>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export { MemoryObjectStore } from "./memory.js";
export { GcsObjectStore } from "./gcs.js";
