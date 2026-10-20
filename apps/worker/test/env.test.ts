import { describe, expect, it } from "vitest";
import { dispatchModeWarning, loadWorkerEnv } from "../src/env.js";
import { handlers } from "../src/jobs/index.js";
import { silentLogger } from "../src/logger.js";
import { buildQueueOptions } from "../src/start.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  GCS_BUCKET: "b",
  DISPATCH_MODE: "queue",
  WORKER_URL: "http://localhost:8788",
};

describe("worker env: the queue", () => {
  it("defaults to the in-process queue with a 30-minute extract timeout", () => {
    const env = loadWorkerEnv({ ...base, DISPATCH_MODE: undefined });
    expect(env.DISPATCH_MODE).toBe("queue");
    expect(env.EXTRACT_TIMEOUT_SECONDS).toBe(1800);
    expect(env.JOB_POLL_MS).toBe(1000);
    expect(env.JOB_SWEEP_MS).toBe(30000);
    expect(env.JOB_HEARTBEAT_MS).toBe(15000);
    expect(env).not.toHaveProperty("EXTRACTOR_TIMEOUT_SECONDS");
  });

  it("reads the old DISPATCH_MODE=local as queue, and warns once at start", () => {
    expect(loadWorkerEnv({ ...base, DISPATCH_MODE: "local" }).DISPATCH_MODE).toBe("queue");
    expect(dispatchModeWarning({ ...base, DISPATCH_MODE: "local" })).toBe("DISPATCH_MODE=local is now queue; update .env");
    expect(dispatchModeWarning(base)).toBeNull();
    expect(dispatchModeWarning({ ...base, DISPATCH_MODE: undefined })).toBeNull();
  });

  it("still refuses an unknown DISPATCH_MODE", () => {
    expect(() => loadWorkerEnv({ ...base, DISPATCH_MODE: "http" })).toThrow(/DISPATCH_MODE/);
  });

  it("refuses a heartbeat that does not renew well inside the lease", () => {
    expect(() => loadWorkerEnv({ ...base, LEASE_SECONDS: "10" })).toThrow(/JOB_HEARTBEAT_MS/);
    expect(() => loadWorkerEnv({ ...base, LEASE_SECONDS: "10", JOB_HEARTBEAT_MS: "5001" })).toThrow(/JOB_HEARTBEAT_MS/);
    expect(loadWorkerEnv({ ...base, LEASE_SECONDS: "10", JOB_HEARTBEAT_MS: "5000" }).JOB_HEARTBEAT_MS).toBe(5000);
  });

  it("reads EXTRACT_TIMEOUT_SECONDS", () => {
    expect(loadWorkerEnv({ ...base, EXTRACT_TIMEOUT_SECONDS: "60" }).EXTRACT_TIMEOUT_SECONDS).toBe(60);
  });

  it("fails at start on a bad JOB_CONCURRENCY", () => {
    const env = loadWorkerEnv({ ...base, JOB_CONCURRENCY: "bad" });
    expect(() => buildQueueOptions(env, handlers, silentLogger)).toThrow(/JOB_CONCURRENCY/);
    const zero = loadWorkerEnv({ ...base, JOB_CONCURRENCY: "document.verify=0" });
    expect(() => buildQueueOptions(zero, handlers, silentLogger)).toThrow(/document\.verify/);
  });

  it("builds the runner's options from the environment", () => {
    const env = loadWorkerEnv({ ...base, JOB_CONCURRENCY: "document.extract=3", JOB_POLL_MS: "250", JOB_SWEEP_MS: "5000" });
    const opts = buildQueueOptions(env, handlers, silentLogger);
    expect(opts.concurrency).toEqual({ "document.verify": 4, "document.classify": 2, "document.extract": 3, "document.index": 1 });
    expect(opts).toMatchObject({ pollMs: 250, sweepMs: 5000 });
    expect(typeof opts.listen).toBe("function");
  });
});

