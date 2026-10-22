import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, TEST_DATABASE_URL, type Harness } from "./harness.js";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

let h: Harness;
let co: string;
beforeAll(async () => {
  h = await createHarness();
  co = h.a.companies.synthetic!;
  await h.seedFiling(h.a.workspace.id, h.a.userId, co, "2026-03-31", [{ label: "Freight and forwarding", period: "2026-03-31", printed: "2,602.15" }]);
});
afterAll(() => h.close());

describe("stdio", () => {
  it("writes only JSON-RPC messages to stdout and the log lines to stderr, and exits when stdin closes", async () => {
    // The source through tsx, not dist, so the test does not depend on a build.
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: APP_DIR,
      // The URL tries to turn read-only off; the server keeps it on, or main would refuse to start.
      env: {
        PATH: process.env.PATH, DATABASE_URL: `${TEST_DATABASE_URL}?options=${encodeURIComponent("-c default_transaction_read_only=off")}`,
        MAESTER_WORKSPACE_ID: h.a.workspace.id, LOG_LEVEL: "info",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    const until = async (done: () => boolean) => {
      const end = Date.now() + 20_000;
      while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      expect(done(), `timed out; stderr: ${err}`).toBe(true);
    };
    /** Complete lines only: a long answer can arrive in pieces, and its last piece has no newline yet. */
    const lines = () => out.split("\n").slice(0, -1).filter((l) => l.trim() !== "");
    const hasId = (id: number) => lines().some((l) => (JSON.parse(l) as { id?: number }).id === id);

    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await until(() => hasId(1));
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "get_statement", arguments: { company_id: co, statement: "income_statement", basis: "consolidated" } },
      });
      await until(() => hasId(2));
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_fact", arguments: { fact_id: crypto.randomUUID() } } });
      send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_filings", arguments: { query: "kilns" } } });
      await until(() => hasId(3) && hasId(4));
      // The host stops the server by closing stdin; the server closes its pool and exits 0.
      const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
      child.stdin.end();
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((r) => child.once("exit", r));
      }
    }

    const stdout = out.split("\n").filter((l) => l.trim() !== "");
    expect(stdout.length).toBeGreaterThanOrEqual(2);
    for (const line of stdout) {
      const msg = JSON.parse(line) as { jsonrpc?: string };
      expect(msg.jsonrpc, line).toBe("2.0");
    }
    const call = stdout.map((l) => JSON.parse(l) as { id?: number; result?: { isError?: boolean } }).find((m) => m.id === 2)!;
    expect(call.result?.isError).toBeFalsy();

    const stderr = err.split("\n").filter((l) => l.trim() !== "");
    const logs = stderr.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logs.some((l) => l.message === "maester-mcp serving on stdio")).toBe(true);
    expect(logs.some((l) => l.tool === "get_statement" && l.code === null)).toBe(true);
    expect(logs.some((l) => l.tool === "get_fact" && l.code === "NOT_FOUND")).toBe(true);
    expect(logs.some((l) => l.tool === "search_filings" && l.code === "SEARCH_UNAVAILABLE")).toBe(true);
    expect(err).not.toContain("Freight and forwarding");
    expect(err).not.toContain("2,602.15");
  }, 60_000);
});
