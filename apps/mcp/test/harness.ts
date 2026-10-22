import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JobTypes } from "@maester/contracts";
import { closeDb, createDb, ensurePersonalWorkspace, runMigrations, schema, type Db, type WorkspaceRow } from "@maester/db";
import { silentLogger, type Logger } from "../src/logger.js";
import { createServer } from "../src/server.js";
import { loadSettings, type Settings } from "../src/settings.js";

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST_MCP ?? "postgres://maester:maester@localhost:5433/maester_test_mcp";

/** Moves the decimal point `places` to the right, exactly (the same arithmetic as the API's test helper). */
function moveDecimal(value: string, places: number): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!m) throw new Error(`not a decimal: ${value}`);
  const [, sign, int = "", frac = ""] = m;
  let digits = BigInt(int + frac || "0");
  let scale = frac.length - places;
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  const s = digits.toString().padStart(scale + 1, "0");
  let out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return sign && digits !== 0n ? `-${out}` : out;
}

export type Line = { label: string; period: string; printed: string; page?: number; section?: string; order?: number };
export type SeedOpts = { kind?: "annual_report" | "financial_results"; intakeState?: "read" | "kept"; source?: "pdf" | "xbrl" };

export type Seeded = {
  userId: string;
  email: string;
  workspace: WorkspaceRow;
  /** Companies by short name. */
  companies: Record<string, string>;
};

type CompanyIds = { cin?: string; bseCode?: string; nseSymbol?: string };

export type HarnessOptions = { logger?: Logger; settings?: Partial<Record<string, string>> };

/**
 * Two users, each with a workspace and companies, and a server over workspace `a` on a read-only pool. Seeding goes
 * through a separate writable pool, so a test can prove the server's own pool refuses writes.
 */
export async function createHarness(opts: HarnessOptions = {}) {
  const db = createDb(TEST_DATABASE_URL, { max: 2 });
  await runMigrations(db);
  // The same list the API's test context empties; CASCADE reaches everything that references them.
  await db.$client.query(
    `TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user", "waitlist_entry", "rate_limit", "market_point", "market_fetch", "market_connection" CASCADE`,
  );

  async function seedUser(email: string, name: string, companies: Record<string, [string, CompanyIds?]>): Promise<Seeded> {
    const userId = crypto.randomUUID();
    await db.insert(schema.user).values({ id: userId, name, email, emailVerified: true });
    const workspace = await ensurePersonalWorkspace(db, { userId, userName: name });
    const ids: Record<string, string> = {};
    for (const [key, [displayName, identifiers]] of Object.entries(companies)) {
      const id = crypto.randomUUID();
      await db.insert(schema.company).values({ id, workspaceId: workspace.id, displayName, country: "IN", createdByUserId: userId, ...identifiers });
      ids[key] = id;
    }
    return { userId, email, workspace, companies: ids };
  }

  const a = await seedUser("a@example.com", "Asha", {
    synthetic: ["Synthetic Cements Limited", { cin: "L26942MH1999PLC123456", bseCode: "500001", nseSymbol: "SYNCEM" }],
    harbour: ["Harbour Cements Limited"],
  });
  const b = await seedUser("b@example.com", "Bala", { other: ["Other Workspace Limited", { nseSymbol: "OTHERW" }] });

  /** A filing of a company: document, classification read under itself, revision, one fact per line. Returns the document id. */
  async function seedFiling(ws: string, userId: string, companyId: string, periodEnd: string, lines: Line[], seedOpts: SeedOpts = {}) {
    const documentId = crypto.randomUUID();
    const xbrl = seedOpts.source === "xbrl";
    await db.insert(schema.document).values({
      id: documentId, workspaceId: ws, companyId, originalName: xbrl ? `results-${periodEnd}.xml` : `ar-${periodEnd}.pdf`, declaredSize: 10,
      declaredMime: xbrl ? "application/xml" : "application/pdf", format: xbrl ? "xbrl" : "pdf",
      storageKey: `workspaces/${ws}/documents/${documentId}/original.${xbrl ? "xml" : "pdf"}`, state: "stored", intakeState: seedOpts.intakeState ?? "read", createdByUserId: userId,
    });
    const classificationId = crypto.randomUUID();
    await db.insert(schema.documentClassification).values({
      id: classificationId, workspaceId: ws, documentId, kind: seedOpts.kind ?? "annual_report", periodEnd, periodLabel: `Year ended ${periodEnd}`,
      companyId, setBy: "maester", statementsFound: [], readsUnderId: classificationId,
    });
    const jobId = crypto.randomUUID();
    await db.insert(schema.job).values({ id: jobId, workspaceId: ws, type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: documentId, idempotencyKey: `seed-${jobId}`, state: "succeeded" });
    const revisionId = crypto.randomUUID();
    await db.insert(schema.extractionRevision).values({
      id: revisionId, workspaceId: ws, documentId, jobId, classificationId, source: xbrl ? "xbrl" : "pdf", state: "complete", pipelineVersion: "extract-1", model: "m",
      promptVersion: "p", pageCount: xbrl ? 1 : 286, companyNameAsPrinted: "Synthetic Cements Limited", coverage: { statements: [] },
    });
    for (const line of lines) {
      const factId = crypto.randomUUID();
      const reported = line.printed.replace(/,/g, "");
      await db.insert(schema.financialFact).values({
        id: factId, workspaceId: ws, revisionId, companyId, statement: "income_statement", basis: "consolidated", section: line.section ?? "Income",
        lineOrder: line.order ?? 0, reportedLabel: line.label, isSubtotal: false, componentLabels: [], periodLabel: `Year ended ${line.period}`,
        periodEnd: line.period, ...(xbrl ? { span: "year" as const } : {}), reportedText: line.printed, reportedValue: reported, valueStatus: "value",
        unitLabel: "₹ in crore", scaleFactor: "10000000", currency: "INR", normalizedValue: moveDecimal(reported, 7),
      });
      if (xbrl) {
        await db.insert(schema.xbrlSource).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5" });
      } else {
        await db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId, pageIndex: (line.page ?? 213) - 1, textLayerMatch: true });
      }
    }
    return documentId;
  }

  const settings: Settings = loadSettings({ DATABASE_URL: TEST_DATABASE_URL, MAESTER_WORKSPACE_ID: a.workspace.id, ...opts.settings });
  const readDb = createDb(TEST_DATABASE_URL, { readOnly: true, max: 2 });
  const server = createServer({ db: readDb, workspace: a.workspace, embedder: null, settings, logger: opts.logger ?? silentLogger });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return {
    client,
    /** The writable pool: seeding only. */
    db: db as Db,
    /** The server's own read-only pool. */
    readDb: readDb as Db,
    a,
    b,
    seedFiling,
    settings,
    async close() {
      await client.close();
      await server.close();
      await closeDb(readDb);
      await closeDb(db);
    },
  };
}
export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** The text of a tool result's first content block. */
export function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content[0]?.text ?? "";
}
