import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@maester/db";
import { FakeEmbedder } from "@maester/document-index";
import { createServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tools/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHarness, TEST_DATABASE_URL, textOf, type Harness } from "./harness.js";

/** A pino destination that keeps every line it is given. */
function recorder() {
  const lines: string[] = [];
  const logger = pino({ level: "trace", messageKey: "message" }, { write: (chunk: string) => void lines.push(chunk) });
  return { lines, logger };
}

const log = recorder();
/** A log line: pino's own fields, then what runTool adds. Nothing else. */
const LOG_KEYS = ["code", "hostname", "items", "level", "message", "ms", "pid", "time", "tool"];
const LINE_NAME = "Freight and forwarding";
const OTHER_LINE = "Zircon royalty income";
const QUERY = "kilns quartzite throughput";
const PASSAGE = "Kilns ran at ninety percent of capacity";

let h: Harness;
let search: Awaited<ReturnType<Harness["connectServer"]>>;
let co: string;
let doc: string;
let factId: string;

beforeAll(async () => {
  h = await createHarness({ logger: log.logger });
  const { workspace, userId } = h.a;
  co = h.a.companies.synthetic!;
  doc = await h.seedFiling(workspace.id, userId, co, "2026-03-31", [
    { label: LINE_NAME, period: "2026-03-31", printed: "2,602.15", order: 0 },
    { label: OTHER_LINE, period: "2026-03-31", printed: "88.50", order: 1 },
  ]);
  const res = await h.client.callTool({ name: "get_filing_facts", arguments: { document_id: doc } });
  factId = (res.structuredContent as { facts: { fact_id: string }[] }).facts[0]!.fact_id;
  search = await h.connectServer(new FakeEmbedder());
});
afterAll(async () => {
  await search.close();
  await h.close();
});

const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });

describe("the allow-list", () => {
  it("lists exactly the seven tools, all read-only", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toHaveLength(7);
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
  });
});

describe("id inputs", () => {
  const MISSING = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
  const idTools: { tool: string; field: string; extra?: Record<string, unknown> }[] = [
    { tool: "list_filings", field: "company_id" },
    { tool: "get_statement", field: "company_id", extra: { statement: "income_statement", basis: "consolidated" } },
    { tool: "get_filing_facts", field: "document_id" },
    { tool: "get_fact", field: "fact_id" },
    { tool: "search_filings", field: "company_id", extra: { query: QUERY } },
  ];

  function expectClean(text: string) {
    expect(text).not.toContain("UNAVAILABLE");
    expect(text).not.toContain("    at ");
    expect(text).not.toMatch(/select |insert |postgres/i);
  }

  for (const { tool, field, extra } of idTools) {
    it(`${tool}: ${field} that is not a UUID or is padded is INVALID_INPUT`, async () => {
      for (const bad of ["not-a-uuid", ` ${factId} `, ""]) {
        const res = await (tool === "search_filings" ? search.client : h.client).callTool({ name: tool, arguments: { ...extra, [field]: bad } });
        expect(res.isError, `${tool} ${JSON.stringify(bad)}`).toBe(true);
        expect(textOf(res)).toContain("Input validation error");
        expectClean(textOf(res));
      }
    });

    it(`${tool}: an upper-case UUID of a missing row is NOT_FOUND`, async () => {
      const res = await (tool === "search_filings" ? search.client : h.client).callTool({ name: tool, arguments: { ...extra, [field]: MISSING } });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/^NOT_FOUND:/);
      expectClean(textOf(res));
    });
  }

  it("an upper-case UUID of a row that exists finds it, in the workspace only", async () => {
    const res = await call("get_fact", { fact_id: factId.toUpperCase() });
    expect(res.isError).toBeFalsy();
    const other = await h.seedFiling(h.b.workspace.id, h.b.userId, h.b.companies.other!, "2026-03-31", [{ label: "Elsewhere", period: "2026-03-31", printed: "1.00" }]);
    const otherFacts = await h.db.query.financialFact.findMany({ where: (f, { eq }) => eq(f.workspaceId, h.b.workspace.id) });
    expect(other).toBeTruthy();
    const foreign = await call("get_fact", { fact_id: otherFacts[0]!.id.toUpperCase() });
    expect(textOf(foreign)).toMatch(/^NOT_FOUND:/);
  });
});

describe("a closed database", () => {
  it("gives UNAVAILABLE in a sentence, and the log line has the code and no SQL", async () => {
    const own = recorder();
    const db = createDb(TEST_DATABASE_URL, { readOnly: true, max: 1 });
    const server = createServer({ db, workspace: h.a.workspace, embedder: null, settings: h.settings, logger: own.logger });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(s), client.connect(c)]);
    await closeDb(db);

    for (const [name, args] of [
      ["list_companies", {}],
      ["get_fact", { fact_id: factId }],
      ["get_statement", { company_id: co, statement: "income_statement", basis: "consolidated" }],
    ] as const) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError, name).toBe(true);
      expect(textOf(res)).toMatch(/^UNAVAILABLE:/);
      expect(textOf(res)).not.toContain("    at ");
      expect(textOf(res)).not.toMatch(/pool|select|from "/i);
    }
    await client.close();
    await server.close();

    expect(own.lines).toHaveLength(3);
    for (const line of own.lines) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      expect(rec.code).toBe("UNAVAILABLE");
      expect(Object.keys(rec).sort()).toEqual(LOG_KEYS);
      expect(line).not.toMatch(/select|insert|pool|"query"|stack/i);
    }
  });
});

describe("logs", () => {
  it("one line per call carries the tool, time, count and code, and nothing of the text or figures", async () => {
    log.lines.length = 0;
    const calls: [Client, string, Record<string, unknown>][] = [
      [h.client, "list_companies", {}],
      [h.client, "list_filings", { company_id: co }],
      [h.client, "get_statement", { company_id: co, statement: "income_statement", basis: "consolidated" }],
      [h.client, "get_statement", { company_id: co, statement: "balance_sheet", basis: "standalone" }],
      [h.client, "get_filing_facts", { document_id: doc }],
      [h.client, "get_fact", { fact_id: factId }],
      [h.client, "get_fact", { fact_id: crypto.randomUUID() }],
      [h.client, "list_metrics", {}],
      [search.client, "search_filings", { query: QUERY, company_id: co }],
    ];
    for (const [client, name, args] of calls) await client.callTool({ name, arguments: args });
    expect(log.lines).toHaveLength(calls.length);

    const all = log.lines.join("");
    for (const secret of [LINE_NAME, OTHER_LINE, "2,602.15", "2602.15", "260.215", "88.50", QUERY, "quartzite", PASSAGE, co, doc, factId]) {
      expect(all, secret).not.toContain(secret);
    }
    for (const line of log.lines) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(rec).sort()).toEqual(LOG_KEYS);
      expect(TOOL_NAMES).toContain(rec.tool);
      expect(typeof rec.ms).toBe("number");
      expect(typeof rec.items).toBe("number");
    }
    // The missing fact is the one failed call; its line has the code.
    expect(log.lines.map((l) => (JSON.parse(l) as { code: string | null }).code).filter(Boolean)).toEqual(["NOT_FOUND"]);
  });
});
