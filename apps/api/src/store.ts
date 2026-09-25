import { DiskObjectStore, GcsObjectStore, type ObjectStore } from "@maester/storage";
import type { Env } from "./env.js";

/** Path the API serves local blob uploads and downloads on. */
export const BLOB_PATH_PREFIX = "/dev/blobs";

/**
 * Build the object store the environment asks for. `disk` keeps bytes on a
 * local filesystem and signs URLs back to this API; it is for local
 * development only and env validation refuses it in production.
 */
export function createStore(env: Env): ObjectStore {
  if (env.STORAGE_DRIVER === "disk") {
    return new DiskObjectStore(env.STORAGE_DIR, {
      baseUrl: env.BETTER_AUTH_URL,
      secret: env.DISPATCH_SECRET ?? env.BETTER_AUTH_SECRET,
      pathPrefix: BLOB_PATH_PREFIX,
    });
  }
  return new GcsObjectStore(env.GCS_BUCKET!);
}
