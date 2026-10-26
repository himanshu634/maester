import { afterEach, describe, expect, it } from "vitest";
import { latestMarketFetch } from "@maester/db";
import { silentLogger } from "../src/logger.js";
import { runMarketRefreshOnce } from "../src/market/run-once.js";
import { createWorkerContext, workerTestEnv } from "./context.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const BASE = { DATABASE_URL: workerTestEnv().DATABASE_URL, WORKER_URL: "http://localhost:8788", NODE_ENV: "test", STORAGE_DRIVER: "disk" } as NodeJS.ProcessEnv;

function capture() {
  const lines: { log: string[]; error: string[] } = { log: [], error: [] };
  return { lines, out: { log: (l: string) => lines.log.push(l), error: (l: string) => lines.error.push(l) } };
}

describe("market:refresh", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  it("exits 1 saying CONNECTIONS_KEY is not set", async () => {
    const { lines, out } = capture();
    const code = await runMarketRefreshOnce(BASE, out, () => { throw new Error("must not connect"); });
    expect(code).toBe(1);
    expect(lines.error).toEqual(["CONNECTIONS_KEY is not set"]);
  });

  it("exits 1 on a malformed key, without printing it", async () => {
    const { lines, out } = capture();
    const code = await runMarketRefreshOnce({ ...BASE, CONNECTIONS_KEY: "not-a-key" }, out, () => { throw new Error("must not connect"); });
    expect(code).toBe(1);
    expect(lines.error.join("\n")).toContain("CONNECTIONS_KEY must be 32 bytes");
    expect(lines.error.join("\n")).not.toContain("not-a-key");
  });

  it("runs one pass with no saved connections: failed DHAN_NOT_CONNECTED, nothing written, exit 1", async () => {
    const ctx = await createWorkerContext();
    close = ctx.close;
    const { lines, out } = capture();
    const code = await runMarketRefreshOnce({ ...BASE, CONNECTIONS_KEY: KEY }, out, () => ({ db: ctx.db, logger: silentLogger }));
    expect(code).toBe(1);
    expect(lines.log).toEqual(["failed DHAN_NOT_CONNECTED, 0 points written"]);
    expect((await latestMarketFetch(ctx.db))?.state).toBe("failed");
  });
});
