import { DrizzleQueryError } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { BrokerDefinition } from "@maester/contracts";
import type { Db, MembershipRow, WorkspaceRow } from "@maester/db";
import type { Embedder } from "@maester/document-index";
import type { DhanSource, FredSource } from "@maester/market";
import type { ObjectStore } from "@maester/storage";
import type { Auth } from "./auth.js";
import type { Dispatcher } from "./dispatch/index.js";
import type { Env } from "./env.js";
import { errorBody, HttpError } from "./errors.js";
import type { Logger } from "./logger.js";
import { requireSession } from "./middleware/session.js";
import { requireWorkspace } from "./middleware/workspace.js";
import { requestId } from "./middleware/request-id.js";
import { brokerAccountRoutes, brokerCatalogRoutes, holdingsRoutes } from "./routes/brokers.js";
import { classificationRoutes } from "./routes/classification.js";
import { connectionRoutes } from "./routes/connections.js";
import { companyRoutes } from "./routes/companies.js";
import { devRoutes } from "./routes/dev.js";
import { documentRoutes } from "./routes/documents.js";
import { filingRoutes } from "./routes/filings.js";
import { DEFAULT_SSE, jobEventsRoute, type SseOptions } from "./routes/job-events.js";
import { jobRoutes } from "./routes/jobs.js";
import { marketMoodRoutes } from "./routes/market-mood.js";
import { meRoutes } from "./routes/me.js";
import { companyResearchRoutes, researchRoutes } from "./routes/research.js";
import { searchRoutes } from "./routes/search.js";
import { workspaceRoutes } from "./routes/workspaces.js";

export type AppEnv = {
  Variables: {
    traceId: string;
    user: { id: string; name: string; email: string };
    session: { id: string; userId: string };
    workspace: WorkspaceRow;
    membership: MembershipRow;
  };
};

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Db;
  auth: Auth;
  store: ObjectStore;
  dispatcher: Dispatcher;
  /** Embeds a search query; null when EMBEDDER_URL is not set, and search answers SEARCH_UNAVAILABLE. */
  embedder: Embedder | null;
  /** Builds the market data clients that check a key before Settings keeps it. Defaults to the HTTP ones. */
  marketSources?: MarketSources;
  /** The broker definitions. Defaults to the built-in ones plus BROKER_DEFINITIONS_DIR. */
  brokerDefinitions?: Map<string, BrokerDefinition>;
  /** The fetch broker calls go through. Defaults to the global one; tests pass a fake. */
  brokerFetch?: typeof globalThis.fetch;
}

export interface MarketSources {
  dhan(creds: { clientId: string; accessToken: string }): DhanSource;
  fred(apiKey: string): FredSource;
}

export interface AppOptions {
  sse?: SseOptions;
}

export function createApp(deps: AppDeps, options: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  const allowed = new Set(deps.env.ALLOWED_ORIGINS);

  app.use("*", requestId);
  app.use(
    "*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : ""),
      credentials: true,
      allowHeaders: ["Content-Type", "x-request-id"],
      exposeHeaders: ["x-request-id"],
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  if (deps.env.NODE_ENV === "development" || deps.env.NODE_ENV === "test") app.route("/dev", devRoutes(deps));

  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  const v1 = new Hono<AppEnv>();
  v1.use("*", requireSession(deps.auth));
  v1.route("/me", meRoutes(deps));
  v1.route("/market-mood", marketMoodRoutes(deps));
  v1.route("/settings/connections", connectionRoutes(deps));
  v1.route("/workspaces", workspaceRoutes(deps));
  v1.route("/brokers", brokerCatalogRoutes(deps));

  const ws = new Hono<AppEnv>();
  ws.use("*", requireWorkspace(deps.db));
  ws.route("/jobs", jobEventsRoute(deps, options.sse ?? DEFAULT_SSE));
  ws.route("/jobs", jobRoutes(deps));
  ws.route("/companies", companyRoutes(deps));
  ws.route("/companies", companyResearchRoutes(deps));
  ws.route("/research", researchRoutes(deps));
  ws.route("/search", searchRoutes(deps));
  ws.route("/documents", documentRoutes(deps));
  ws.route("/documents", classificationRoutes(deps));
  ws.route("/brokers", brokerAccountRoutes(deps));
  ws.route("/holdings", holdingsRoutes(deps));
  ws.route("/filings", filingRoutes(deps));
  v1.route("/workspaces/:ws", ws);

  app.route("/v1", v1);

  app.notFound((c) => c.json(errorBody("NOT_FOUND", "route not found", c.get("traceId")), 404));

  app.onError((err, c) => {
    const traceId = c.get("traceId") ?? "unknown";
    if (err instanceof HttpError) {
      return c.json(errorBody(err.code, err.message, traceId, err.fields), err.status as 400);
    }
    // A failed query's message and stack carry its bound parameters (a search query, a key): log the name and code only.
    if (err instanceof DrizzleQueryError) {
      const code = (err.cause as { code?: string } | undefined)?.code;
      deps.logger.error({ traceId, err: { name: err.name, code } }, "database query failed");
      return c.json(errorBody("INTERNAL", "internal error", traceId), 500);
    }
    deps.logger.error({ traceId, err: { name: err.name, message: err.message, stack: err.stack } }, "unhandled error");
    return c.json(errorBody("INTERNAL", "internal error", traceId), 500);
  });

  return app;
}
