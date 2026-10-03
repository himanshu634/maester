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

  it("needs both Google credentials or neither", () => {
    expect(() => testEnv({ GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
    expect(testEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }).GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("requires Google credentials in production", () => {
    expect(() => testEnv({ NODE_ENV: "production", GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("requires TRUSTED_PROXIES in production", () => {
    expect(() => testEnv({ NODE_ENV: "production", TRUSTED_PROXIES: "" })).toThrow(/TRUSTED_PROXIES/);
    expect(testEnv({ NODE_ENV: "production", TRUSTED_PROXIES: "10.0.0.0/8, 172.16.0.0/12" }).TRUSTED_PROXIES).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);
  });

  it("treats empty Google credentials as unset", () => {
    expect(testEnv({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }).GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("refuses the console mailer in production", () => {
    expect(() => testEnv({ NODE_ENV: "production", MAIL_DRIVER: "console" })).toThrow(/MAIL_DRIVER/);
  });

  it("needs a key and a sender for Resend", () => {
    expect(() => testEnv({ MAIL_DRIVER: "resend", RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/);
  });
});
