import { describe, expect, it } from "vitest";
import { loadWorkerEnv } from "../src/env.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  GCS_BUCKET: "b",
  DISPATCH_MODE: "local",
  DISPATCH_SECRET: "s",
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
