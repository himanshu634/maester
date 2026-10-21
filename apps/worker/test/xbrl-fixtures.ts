import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import {
  XbrlPdfCheckResult,
  XbrlReadResult,
  type XbrlPdfCheckRequest,
} from "@maester/contracts";
import { schema, type ClassificationRow, type Db } from "@maester/db";
import type { ObjectStore } from "@maester/storage";
import type { ExtractorClient, XbrlPdfCheckInput, XbrlRequest } from "../src/extractor.js";
import { JobFailure } from "../src/jobs/types.js";
import { seedWorkspace } from "./context.js";

const dir = new URL("../../../packages/contracts/fixtures/xbrl/", import.meta.url);
const lastLine = (file: string) => JSON.parse(readFileSync(new URL(file, dir), "utf8").trim().split("\n").at(-1)!) as { result: unknown };

/** Task 6's read: four facts (revenue, a nil other income, basic EPS, the closing cash balance) and one sum not checked. */
export const READ_RESULT: XbrlReadResult = XbrlReadResult.parse(lastLine("stream-read.ndjson").result);
/** Task 6's PDF check answers: passed on page 3, failed, not checked for want of a value, not checked as scanned. */
export const CHECK_ANSWERS = XbrlPdfCheckResult.parse(JSON.parse(readFileSync(new URL("pdf-check-result.json", dir), "utf8"))).results;

export const PERIOD = "2025-09-30";

const clone = <T>(v: T): T => structuredClone(v);

/** A banking instance: no map reads it, so no facts and no checks. */
export function unmappedRead(): XbrlReadResult {
  return {
    ...clone(READ_RESULT),
    promptVersion: "in-capmkt/banking@-",
    format: { family: "in-capmkt", kind: "banking", id: "in-capmkt/banking", mapped: false },
    finestDecimals: null,
    warnings: [{ code: "XBRL_FORMAT_UNMAPPED", message: "in-capmkt/banking" }],
    facts: [],
    checks: [],
  };
}

/** The read of an instance that declares no rounding: monetary facts have no unit, the revision is partial. */
export function roundingMissingRead(opts: { perShare?: boolean } = {}): XbrlReadResult {
  const r = clone(READ_RESULT);
  r.state = "partial";
  r.rounding = null;
  r.warnings.push({ code: "XBRL_ROUNDING_MISSING", message: "No level of rounding is declared." });
  r.facts = r.facts
    .filter((f) => opts.perShare !== false || f.unitLabel !== "₹ a share")
    .map((f) => (f.unitLabel === "₹ a share" ? f : { ...f, reportedValue: null, unitLabel: null, scaleFactor: null }));
  return r;
}

/** The read with one failed sum, to count failed checks. */
export function failedSumRead(): XbrlReadResult {
  const r = clone(READ_RESULT);
  r.checks = [...r.checks, { ...r.checks[0]!, subjectLabel: "Total expenses", status: "failed", expected: "100.00", actual: "90.00", detail: "" }];
  return r;
}

/**
 * A fake extractor answering from the fixtures. `read` is the next read answer (or a failure to throw). The PDF check
 * answers each fact sent, in order, with the fixture's answers: a fact with no value gets the fixture's `no_value`, the
 * others take its passed and failed answers in turn.
 */
export class FakeExtractor {
  read: XbrlReadResult | JobFailure = READ_RESULT;
  readCalls = 0;
  checkRequests: { documentId: string; pdf: Uint8Array; request: XbrlPdfCheckRequest }[] = [];

  readonly client: ExtractorClient = {
    extract: async () => { throw new Error("no extract in these tests"); },
    classify: async () => { throw new Error("no classify in these tests"); },
    xbrl: (async (input: XbrlRequest<"read">, onEvent: (e: { type: "heartbeat" }) => Promise<void>) => {
      if (input.mode !== "read") throw new Error(`no ${input.mode} in these tests`);
      this.readCalls++;
      await onEvent({ type: "heartbeat" });
      if (this.read instanceof JobFailure) throw this.read;
      return clone(this.read);
    }) as unknown as ExtractorClient["xbrl"],
    xbrlPdfCheck: async (input: XbrlPdfCheckInput) => {
      this.checkRequests.push(input);
      let turn = 0;
      return {
        checkVersion: 1 as const,
        results: input.request.facts.map((f) => {
          const answer = f.value === null ? CHECK_ANSWERS[2]! : CHECK_ANSWERS[turn++ % 2]!;
          return { ...answer, factId: f.factId };
        }),
      };
    },
  };

  reset(): void {
    this.read = READ_RESULT;
    this.readCalls = 0;
    this.checkRequests = [];
  }
}

export interface XbrlWs { workspaceId: string; userId: string; companyId: string }

export async function seedXbrlWs(db: Db): Promise<XbrlWs> {
  const { workspaceId, userId } = await seedWorkspace(db);
  const companyId = crypto.randomUUID();
  await db.insert(schema.company).values({
    id: companyId, workspaceId, displayName: "Synthetic Cements Limited", country: "IN", createdByUserId: userId, bseCode: "500999",
  });
  return { workspaceId, userId, companyId };
}

type DocInsert = Partial<typeof schema.document.$inferInsert>;

/** A stored document with its bytes in the store. */
export async function addDoc(db: Db, store: ObjectStore, ws: XbrlWs, format: "pdf" | "xbrl", extra: DocInsert = {}): Promise<string> {
  const id = crypto.randomUUID();
  const ext = format === "pdf" ? "pdf" : "xml";
  const storageKey = `workspaces/${ws.workspaceId}/documents/${id}/original.${ext}`;
  await db.insert(schema.document).values({
    id, workspaceId: ws.workspaceId, originalName: `results.${ext}`, declaredSize: 10,
    declaredMime: format === "pdf" ? "application/pdf" : "application/xml", format, storageKey, state: "stored",
    intakeState: "identifying", createdByUserId: ws.userId, ...extra,
  });
  const bytes = format === "pdf" ? "%PDF-1.4 synthetic" : "<xbrl>synthetic</xbrl>";
  await store.put(storageKey, new TextEncoder().encode(bytes), format === "pdf" ? "application/pdf" : "application/xml");
  return id;
}

/** A Maester classification of a results filing of the company for the period, read under itself. */
export async function classifyDoc(db: Db, ws: XbrlWs, documentId: string, c: Partial<typeof schema.documentClassification.$inferInsert> = {}): Promise<ClassificationRow> {
  const id = crypto.randomUUID();
  const [row] = await db.insert(schema.documentClassification).values({
    id, workspaceId: ws.workspaceId, documentId, kind: "financial_results", setBy: "maester", companyId: ws.companyId,
    periodEnd: PERIOD, readsUnderId: id, createdAt: sql`clock_timestamp()`, ...c,
  }).returning();
  return row!;
}

/** A results PDF of the company for the period that prints the consolidated statements. */
export const PDF_STATEMENTS = [
  { statement: "income_statement", basis: "consolidated", pages: [3] },
  { statement: "cash_flow", basis: "consolidated", pages: [5, 6] },
];

/** Strings of the fixture that must never reach a log: values as printed, labels and the instance's own bytes. */
export const INSTANCE_TEXT = ["1234500000", "12345.00", "12.34", "2500.00", "250000000", "Revenue from operations", "Basic earnings per share", "synthetic"];
