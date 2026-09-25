import { DiskObjectStore, GcsObjectStore, type ObjectStore } from "@maester/storage";
import type { WorkerEnv } from "./env.js";

/**
 * Build the object store the environment asks for. With `disk` the worker
 * reads bytes straight off the shared directory the API wrote them to; it
 * never signs URLs, so no signing options are needed.
 */
export function createStore(env: WorkerEnv): ObjectStore {
  if (env.STORAGE_DRIVER === "disk") return new DiskObjectStore(env.STORAGE_DIR);
  return new GcsObjectStore(env.GCS_BUCKET!);
}
