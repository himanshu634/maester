import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JobTypes } from "@maester/contracts";
import {
  chunksWithoutEmbedding, closeDb, completeRevision, createDb, ensurePersonalWorkspace, insertEmbeddings, runMigrations, schema, startOrResumeRevision, writeRange,
  type ChunkInput, type Db, type WorkspaceRow,
} from "@maester/db";
import { FakeEmbedder, type Embedder } from "@maester/document-index";
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

export type Line = {
  label: string; period: string; printed: string; page?: number; section?: string; order?: number;
  /** An XBRL fact's span (default "year") and its period start. */
  span?: "quarter" | "half_year" | "nine_months" | "year" | "other"; periodStart?: string;
  /** Defaults: "Year ended <period>", consolidated, income statement, not a subtotal. */
  periodLabel?: string; basis?: "consolidated" | "standalone" | "unknown"; statement?: "income_statement" | "balance_sheet" | "cash_flow";
  isSubtotal?: boolean; components?: string[];
};

/** An arithmetic check of a revision, as the worker writes one. */
export type CheckSeed = {
  subject: string; periodLabel: string; status: "passed" | "failed" | "not_checked"; expected?: string; actual?: string;
  checkType?: "subtotal" | "balance_identity"; section?: string | null; basis?: "consolidated" | "standalone" | "unknown";
  statement?: "income_statement" | "balance_sheet" | "cash_flow";
};

/** One indexed passage of a document: its text and where it sits. */
export type Chunk = { text: string; sectionPath?: string[]; pageNumber?: number | null; element?: string; textSource?: ChunkInput["textSource"] };
export type SeedOpts = { kind?: "annual_report" | "financial_results"; intakeState?: "read" | "kept"; source?: "pdf" | "xbrl"; name?: string; readAt?: Date };

export type Seeded = {
  userId: string;
  email: string;
  workspace: WorkspaceRow;
  /** Companies by short name. */
  companies: Record<string, string>;
};

type CompanyIds = { cin?: string; bseCode?: string; nseSymbol?: string };

