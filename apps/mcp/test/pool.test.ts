import net from "node:net";
import pino from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@maester/db";
import { assertReadOnly, watchPool } from "../src/pool.js";
import { createServer } from "../src/server.js";
import { SettingsError } from "../src/settings.js";
import { createHarness, TEST_DATABASE_URL, textOf, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("assertReadOnly", () => {
  it("passes a read-only pool, even when the URL tries to turn it off", async () => {
    await expect(assertReadOnly(h.readDb)).resolves.toBeUndefined();
    const url = `${TEST_DATABASE_URL}?options=${encodeURIComponent("-c default_transaction_read_only=off")}`;
    const db = createDb(url, { readOnly: true, max: 1 });
    try {
      await expect(assertReadOnly(db)).resolves.toBeUndefined();
    } finally {
      await closeDb(db);
    }
  });

  it("refuses a session that is not read-only, naming DATABASE_URL", async () => {
    // The harness's writable pool stands in for a pooler that dropped the startup options.
    const err = await assertReadOnly(h.db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SettingsError);
    expect((err as SettingsError).setting).toBe("DATABASE_URL");
    expect((err as Error).message).toMatch(/^DATABASE_URL: the database session is not read-only/);
  });
});

/** A TCP proxy to the test Postgres whose connections the test can cut, as a database restart would. */
async function proxy() {
  const target = new URL(TEST_DATABASE_URL);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    sockets.add(client).add(upstream);
    client.pipe(upstream).pipe(client);
    const drop = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", drop);
    upstream.on("error", drop);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const url = new URL(TEST_DATABASE_URL);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return {
    url: url.toString(),
    /** Cuts every connection and stops listening: the database is gone. */
    async cut() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

describe("a lost database connection", () => {
  it("does not end the process; the lost connection is logged by code only and the next call is UNAVAILABLE", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "trace", messageKey: "message" }, { write: (chunk: string) => void lines.push(chunk) });
    const p = await proxy();
    const db = createDb(p.url, { readOnly: true, max: 1 });
    watchPool(db, logger);
    const server = createServer({ db, workspace: h.a.workspace, embedder: null, settings: h.settings, logger });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(s), client.connect(c)]);
    try {
      expect((await client.callTool({ name: "list_companies", arguments: {} })).isError).toBeFalsy();
      // The pool now holds one idle client. Without the listener, cutting it throws an uncaught error here.
      await p.cut();
      const end = Date.now() + 5_000;
      while (!lines.some((l) => l.includes("database connection lost")) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      const lost = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.message === "database connection lost");
      expect(lost).toBeDefined();
      expect(Object.keys(lost!).sort()).toEqual(["hostname", "level", "message", "pid", "sqlstate", "time"]);
      expect(lines.join("")).not.toMatch(/terminated|ECONNRESET|unexpectedly/i);

      const next = await client.callTool({ name: "list_companies", arguments: {} });
      expect(next.isError).toBe(true);
      expect(textOf(next)).toBe("UNAVAILABLE: Maester's database did not answer.");
    } finally {
      await client.close();
      await server.close();
      await closeDb(db);
    }
  });
});
