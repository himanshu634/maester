import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { HttpError } from "../src/errors.js";
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

  it("unknown route returns the NOT_FOUND envelope with x-request-id header", async () => {
    const res = await app().request("/nope", { headers: { "x-request-id": "test-trace-id" } });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; traceId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.traceId).toBe("string");
    expect(res.headers.get("x-request-id")).toBe("test-trace-id");
  });

  it("HttpError throws with proper envelope and status", async () => {
    const testApp = app();
    testApp.get("/test-error", () => {
      throw new HttpError("UPLOAD_TOO_LARGE", "too big", [{ path: "size", message: "too large" }]);
    });
    const requestId = "test-request-123";
    const res = await testApp.request("/test-error", { headers: { "x-request-id": requestId } });
    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      error: { code: string; message: string; fields?: Array<{ path: string; message: string }>; traceId: string };
    };
    expect(body).toEqual({
      error: {
        code: "UPLOAD_TOO_LARGE",
        message: "too big",
        fields: [{ path: "size", message: "too large" }],
        traceId: requestId,
      },
    });
    expect(res.headers.get("x-request-id")).toBe(requestId);
  });

  it("unhandled Error throws with INTERNAL envelope and sanitized message", async () => {
    const testApp = app();
    testApp.get("/test-kaboom", () => {
      throw new Error("kaboom");
    });
    const requestId = "test-internal-456";
    const res = await testApp.request("/test-kaboom", { headers: { "x-request-id": requestId } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string; fields?: unknown; traceId: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("internal error");
    expect(body.error.fields).toBeUndefined();
    expect(body.error.traceId).toBe(requestId);
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
