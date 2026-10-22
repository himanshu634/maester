import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import pino from "pino";
import { runTool, failed, answered } from "../src/errors.js";
import { resolveWorkspace } from "../src/workspace.js";
import { loadSettings, SettingsError } from "../src/settings.js";
import { createHarness, textOf, TEST_DATABASE_URL, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  // Workspace a: Synthetic has two annual reports read, Harbour nothing.
  await h.seedFiling(h.a.workspace.id, h.a.userId, h.a.companies.synthetic!, "2025-03-31", [{ label: "Freight and forwarding", period: "2025-03-31", printed: "2,389.10", page: 198 }]);
  await h.seedFiling(h.a.workspace.id, h.a.userId, h.a.companies.synthetic!, "2026-03-31", [{ label: "Freight and forwarding", period: "2026-03-31", printed: "2,602.15" }]);
  await h.seedFiling(h.b.workspace.id, h.b.userId, h.b.companies.other!, "2026-03-31", [{ label: "Freight and forwarding", period: "2026-03-31", printed: "1.00" }]);
});
afterAll(() => h.close());

const settingsFor = (env: Record<string, string>) => loadSettings({ DATABASE_URL: TEST_DATABASE_URL, ...env });

describe("resolveWorkspace", () => {
  it("finds a workspace by id", async () => {
    const ws = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_WORKSPACE_ID: h.b.workspace.id }));
    expect(ws.id).toBe(h.b.workspace.id);
  });

  it("takes the user's first workspace by creation time when given an email", async () => {
    // A second, later workspace for the same user; the first one wins.
    const later = crypto.randomUUID();
    await h.db.insert(schema.workspace).values({ id: later, name: "Later", ownerUserId: h.a.userId, createdAt: new Date(Date.now() + 60_000) });
    await h.db.insert(schema.membership).values({ id: crypto.randomUUID(), workspaceId: later, userId: h.a.userId, role: "owner", state: "active" });
    const ws = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_USER_EMAIL: h.a.email }));
    expect(ws.id).toBe(h.a.workspace.id);
  });

  it("matches the email without regard to case", async () => {
    const ws = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_USER_EMAIL: "B@Example.com" }));
    expect(ws.id).toBe(h.b.workspace.id);
  });

  it("lets the id win over the email", async () => {
    const ws = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_WORKSPACE_ID: h.b.workspace.id, MAESTER_USER_EMAIL: h.a.email }));
    expect(ws.id).toBe(h.b.workspace.id);
  });

  it("names the setting when the workspace does not exist", async () => {
    const err = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_WORKSPACE_ID: crypto.randomUUID() })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SettingsError);
    expect((err as Error).message).toBe("MAESTER_WORKSPACE_ID: no such workspace");
  });

  it("names the setting when the email has no user, or the user no workspace", async () => {
    const none = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_USER_EMAIL: "nobody@example.com" })).catch((e: unknown) => e);
    expect((none as Error).message).toBe("MAESTER_USER_EMAIL: no user with a workspace");
    await h.db.insert(schema.user).values({ id: crypto.randomUUID(), name: "Lone", email: "lone@example.com", emailVerified: true });
    const lone = await resolveWorkspace(h.readDb, settingsFor({ MAESTER_USER_EMAIL: "lone@example.com" })).catch((e: unknown) => e);
    expect(lone).toBeInstanceOf(SettingsError);
    expect((lone as Error).message).toBe("MAESTER_USER_EMAIL: no user with a workspace");
  });
});

