import { describe, expect, it } from "vitest";
import { loadWorkerEnv } from "../src/env.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  GCS_BUCKET: "b",
  DISPATCH_MODE: "queue",
  WORKER_URL: "http://localhost:8788",
};

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
