import { describe, expect, it } from "vitest";
import { testEnv } from "./env.js";

describe("env", () => {
  it("throws when DISPATCH_MODE=local and DISPATCH_SECRET is undefined", () => {
    expect(() => testEnv({ DISPATCH_MODE: "local", DISPATCH_SECRET: undefined })).toThrow();
    expect(() => testEnv({ DISPATCH_MODE: "local", DISPATCH_SECRET: undefined })).toThrow(/DISPATCH_SECRET/);
  });

  it("throws when DISPATCH_MODE=cloud-tasks and WORKER_INVOKER_SA is undefined", () => {
    expect(() => testEnv({ DISPATCH_MODE: "cloud-tasks" })).toThrow();
    expect(() => testEnv({ DISPATCH_MODE: "cloud-tasks" })).toThrow(/WORKER_INVOKER_SA/);
  });

  it("succeeds when DISPATCH_MODE=cloud-tasks with WORKER_INVOKER_SA and sets MAX_UPLOAD_BYTES", () => {
    const env = testEnv({
      DISPATCH_MODE: "cloud-tasks",
      WORKER_INVOKER_SA: "api@example.iam.gserviceaccount.com",
    });
    expect(env.MAX_UPLOAD_BYTES).toBe(52428800);
  });

  it("parses and trims ALLOWED_ORIGINS", () => {
    const env = testEnv({
      ALLOWED_ORIGINS: " http://a.test , http://b.test ,, ",
    });
    expect(env.ALLOWED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
});