describe("worker env: extraction", () => {
  it("leaves extraction off without EXTRACTOR_URL", () => {
    expect(loadWorkerEnv(base).EXTRACTOR_URL).toBeUndefined();
  });

  it("requires a secret for secret auth", () => {
    expect(() => loadWorkerEnv({ ...base, EXTRACTOR_URL: "http://extractor:8790" })).toThrow("EXTRACTOR_SECRET");
    expect(loadWorkerEnv({ ...base, EXTRACTOR_URL: "http://extractor:8790", EXTRACTOR_SECRET: "x" }).EXTRACT_MAX_BYTES).toBe(52428800);
  });

  it("requires Cloud Tasks settings to enqueue extraction in cloud-tasks mode", () => {
    const cloud = { ...base, DISPATCH_MODE: "cloud-tasks", API_SERVICE_ACCOUNT_EMAIL: "api@p.iam", EXTRACTOR_URL: "https://x", EXTRACTOR_AUTH: "oidc" };
    expect(() => loadWorkerEnv(cloud)).toThrow("WORKER_INVOKER_SA");
    expect(loadWorkerEnv({ ...cloud, GOOGLE_CLOUD_PROJECT: "p", WORKER_INVOKER_SA: "api@p.iam" }).EXTRACTOR_AUTH).toBe("oidc");
  });
});

describe("worker env: indexing", () => {
  it("has the index defaults and leaves the indexer and embedder off", () => {
    const env = loadWorkerEnv(base);
    expect(env).toMatchObject({
      INDEX_PAGE_RANGE: 20,
      INDEX_TIMEOUT_SECONDS: 7200,
      EMBED_BATCH: 16,
      OCR_PAGE_BUDGET: 400,
      EMBEDDING_MODEL: "Snowflake/snowflake-arctic-embed-l-v2.0",
    });
    expect(env.INDEXER_URL).toBeUndefined();
    expect(env.EMBEDDER_URL).toBeUndefined();
  });

  it("refuses an embedding model it does not know", () => {
    expect(() => loadWorkerEnv({ ...base, EMBEDDING_MODEL: "nope" })).toThrow(/EMBEDDING_MODEL/);
  });

  it("requires a secret when INDEXER_URL is set", () => {
    expect(() => loadWorkerEnv({ ...base, INDEXER_URL: "http://indexer:8791" })).toThrow("INDEXER_SECRET");
    expect(loadWorkerEnv({ ...base, INDEXER_URL: "http://indexer:8791", INDEXER_SECRET: "s" }).INDEXER_URL).toBe("http://indexer:8791");
  });
});

describe("worker env: market", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("defaults the Dhan rate and refresh interval, and leaves the key unset", () => {
    const env = loadWorkerEnv(base);
    expect(env.DHAN_REQUESTS_PER_SECOND).toBe(4);
    expect(env.MARKET_REFRESH_MINUTES).toBe(30);
    expect(env.CONNECTIONS_KEY).toBeUndefined();
  });
  it("reads the settings", () => {
    const env = loadWorkerEnv({ ...base, CONNECTIONS_KEY: key, DHAN_REQUESTS_PER_SECOND: "2", MARKET_REFRESH_MINUTES: "10" });
    expect(env).toMatchObject({ CONNECTIONS_KEY: key, DHAN_REQUESTS_PER_SECOND: 2, MARKET_REFRESH_MINUTES: 10 });
  });
  it("refuses more than 5 Dhan requests per second", () => {
    expect(() => loadWorkerEnv({ ...base, DHAN_REQUESTS_PER_SECOND: "6" })).toThrow("DHAN_REQUESTS_PER_SECOND");
  });
  it("refuses a CONNECTIONS_KEY that is not 32 bytes, base64", () => {
    for (const bad of [Buffer.alloc(16, 1).toString("base64"), "not base64!!"]) {
      expect(() => loadWorkerEnv({ ...base, CONNECTIONS_KEY: bad })).toThrow("CONNECTIONS_KEY must be 32 bytes, base64");
    }
  });
});
