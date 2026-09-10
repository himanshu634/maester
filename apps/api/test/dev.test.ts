import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

const deps = (env: ReturnType<typeof testEnv>) =>
  ({ env, logger: silentLogger, db: null as never, auth: null as never, store: null as never, dispatcher: null as never });

describe("dev upload page", () => {
  it("is served outside production", async () => {
    const res = await createApp(deps(testEnv())).request("/dev/upload");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("EventSource");
  });

  it("is absent in production", async () => {
    const res = await createApp(deps(testEnv({ NODE_ENV: "production" }))).request("/dev/upload");
    expect(res.status).toBe(404);
  });
});
