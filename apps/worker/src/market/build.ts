import { listConnections, type Db } from "@maester/db";
import { HttpDhanSource, HttpFredSource, loadConnections } from "@maester/market";
import type { WorkerEnv } from "../env.js";
import type { Logger } from "../logger.js";
import { readMembers } from "./members.js";
import { MarketRefresher, type MarketSources } from "./refresh.js";

/** The Nifty 500 list, downloaded by hand. The same relative path works from src/ and from dist/. */
export const MEMBERS_URL = new URL("../data/nifty500.csv", import.meta.url);

/** Builds the refresher the server schedules and the CLI runs once. `env.CONNECTIONS_KEY` must be set. */
export function createMarketRefresher(env: WorkerEnv, db: Db, logger: Logger): MarketRefresher {
  const connectionsKey = Buffer.from(env.CONNECTIONS_KEY!, "base64");
  const sources = async (): Promise<MarketSources> => {
    const c = loadConnections(await listConnections(db), connectionsKey);
    return {
      dhan: c.dhan ? new HttpDhanSource({ ...c.dhan, requestsPerSecond: env.DHAN_REQUESTS_PER_SECOND }) : null,
      fred: c.fred ? new HttpFredSource({ apiKey: c.fred.apiKey }) : null,
    };
  };
  return new MarketRefresher({ db, sources, members: readMembers(MEMBERS_URL), logger, connectionsKey });
}
