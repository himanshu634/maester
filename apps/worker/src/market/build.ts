import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listConnections, type Db } from "@maester/db";
import { HttpDhanSource, HttpFredSource, loadConnections } from "@maester/market";
import type { WorkerEnv } from "../env.js";
import type { Logger } from "../logger.js";
import { readMembers } from "./members.js";
import { MarketRefresher, type MarketSources } from "./refresh.js";

/**
 * The worker package root: the nearest folder above this file whose package.json is named
 * "@maester/worker". That is apps/worker under tsx (src/market/), apps/worker for the bundle
 * (dist/), and /app in the Docker image (dist/ beside package.json).
 */
export function workerRoot(from: string | URL = import.meta.url): string {
  let dir = dirname(String(from).startsWith("file:") ? fileURLToPath(from) : String(from));
  for (;;) {
    try {
      if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "@maester/worker") return dir;
    } catch { /* no package.json here, or not readable */ }
    const up = dirname(dir);
    if (up === dir) throw new Error("could not find the @maester/worker package root");
    dir = up;
  }
}

/** The Nifty 500 list, downloaded by hand into the worker's data folder. */
export function membersPath(from?: string | URL): string {
  return join(workerRoot(from), "data", "nifty500.csv");
}

/**
 * The member list, or an empty one when it is missing, empty or cannot be read. A file that
 * cannot be read is logged as an error and breadth is left out: a hand-downloaded file with the
 * wrong columns must not stop the worker, which also runs the document jobs.
 */
export function loadMembers(path: string, logger: Logger): string[] {
  let members: string[];
  try {
    members = readMembers(path);
  } catch (err) {
    logger.error({ path, message: (err as Error).message }, "the Nifty 500 member list could not be read; breadth is not worked out");
    return [];
  }
  if (members.length === 0) logger.warn({ path, found: existsSync(path) }, "the Nifty 500 member list is missing or empty; breadth is not worked out");
  return members;
}

/** Builds the refresher the server schedules and the CLI runs once. `env.CONNECTIONS_KEY` must be set. */
export function createMarketRefresher(env: WorkerEnv, db: Db, logger: Logger): MarketRefresher {
  const connectionsKey = Buffer.from(env.CONNECTIONS_KEY!, "base64");
  const members = loadMembers(membersPath(), logger);
  const sources = async (): Promise<MarketSources> => {
    const c = loadConnections(await listConnections(db), connectionsKey);
    return {
      dhan: c.dhan ? new HttpDhanSource({ ...c.dhan, requestsPerSecond: env.DHAN_REQUESTS_PER_SECOND }) : null,
      fred: c.fred ? new HttpFredSource({ apiKey: c.fred.apiKey }) : null,
    };
  };
  return new MarketRefresher({ db, sources, members, logger, connectionsKey });
}
