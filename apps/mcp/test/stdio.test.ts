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
  it("writes only JSON-RPC messages to stdout and the log lines to stderr", async () => {
    // The source through tsx, not dist, so the test does not depend on a build.
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: APP_DIR,
      env: { PATH: process.env.PATH, DATABASE_URL: TEST_DATABASE_URL, MAESTER_WORKSPACE_ID: h.a.workspace.id, LOG_LEVEL: "info" },
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
    const hasId = (id: number) => out.split("\n").some((l) => l.trim() !== "" && (JSON.parse(l) as { id?: number }).id === id);

    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await until(() => hasId(1));
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "get_statement", arguments: { company_id: co, statement: "income_statement", basis: "consolidated" } },
      });
      await until(() => hasId(2));
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
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
    expect(err).not.toContain("Freight and forwarding");
    expect(err).not.toContain("2,602.15");
  }, 60_000);
});
