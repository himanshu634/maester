import { describe, expect, it } from "vitest";
import { dispatchModeWarning } from "../src/env.js";
import { testEnv } from "./env.js";

describe("env", () => {
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

  it("shows the XBRL-in-PDF check unless XBRL_PDF_CHECK is false", () => {
    expect(testEnv().XBRL_PDF_CHECK).toBe(true);
    expect(testEnv({ XBRL_PDF_CHECK: "false" }).XBRL_PDF_CHECK).toBe(false);
    expect(() => testEnv({ XBRL_PDF_CHECK: "no" })).toThrow(/XBRL_PDF_CHECK/);
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

describe("env: DISPATCH_MODE", () => {
  it("defaults to queue", () => {
    expect(testEnv({ DISPATCH_MODE: undefined }).DISPATCH_MODE).toBe("queue");
  });

  it("reads the old DISPATCH_MODE=local as queue, and warns once at start", () => {
    expect(testEnv({ DISPATCH_MODE: "local" }).DISPATCH_MODE).toBe("queue");
    expect(dispatchModeWarning({ DISPATCH_MODE: "local" })).toBe("DISPATCH_MODE=local is now queue; update .env");
    expect(dispatchModeWarning({ DISPATCH_MODE: "queue" })).toBeNull();
    expect(dispatchModeWarning({})).toBeNull();
  });

  it("still refuses an unknown DISPATCH_MODE", () => {
    expect(() => testEnv({ DISPATCH_MODE: "http" })).toThrow(/DISPATCH_MODE/);
  });
});

describe("env: CONNECTIONS_KEY", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("is optional", () => {
    expect(testEnv().CONNECTIONS_KEY).toBeUndefined();
    expect(testEnv({ CONNECTIONS_KEY: "" }).CONNECTIONS_KEY).toBeUndefined();
  });
  it("accepts 32 bytes, base64", () => {
    expect(testEnv({ CONNECTIONS_KEY: key }).CONNECTIONS_KEY).toBe(key);
  });
  it("refuses anything that does not decode to 32 bytes", () => {
    for (const bad of [Buffer.alloc(16, 1).toString("base64"), Buffer.alloc(33, 1).toString("base64"), "not base64!!", "short"]) {
      expect(() => testEnv({ CONNECTIONS_KEY: bad })).toThrow("CONNECTIONS_KEY must be 32 bytes, base64");
    }
  });
});
