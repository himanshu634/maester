import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { ObjectNotFoundError, type ObjectStore, type SignedDownload, type SignedUpload } from "./index.js";

export interface DiskSigningOptions {
  /** Public base URL of the API that serves the blob routes, e.g. http://localhost:8787 */
  baseUrl: string;
  /** Secret used to sign and verify blob URLs. */
  secret: string;
  /** Path prefix the API mounts the blob routes on. */
  pathPrefix?: string;
}

const DEFAULT_PREFIX = "/dev/blobs";

function signature(secret: string, method: string, key: string, expires: number): string {
  return createHmac("sha256", secret).update(`${method}:${key}:${expires}`).digest("base64url");
}

/**
 * Verify a signature produced by DiskObjectStore. Returns false for a bad
 * signature or an expired URL.
 */
export function verifyBlobSignature(
  secret: string,
  method: string,
  key: string,
  expires: number,
  candidate: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(signature(secret, method, key, expires));
  const given = Buffer.from(candidate);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Filesystem-backed object store for local development and tests. Bytes live
 * under <root>/objects/<key>; the declared content type lives beside them
 * under <root>/meta/<key>.json. Signed URLs point at the API's own blob routes, which
 * exist only outside production.
 */
export class DiskObjectStore implements ObjectStore {
  private readonly blobs: string;
  private readonly meta: string;

  constructor(
    root: string,
    private readonly signing?: DiskSigningOptions,
  ) {
    const base = resolve(root);
    this.blobs = join(base, "objects");
    this.meta = join(base, "meta");
  }

  private pathIn(base: string, key: string, suffix = ""): string {
    const full = resolve(join(base, key + suffix));
    if (full !== base && !full.startsWith(base + sep)) throw new Error(`invalid object key: ${key}`);
    return full;
  }

  private sign(method: "PUT" | "GET", key: string, expiresInSeconds: number): { url: string; expiresAt: Date } {
    if (!this.signing) throw new Error("DiskObjectStore was constructed without signing options");
    const prefix = this.signing.pathPrefix ?? DEFAULT_PREFIX;
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const path = key.split("/").map(encodeURIComponent).join("/");
    const query = `expires=${expires}&signature=${signature(this.signing.secret, method, key, expires)}`;
    return {
      url: `${this.signing.baseUrl.replace(/\/$/, "")}${prefix}/${path}?${query}`,
      expiresAt: new Date(expires * 1000),
    };
  }

  async signUpload(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<SignedUpload> {
    const { url, expiresAt } = this.sign("PUT", key, opts.expiresInSeconds);
    return {
      url,
      headers: { "Content-Type": opts.contentType, "Content-Length": String(opts.contentLength) },
      expiresAt,
    };
  }

  async signDownload(key: string, opts: { expiresInSeconds: number }): Promise<SignedDownload> {
    return this.sign("GET", key, opts.expiresInSeconds);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.pathIn(this.blobs, key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async readStream(key: string): Promise<Readable> {
    if (!(await this.exists(key))) throw new ObjectNotFoundError(key);
    return createReadStream(this.pathIn(this.blobs, key));
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const blob = this.pathIn(this.blobs, key);
    const meta = this.pathIn(this.meta, key, ".json");
    await mkdir(dirname(blob), { recursive: true });
    await mkdir(dirname(meta), { recursive: true });
    await writeFile(blob, bytes);
    await writeFile(meta, JSON.stringify({ contentType }));
  }

  /** Declared content type recorded by put(), or null when it is unknown. */
  async contentType(key: string): Promise<string | null> {
    try {
      const raw = await readFile(this.pathIn(this.meta, key, ".json"), "utf8");
      return (JSON.parse(raw) as { contentType?: string }).contentType ?? null;
    } catch {
      return null;
    }
  }
}