export type HarnessOptions = { logger?: Logger; settings?: Partial<Record<string, string>>; embedder?: Embedder | null };

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
      id: documentId, workspaceId: ws, companyId, originalName: seedOpts.name ?? (xbrl ? `results-${periodEnd}.xml` : `ar-${periodEnd}.pdf`), declaredSize: 10,
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
    await insertRevision(ws, documentId, classificationId, companyId, jobId, xbrl, lines, seedOpts.readAt ?? new Date());
    return documentId;
  }

  async function insertRevision(ws: string, documentId: string, classificationId: string, companyId: string, jobId: string, xbrl: boolean, lines: Line[], createdAt: Date) {
    const revisionId = crypto.randomUUID();
    await db.insert(schema.extractionRevision).values({
      id: revisionId, workspaceId: ws, documentId, jobId, classificationId, source: xbrl ? "xbrl" : "pdf", state: "complete", pipelineVersion: "extract-1", model: "m",
      promptVersion: "p", pageCount: xbrl ? 1 : 286, companyNameAsPrinted: "Synthetic Cements Limited", coverage: { statements: [] }, createdAt,
    });
    for (const line of lines) {
      const factId = crypto.randomUUID();
      const reported = line.printed.replace(/,/g, "");
      await db.insert(schema.financialFact).values({
        id: factId, workspaceId: ws, revisionId, companyId, statement: line.statement ?? "income_statement", basis: line.basis ?? "consolidated", section: line.section ?? "Income",
        lineOrder: line.order ?? 0, reportedLabel: line.label, isSubtotal: line.isSubtotal ?? false, componentLabels: line.components ?? [], periodLabel: line.periodLabel ?? `Year ended ${line.period}`,
        periodEnd: line.period, ...(xbrl || line.span ? { span: line.span ?? ("year" as const) } : {}), ...(line.periodStart ? { periodStart: line.periodStart } : {}), reportedText: line.printed, reportedValue: reported, valueStatus: "value",
        unitLabel: "₹ in crore", scaleFactor: "10000000", currency: "INR", normalizedValue: moveDecimal(reported, 7),
      });
      if (xbrl) {
        await db.insert(schema.xbrlSource).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5" });
      } else {
        await db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId, pageIndex: (line.page ?? 213) - 1, textLayerMatch: true });
      }
    }
    return revisionId;
  }

  /** The newest revision of a document. */
  async function revisionOf(documentId: string) {
    const rows = await db.query.extractionRevision.findMany({ where: (r, { eq }) => eq(r.documentId, documentId), orderBy: (r, { desc }) => [desc(r.createdAt)] });
    return rows[0]!;
  }

  /** A re-read: a newer revision of the document under the same classification, with its own facts. Returns the revision id. */
  async function seedReread(documentId: string, lines: Line[], createdAt: Date) {
    const old = await revisionOf(documentId);
    const jobId = crypto.randomUUID();
    await db.insert(schema.job).values({
      id: jobId, workspaceId: old.workspaceId, type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: documentId, idempotencyKey: `reread-${jobId}`, state: "succeeded",
    });
    const doc = await db.query.document.findFirst({ where: (d, { eq }) => eq(d.id, documentId) });
    return insertRevision(old.workspaceId, documentId, old.classificationId!, doc!.companyId!, jobId, old.source === "xbrl", lines, createdAt);
  }

  /** An arithmetic check on the document's newest revision. */
  async function seedCheck(documentId: string, c: CheckSeed) {
    const rev = await revisionOf(documentId);
    await db.insert(schema.extractionCheck).values({
      id: crypto.randomUUID(), workspaceId: rev.workspaceId, revisionId: rev.id, checkType: c.checkType ?? "subtotal", statement: c.statement ?? "income_statement",
      basis: c.basis ?? "consolidated", section: c.section === undefined ? "Income" : c.section, periodLabel: c.periodLabel, subjectLabel: c.subject, status: c.status,
      expected: c.expected ?? null, actual: c.actual ?? null, detail: "seeded",
    });
  }

  /** One document with the given chunks, indexed and embedded with the fake embedder, as packages/document-index's search tests seed one. */
  async function seedIndexed(ws: string, userId: string, companyId: string | null, name: string, chunks: Chunk[], embedder: Embedder = new FakeEmbedder()): Promise<string> {
    const model = embedder.model;
    const documentId = crypto.randomUUID();
    await db.insert(schema.document).values({
      id: documentId, workspaceId: ws, companyId, originalName: name, declaredSize: 10, declaredMime: "application/pdf",
      storageKey: `workspaces/${ws}/documents/${documentId}/original.pdf`, state: "stored", intakeState: "read", createdByUserId: userId,
    });
    const jobId = crypto.randomUUID();
    await db.insert(schema.job).values({
      id: jobId, workspaceId: ws, type: "document.index", subjectType: "document_index", subjectId: documentId,
      idempotencyKey: `document.index:${documentId}:${model}`, state: "queued",
    });
    const rev = await startOrResumeRevision(db, ws, {
      documentId, jobId,
      versions: { doclingVersion: "2", ocrEngine: "rapidocr", readerOptions: "o", chunkerVersion: "c", tokenizer: model, indexVersion: "1", embeddingModel: model },
    });
    const inputs: ChunkInput[] = chunks.map((c, i) => ({
      pageNumber: c.pageNumber === undefined ? 1 : c.pageNumber, element: c.element ?? null, seq: i, sectionPath: c.sectionPath ?? [], kind: "prose",
      textSource: c.textSource ?? "text_layer", text: c.text, tokenCount: 4,
    }));
    await writeRange(db, ws, rev.id, documentId, [{ pageNumber: 1, text: "p", itemsTextLayer: 1, itemsOcr: 0, noneReason: null, sectionPathAfter: [] }], inputs, {
      pageCount: 1, pagesRead: 1, pagesOcr: 0, warnings: [],
    });
    const rows = await chunksWithoutEmbedding(db, ws, rev.id, model, inputs.length);
    const vectors = await embedder.embed(rows.map((r) => r.text), "document");
    await insertEmbeddings(db, ws, model, rows.map((r, i) => ({ chunkId: r.id, embedding: vectors[i]! })));
    await completeRevision(db, ws, rev.id);
    return documentId;
  }

  const settings: Settings = loadSettings({ DATABASE_URL: TEST_DATABASE_URL, MAESTER_WORKSPACE_ID: a.workspace.id, ...opts.settings });
  const readDb = createDb(TEST_DATABASE_URL, { readOnly: true, max: 2 });
  /** Another server and client over the same read-only pool, without seeding or truncating: its own embedder, its own gate. */
  async function connectServer(embedder: Embedder | null) {
    const srv = createServer({ db: readDb, workspace: a.workspace, embedder, settings, logger: opts.logger ?? silentLogger });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([srv.connect(s), cl.connect(c)]);
    return { client: cl, async close() { await cl.close(); await srv.close(); } };
  }
  const main = await connectServer(opts.embedder ?? null);
  const client = main.client;

  return {
    client,
    /** The writable pool: seeding only. */
    db: db as Db,
    /** The server's own read-only pool. */
    readDb: readDb as Db,
    a,
    b,
    seedFiling,
    seedReread,
    seedCheck,
    seedIndexed,
    settings,
    connectServer,
    async close() {
      await main.close();
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