describe("tools", () => {
  it("lists exactly the allow-listed tools", async () => {
    const { TOOL_NAMES } = await import("../src/tools/index.js");
    const names = (await h.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    expect(names).toEqual(["get_fact", "get_filing_facts", "get_statement", "list_companies", "list_filings", "list_metrics"]);
  });

  it("opens every description with the answer rules and ends with what to do without an answer", async () => {
    for (const tool of (await h.client.listTools()).tools) {
      expect(tool.description, tool.name).toMatch(/^Figures are decimal strings/);
      expect(tool.description, tool.name).toMatch(/If .*(no|nothing|none|not)/is);
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });
});

describe("list_companies", () => {
  it("lists workspace a's companies and not workspace b's", async () => {
    const res = await h.client.callTool({ name: "list_companies", arguments: {} });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as { companies: Record<string, unknown>[] };
    expect(body.companies).toEqual([
      { company_id: h.a.companies.harbour, name: "Harbour Cements Limited", nse_symbol: null, bse_code: null, cin: null, annual_reports_read: 0, latest_period_end: null, state: "Nothing read yet" },
      {
        company_id: h.a.companies.synthetic, name: "Synthetic Cements Limited", nse_symbol: "SYNCEM", bse_code: "500001", cin: "L26942MH1999PLC123456",
        annual_reports_read: 2, latest_period_end: "2026-03-31", state: "Read",
      },
    ]);
    expect(JSON.stringify(res)).not.toContain("Other Workspace");
    expect(textOf(res)).toContain("2 companies");
  });
});

describe("list_filings", () => {
  const filingsOf = (res: unknown) => ((res as { structuredContent?: unknown }).structuredContent as { companies: { company_id: string; filings: { period_end: string | null; files: { name: string }[] }[] }[] }).companies;

  it("lists every filing of the workspace without a company id", async () => {
    const res = await h.client.callTool({ name: "list_filings", arguments: {} });
    expect(res.isError).toBeFalsy();
    const synthetic = filingsOf(res).find((c) => c.company_id === h.a.companies.synthetic)!;
    expect(synthetic.filings.map((f) => f.period_end).sort()).toEqual(["2025-03-31", "2026-03-31"]);
    expect(synthetic.filings[0]!.files[0]!.name).toMatch(/^ar-.*\.pdf$/);
    expect(JSON.stringify(res)).not.toContain("Other Workspace");
  });

  it("narrows to one company when given its id", async () => {
    const res = await h.client.callTool({ name: "list_filings", arguments: { company_id: h.a.companies.harbour } });
    expect(res.isError).toBeFalsy();
    expect(filingsOf(res).every((c) => c.company_id === h.a.companies.harbour)).toBe(true);
    const only = await h.client.callTool({ name: "list_filings", arguments: { company_id: h.a.companies.synthetic } });
    expect(filingsOf(only).map((c) => c.company_id)).toEqual([h.a.companies.synthetic]);
  });

  it("answers NOT_FOUND for another workspace's company, the same as for a missing one", async () => {
    const other = await h.client.callTool({ name: "list_filings", arguments: { company_id: h.b.companies.other } });
    const missing = await h.client.callTool({ name: "list_filings", arguments: { company_id: crypto.randomUUID() } });
    expect(other.isError).toBe(true);
    expect(textOf(other)).toMatch(/^NOT_FOUND: /);
    expect(textOf(other)).toBe(textOf(missing));
    expect(other.structuredContent).toBeUndefined();
  });

  it("turns a malformed id into an input error, never UNAVAILABLE", async () => {
    const res = await h.client.callTool({ name: "list_filings", arguments: { company_id: "not-a-uuid" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain("UNAVAILABLE");
  });
});

describe("list_metrics", () => {
  it("answers an empty list and the sentence that says Maester cannot calculate yet", async () => {
    const sentence = "Maester has no named calculations yet. Do not work out growth, margins, ratios or any other figure from the facts; say that Maester cannot calculate it yet.";
    const res = await h.client.callTool({ name: "list_metrics", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ metrics: [], note: sentence });
    expect(textOf(res)).toBe(sentence);
  });
});

describe("runTool", () => {
  function recorder() {
    const lines: Record<string, unknown>[] = [];
    const logger = pino({ level: "info" }, { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Record<string, unknown>) });
    return { lines, logger };
  }

  it("turns a thrown error into UNAVAILABLE and logs its code, not its message", async () => {
    const { lines, logger } = recorder();
    const res = await runTool("list_companies", logger, async () => {
      throw new Error('select "secret" from facts where value = 12345.67');
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("UNAVAILABLE: Maester's database did not answer.");
    expect(res.structuredContent).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tool: "list_companies", items: 0, code: "UNAVAILABLE" });
    expect(JSON.stringify(lines)).not.toContain("12345.67");
  });

  it("logs one line with the tool, milliseconds, item count and code, and nothing of the answer", async () => {
    const { lines, logger } = recorder();
    await runTool("list_x", logger, async () => answered({ secret: "9999.99" }, "text", 3));
    await runTool("list_x", logger, async () => failed("NOT_FOUND", "gone"));
    expect(lines.map((l) => [l.tool, l.items, l.code])).toEqual([["list_x", 3, null], ["list_x", 0, "NOT_FOUND"]]);
    expect(typeof lines[0]!.ms).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("9999.99");
  });
});

describe("the server's pool", () => {
  it("refuses a write", async () => {
    const err = await h.readDb.insert(schema.workspace).values({ id: crypto.randomUUID(), name: "x", ownerUserId: h.a.userId }).catch((e: unknown) => e);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe("25006");
  });
});
