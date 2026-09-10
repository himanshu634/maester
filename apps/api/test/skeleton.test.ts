import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

function app() {
  return createApp({ env: testEnv(), logger: silentLogger, db: null as never, auth: null as never, store: null as never, dispatcher: null as never });
}

describe("skeleton", () => {
  it("GET /healthz returns ok and echoes x-request-id", async () => {
    const res = await app().request("/healthz", { headers: { "x-request-id": "abc-123" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });

  it("generates a trace id when none is supplied", async () => {
    const res = await app().request("/healthz");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("unknown route returns the NOT_FOUND envelope", async () => {
    const res = await app().request("/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; traceId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.traceId).toBe("string");
  });

  it("CORS allows configured origins with credentials", async () => {
    const res = await app().request("/healthz", { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("CORS rejects other origins", async () => {
    const res = await app().request("/healthz", { headers: { origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
