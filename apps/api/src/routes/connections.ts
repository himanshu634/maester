import { Hono } from "hono";
import { ConnectionProvider, SaveDhanConnectionRequest, SaveFredConnectionRequest, type Connection } from "@maester/contracts";
import { deleteConnection, lastMarketReads, listConnections, saveConnection, type MarketConnectionRow } from "@maester/db";
import { encryptSecret, HttpDhanSource, HttpFredSource, MarketSourceError } from "@maester/market";
import type { AppDeps, AppEnv, MarketSources } from "../app.js";
import { HttpError } from "../errors.js";
import { validate } from "../validation.js";

/** The worker's DHAN_REQUESTS_PER_SECOND default; a save makes one call. */
const DHAN_REQUESTS_PER_SECOND = 4;

const HTTP_SOURCES: MarketSources = {
  dhan: (creds) => new HttpDhanSource({ ...creds, requestsPerSecond: DHAN_REQUESTS_PER_SECOND }),
  fred: (apiKey) => new HttpFredSource({ apiKey }),
};

const PROVIDERS = ConnectionProvider.options;

function toConnection(provider: ConnectionProvider, row: MarketConnectionRow | undefined, lastRead: Date | null, now: Date, notice: Connection["notice"] = null): Connection {
  if (!row) return { provider, state: "not_connected", clientId: null, last4: null, expiresAt: null, checkedAt: null, lastRead: lastRead?.toISOString() ?? null, notice: null };
  const expired = row.lastErrorCode === "DHAN_TOKEN_EXPIRED" || (row.expiresAt !== null && row.expiresAt <= now);
  return {
    provider,
    state: expired ? "expired" : row.lastErrorCode ? "failing" : "connected",
    clientId: row.clientId,
    last4: row.secretLast4,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    checkedAt: row.checkedAt.toISOString(),
    lastRead: lastRead?.toISOString() ?? null,
    notice,
  };
}

/**
 * Turns a failed check into an answer. Only the error's code is used: its message, and anything
 * else it carries, never reaches the response or the log, because it could hold the secret.
 */
function checkFailed(deps: AppDeps, provider: ConnectionProvider, err: unknown): HttpError {
  const code = err instanceof MarketSourceError ? err.code : "SOURCE_UNAVAILABLE";
  // The error's name only (e.g. TypeError), so a bug here is not mistaken for an outage; never its message.
  deps.logger.warn({ provider, code, errName: err instanceof Error ? err.name : typeof err }, "connection check failed");
  if (code === "DHAN_TOKEN_EXPIRED") return new HttpError("VALIDATION_FAILED", "request validation failed", [{ path: "accessToken", message: "Dhan said this token isn’t valid." }]);
  if (code === "DHAN_RATE_LIMITED") return new HttpError("RATE_LIMITED", "DHAN_RATE_LIMITED");
  return new HttpError("INTERNAL", "SOURCE_UNAVAILABLE", undefined, 503);
}

const last4 = (secret: string) => secret.slice(-4);

/** Settings → Connections. Needs a session but no workspace; the saved keys are global to the install. */
export function connectionRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const sources = deps.marketSources ?? HTTP_SOURCES;
  const key = deps.env.CONNECTIONS_KEY ? Buffer.from(deps.env.CONNECTIONS_KEY, "base64") : null;
  const needKey = (): Buffer => {
    if (!key) throw new HttpError("INVALID_STATE", "CONNECTIONS_KEY is not set");
    return key;
  };

  r.use("*", async (_c, next) => {
    needKey();
    await next();
  });

  async function view(provider: ConnectionProvider, row: MarketConnectionRow, notice: Connection["notice"] = null): Promise<Connection> {
    const reads = await lastMarketReads(deps.db);
    return toConnection(provider, row, reads[provider], new Date(), notice);
  }

  r.get("/", async (c) => {
    const [rows, reads] = await Promise.all([listConnections(deps.db), lastMarketReads(deps.db)]);
    const now = new Date();
    const items = PROVIDERS.map((p) => toConnection(p, rows.find((row) => row.provider === p), reads[p], now));
    return c.json({ items });
  });

  r.put("/dhan", validate("json", SaveDhanConnectionRequest), async (c) => {
    const { clientId, accessToken } = c.req.valid("json");
    let profile;
    try {
      profile = await sources.dhan({ clientId, accessToken }).profile();
    } catch (err) {
      throw checkFailed(deps, "dhan", err);
    }
    if (profile.clientId !== clientId) {
      throw new HttpError("VALIDATION_FAILED", "request validation failed", [{ path: "clientId", message: "This token belongs to another Dhan client ID." }]);
    }
    const row = await saveConnection(deps.db, {
      provider: "dhan", clientId, secretCiphertext: encryptSecret(accessToken, needKey()), secretLast4: last4(accessToken),
      expiresAt: profile.tokenExpiresAt ? new Date(profile.tokenExpiresAt) : null, checkedAt: new Date(), savedByUserId: c.get("user").id,
    });
    return c.json(await view("dhan", row, profile.dataPlanActive === false ? "DATA_PLAN_INACTIVE" : null));
  });

  r.put("/fred", validate("json", SaveFredConnectionRequest), async (c) => {
    const { apiKey } = c.req.valid("json");
    try {
      await sources.fred(apiKey).check();
    } catch (err) {
      throw checkFailed(deps, "fred", err);
    }
    const row = await saveConnection(deps.db, {
      provider: "fred", clientId: null, secretCiphertext: encryptSecret(apiKey, needKey()), secretLast4: last4(apiKey),
      expiresAt: null, checkedAt: new Date(), savedByUserId: c.get("user").id,
    });
    return c.json(await view("fred", row));
  });

  r.delete("/:provider", async (c) => {
    const provider = ConnectionProvider.safeParse(c.req.param("provider"));
    if (!provider.success) throw new HttpError("NOT_FOUND", "connection not found");
    await deleteConnection(deps.db, provider.data);
    return c.body(null, 204);
  });

  return r;
}
