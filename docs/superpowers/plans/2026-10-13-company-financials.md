# Company financials implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Research becomes a working page: `/terminal/research` lists the investor's companies, and `/terminal/research/company?id=<uuid>` shows a company's stock and business summary, the last year's closing prices, and its statements year by year from every read annual report, each figure tracing to its page.

**Architecture.**
- **Extractor.** One sentence added to the extract prompt asks for earnings-per-share lines.
- **API.** Three read routes and a redirect. A pure module (`apps/api/src/financials/stitch.ts`) puts a company's years together from the facts of its read annual reports. A second pure module (`stock.ts`) summarises the NSE closes the market refresher already keeps.
- **Web.** Pure, tested modules in `apps/web/src/lib/research/` (view words, the summary, keyboard movement) and Svelte components in `apps/web/src/lib/components/research/`, following the "B · final" canvas.

**Tech stack.** TypeScript, Hono, drizzle-orm on Postgres 16, zod 4, vitest; SvelteKit 2 with Svelte 5 runes on adapter-static; Python 3.11 with unittest for the extractor prompt.

**Spec:** [docs/superpowers/specs/2026-10-13-company-financials-design.md](../specs/2026-10-13-company-financials-design.md). Read it first: the stitching rules, the summary rules and the states table are defined there. Design canvas: "Maester Financial Tables", https://claude.ai/artifact/YHy12h78LC5WUBwNynizXQ, page "B · final" (F1 desktop, F2 phone, F3 no price), with A's figure panel drawn in A1 and A3 on page "Round 1".

## Global constraints

- **Branch.** Work on `staging` in the main checkout. No feature branch, no worktree, no pull request. Commit when each task passes. Push when the whole plan is done and checked.
- **Commits.** Conventional Commits with a scope and a lower-case imperative subject, for example `feat(api): stitch a company's years from its annual reports`. Sign off with `git commit -s`. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands.**
  - TypeScript packages: `pnpm --filter <pkg> test|typecheck|lint` (`@maester/contracts`, `@maester/db`, `@maester/api`).
  - The web app: `pnpm --dir apps/web verify` (svelte-check, prettier, eslint, vitest with the design guard, then the static build). Never Make for web work.
  - The database: `pnpm db:up` (port 5433).
  - Python: `uv run --locked python -m unittest discover -s tests -v`.
- **Workspace boundary.** `apps/web` cannot import `@maester/contracts`. Mirror the wire types in `apps/web/src/lib/research/types.ts` by hand, with a header comment naming `packages/contracts/src/research.ts`.
- **Design.** `docs/DESIGN.md` binds every pixel: colours from `var(--…)` only; Archivo only; no radius or shadow; nothing below 14px; sentence case; direction shown with a sign or a word, never a colour; unknown is "—" with its reason, never 0; at most one non-user-triggered motion per page (the hatch while loading).
- **Copy.** Never advise. Banned anywhere in the summary or table copy: "buy", "sell", "cheap", "expensive", "undervalued", "overvalued", "target", "opportunity", "high confidence". Page numbers are counted from 1. Real figures carry no "Synthetic example" tag.
- **Personal use.** Prices are shown only behind a signed-in session; no public route reads `market_point`.
- **Svelte.** Before touching any `.svelte` file, load the skills `svelte-code-writer` and `svelte-core-bestpractices`.
- **Links to the company page.** Every route is prerendered, so the company page takes its id from `?id=`. `svelte/no-navigation-without-resolve` flags `` `${resolve(…)}?id=…` ``; use `companyHref()` from `lib/research/links.ts` and put `<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the id is known only at runtime; the path is resolve()d -->` on the line before each `<a>` that uses it. The same comment, with "an API route that redirects to the stored PDF", goes before each PDF link.
- **Dev servers.** A task that starts a server uses its own ports (API 8798, Vite 5175), never the user's stack on 5173 or 8787, never `docker compose up`, and stops both the pnpm wrapper and its child before finishing (confirm with `ps -axo pid,command | grep -E "vite|tsx"`).

## Review focus

The inputs most likely to break the page for the one person using it. Each has a test in the task named.

1. **A filing printed in lakh beside one printed in crore** must convert exactly, with no floating-point drift ("9,60,525.00 lakh" is 9605.25 crore). Task 3, "converts an older filing's lakh to the table's crore".
2. **Two lines with the same name in one statement** ("Borrowings" under non-current and current liabilities) must stay two rows. Task 3, "keeps lines with the same name apart by section and occurrence".
3. **An earnings-per-share line in a statement in crore** must read as printed, not multiplied by a crore, in the table and in price to earnings. Task 3, "reads a per-share line as printed"; Task 7, "uses the printed earnings per share".
4. **A company with no price** (no NSE symbol, Dhan not connected, or outside the Nifty 500) must still show its business figures, with "—" and the reason for each price figure, and no chart. Task 5 (the stock states), Task 7 ("shows the business figures with no price"), Task 9 (no chart without a price).
5. **A loss year, or no earlier year**, must not produce "grew −12%" or a percentage against a loss. Task 7, "says a loss in words".

---

### Task 1: Ask the extractor for earnings per share

**Files:**
- Modify: `packages/financial-engine/src/pdf_financial_qa/workflow/prompts.py` (the `EXTRACT` rules)
- Modify: `packages/financial-engine/src/pdf_financial_qa/workflow/values.py` (add `is_per_share`), `packages/financial-engine/src/pdf_financial_qa/workflow/runner.py` (`_fact`)
- Test: `tests/test_extraction_workflow.py`

**Interfaces:** Produces earnings-per-share facts (basic and diluted) in `income_statement` facts for filings read from now on, stored with `scale_factor` "1", so their `normalized_value` is the printed rupees a share rather than that times the statement's unit. `PROMPT_VERSION` is a hash of the prompt text, so it changes by itself. The API (Task 3) reads `reported_value` for per-share rows anyway, so facts read before this task still show correctly.

- [ ] **Step 1: Write the failing test.** Append to `tests/test_extraction_workflow.py`:

```python
class ExtractPromptTest(unittest.TestCase):
    def test_asks_for_earnings_per_share_lines(self):
        from pdf_financial_qa.workflow.prompts import EXTRACT

        self.assertIn("earnings per share", EXTRACT)
        self.assertIn("basic and diluted", EXTRACT)


class PerShareTest(unittest.TestCase):
    def test_spots_earnings_per_share_lines(self):
        from pdf_financial_qa.workflow.values import is_per_share

        self.assertTrue(is_per_share("Earnings per equity share (face value ₹10)", "Basic"))
        self.assertTrue(is_per_share("Other", "Basic EPS (₹)"))
        self.assertFalse(is_per_share("Income", "Revenue from operations"))
```

- [ ] **Step 2: Run it.** `uv run --locked python -m unittest tests.test_extraction_workflow.ExtractPromptTest tests.test_extraction_workflow.PerShareTest -v`. Expected: FAIL (`'earnings per share' not found`; `cannot import name 'is_per_share'`).

- [ ] **Step 3: Add the rule.** In `EXTRACT`, after the line-item rule (`- For every line item give its label as printed, … Omit a period when its cell is blank.`), add:

```python
- Include the earnings per share lines (basic and diluted) when the statement prints \
them, as line items under their own printed heading, with their values exactly as printed.
```

In `values.py` (add `import re` at the top if it is not there), next to `scale_for`:

```python
_PER_SHARE = re.compile(r"earnings per (equity )?share|\beps\b", re.IGNORECASE)


def is_per_share(section: str, label: str) -> bool:
    """A per-share line, such as earnings per share: rupees a share, whatever the statement's unit."""
    return bool(_PER_SHARE.search(section) or _PER_SHARE.search(label))
```

In `runner.py`, import `is_per_share` from `pdf_financial_qa.workflow.values` with `scale_for`, and make the first line of `_fact`'s body:

```python
    if is_per_share(section.name, line.label):
        scale = Decimal(1)
```

- [ ] **Step 4: Run all Python tests.** `uv run --locked python -m unittest discover -s tests -v`. Expected: PASS. If a test pins the old `PROMPT_VERSION` string, update it to the new value the test prints.

- [ ] **Step 5: Commit.** `git add packages/financial-engine/src/pdf_financial_qa/workflow tests/test_extraction_workflow.py && git commit -s -m "feat(extractor): read earnings per share lines at their printed value"` (with the Co-Authored-By line).

---

### Task 2: Contracts for research

**Files:**
- Create: `packages/contracts/src/research.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./research.js";` last)
- Test: `packages/contracts/test/research.test.ts`

**Interfaces:** Produces the zod schemas and types `CellStatus`, `CellCheck`, `CellSource`, `Restated`, `FinancialCell`, `FinancialRow`, `FinancialColumn`, `TableUnit`, `StatementTable`, `CompanyFiling`, `CompanyFinancials`, `StockPoint`, `CompanyStock`, `ResearchCompany`, `ResearchCompanies`, used by Tasks 3, 5 and 6.

- [ ] **Step 1: Write the failing test** `packages/contracts/test/research.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CompanyFinancials, CompanyStock, ResearchCompanies } from "../src/index.js";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const company = { id: ID, workspaceId: ID, displayName: "Synthetic Cements Limited", country: "IN", cin: null, bseCode: null, nseSymbol: "SYNCEM", createdAt: "2026-10-13T10:00:00.000Z" };

describe("research contracts", () => {
  it("parses a company's financials with one stitched cell", () => {
    const body = CompanyFinancials.parse({
      company,
      filings: [{ documentId: ID, originalName: "ar-2025-26.pdf", kind: "annual_report", periodEnd: "2026-03-31", intakeState: "read", counted: true }],
      tables: [{
        statement: "income_statement", basis: "consolidated",
        unit: { label: "₹ in crore", scale: "10000000", currency: "INR" },
        columns: [{ periodEnd: "2026-03-31", periodLabel: "Year ended 31 March 2026", documentId: ID, filingPeriodEnd: "2026-03-31" }],
        rows: [{
          key: "income|revenue from operations|0", section: "Income", label: "Revenue from operations", isSubtotal: false, perShare: false,
          cells: [{
            status: "value", value: "12105.4", printed: "12,105.40", factId: ID, revisionId: ID,
            source: { documentId: ID, pageIndex: 212, pageCount: 286, textLayerMatch: true },
            check: { role: "component", status: "passed", subjectLabel: "Total income", expected: "12480", actual: "12480" },
            restated: null,
          }],
        }],
        unplaced: 0, leftOut: [],
      }],
    });
    expect(body.tables[0]!.rows[0]!.cells[0]!.source!.pageIndex).toBe(212);
  });

  it("parses a stock with no price", () => {
    const stock = CompanyStock.parse({ state: "not_tracked", symbol: "HARBOUR", source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] });
    expect(stock.state).toBe("not_tracked");
  });

  it("parses the company list", () => {
    const list = ResearchCompanies.parse({ items: [{ company, annualReportsRead: 3, latestPeriodEnd: "2026-03-31", reading: 0, failed: 0 }] });
    expect(list.items).toHaveLength(1);
  });

  it("refuses an unknown stock state", () => {
    expect(() => CompanyStock.parse({ state: "maybe", symbol: null, source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run it.** `pnpm --filter @maester/contracts test -- research`. Expected: FAIL (no export `CompanyFinancials`).

- [ ] **Step 3: Write `packages/contracts/src/research.ts`.**

```ts
import { z } from "zod";
import { DecimalString, Uuid } from "./common.js";
import { Company } from "./company.js";
import { ClassificationKind, IntakeState } from "./classification.js";
import { IsoDate, ReportingBasis, StatementKind } from "./extraction.js";

/**
 * A company's statements put together across its read annual reports, and its NSE closes.
 * Read by the Research pages (docs/superpowers/specs/2026-10-13-company-financials-design.md).
 */

/** Read; a dash printed on the page; printed but not readable; or not printed by this column's filing. */
export const CellStatus = z.enum(["value", "dash", "unparsed", "missing"]);
export type CellStatus = z.infer<typeof CellStatus>;

/** The arithmetic check covering a figure: as the subtotal itself, as one of its lines, or none. */
export const CellCheck = z.object({
  role: z.enum(["subject", "component", "none"]),
  status: z.enum(["passed", "failed", "not_checked"]).nullable(),
  /** The subtotal the check is about, as printed. */
  subjectLabel: z.string().nullable(),
  /** What the lines add up to, and what the page prints, in the table's unit. */
  expected: DecimalString.nullable(),
  actual: DecimalString.nullable(),
});
export type CellCheck = z.infer<typeof CellCheck>;

export const CellSource = z.object({
  documentId: Uuid,
  /** 0-based page index of the original PDF. */
  pageIndex: z.number().int().min(0),
  pageCount: z.number().int().min(1),
  /** Whether the printed value was found in the page's text layer; null for a page without one. */
  textLayerMatch: z.boolean().nullable(),
});
export type CellSource = z.infer<typeof CellSource>;

/** What an older filing printed for the same line and year, when it differs. */
export const Restated = z.object({
  documentId: Uuid,
  filingPeriodEnd: IsoDate.nullable(),
  pageIndex: z.number().int().min(0),
  value: DecimalString.nullable(),
  printed: z.string(),
});
export type Restated = z.infer<typeof Restated>;

export const FinancialCell = z.object({
  status: CellStatus,
  /** In the table's unit, or rupees a share on a per-share row. Null unless status is "value". */
  value: DecimalString.nullable(),
  printed: z.string().nullable(),
  factId: Uuid.nullable(),
  revisionId: Uuid.nullable(),
  source: CellSource.nullable(),
  check: CellCheck,
  restated: Restated.nullable(),
});
export type FinancialCell = z.infer<typeof FinancialCell>;

export const FinancialRow = z.object({
  /** Stable within its table: normalised section, label and occurrence. */
  key: z.string(),
  section: z.string(),
  label: z.string(),
  isSubtotal: z.boolean(),
  /** Earnings per share and the like: values are as printed, rupees a share. */
  perShare: z.boolean(),
  /** One cell per column, in column order. */
  cells: z.array(FinancialCell),
});
export type FinancialRow = z.infer<typeof FinancialRow>;

export const FinancialColumn = z.object({
  periodEnd: IsoDate,
  periodLabel: z.string(),
  /** The filing the whole column comes from. */
  documentId: Uuid,
  filingPeriodEnd: IsoDate.nullable(),
});
export type FinancialColumn = z.infer<typeof FinancialColumn>;

export const TableUnit = z.object({ label: z.string().nullable(), scale: DecimalString.nullable(), currency: z.string().nullable() });
export type TableUnit = z.infer<typeof TableUnit>;

export const StatementTable = z.object({
  statement: StatementKind,
  basis: ReportingBasis,
  unit: TableUnit,
  /** Oldest period first. */
  columns: z.array(FinancialColumn),
  rows: z.array(FinancialRow),
  /** Figures with no date to place them by. */
  unplaced: z.number().int().min(0),
  /** Filings left out of this table, and why. */
  leftOut: z.array(z.object({ documentId: Uuid, reason: z.enum(["other_currency", "other_unit"]) })),
});
export type StatementTable = z.infer<typeof StatementTable>;

export const CompanyFiling = z.object({
  documentId: Uuid,
  originalName: z.string(),
  kind: ClassificationKind.nullable(),
  periodEnd: IsoDate.nullable(),
  intakeState: IntakeState.nullable(),
  /** True when its figures are in the tables: a read annual report. */
  counted: z.boolean(),
});
export type CompanyFiling = z.infer<typeof CompanyFiling>;

export const CompanyFinancials = z.object({ company: Company, filings: z.array(CompanyFiling), tables: z.array(StatementTable) });
export type CompanyFinancials = z.infer<typeof CompanyFinancials>;

export const StockPoint = z.object({ day: IsoDate, value: z.number() });
export type StockPoint = z.infer<typeof StockPoint>;

export const CompanyStock = z.object({
  state: z.enum(["ok", "no_symbol", "not_connected", "not_tracked"]),
  symbol: z.string().nullable(),
  /** "Dhan · NSE close". */
  source: z.string().nullable(),
  last: StockPoint.nullable(),
  previous: StockPoint.nullable(),
  /** The close on or before the same day a year earlier. */
  yearAgo: StockPoint.nullable(),
  low: StockPoint.nullable(),
  high: StockPoint.nullable(),
  /** The last 365 days of closes, oldest first. */
  series: z.array(StockPoint),
});
export type CompanyStock = z.infer<typeof CompanyStock>;

export const ResearchCompany = z.object({
  company: Company,
  annualReportsRead: z.number().int().min(0),
  latestPeriodEnd: IsoDate.nullable(),
  /** Filings being identified or read now. */
  reading: z.number().int().min(0),
  /** Filings that couldn't be identified or read. */
  failed: z.number().int().min(0),
});
export type ResearchCompany = z.infer<typeof ResearchCompany>;

export const ResearchCompanies = z.object({ items: z.array(ResearchCompany) });
export type ResearchCompanies = z.infer<typeof ResearchCompanies>;
```

- [ ] **Step 4: Export it and run the checks.** Add `export * from "./research.js";` as the last line of `packages/contracts/src/index.ts`. Run `pnpm --filter @maester/contracts test && pnpm --filter @maester/contracts typecheck && pnpm --filter @maester/contracts lint`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(contracts): research financials, stock and company list`.

---

### Task 3: Stitch a company's years (pure)

**Files:**
- Create: `apps/api/src/financials/stitch.ts`
- Test: `apps/api/test/stitch.test.ts`

**Interfaces:**
- Consumes: `FactWithSource`, `ExtractionCheckRow` from `@maester/db`; `StatementTable`, `FinancialCell`, `CellCheck` from `@maester/contracts`.
- Produces (used by Task 5):

```ts
export type Filing = {
  documentId: string;
  /** The filing's own period end (its classification's): the newest filing is the latest. */
  periodEnd: string | null;
  revisionCreatedAt: Date;
  pageCount: number;
  facts: FactWithSource[];
  checks: ExtractionCheckRow[];
};
export function stitch(filings: Filing[]): StatementTable[];
export function normalise(text: string): string;
export function moveDecimal(value: string, places: number): string;
```

- [ ] **Step 1: Write the failing tests** `apps/api/test/stitch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ExtractionCheckRow, FactWithSource } from "@maester/db";
import { moveDecimal, normalise, stitch, type Filing } from "../src/financials/stitch.js";

const WS = "00000000-0000-4000-8000-000000000000";
type Kind = "income_statement" | "balance_sheet" | "cash_flow";
type Opts = {
  statement?: Kind; basis?: "consolidated" | "standalone"; section?: string; order?: number; subtotal?: boolean; parts?: string[];
  status?: "value" | "dash" | "unparsed"; scale?: string | null; currency?: string; page?: number; match?: boolean | null; dated?: boolean;
};
type Doc = { documentId: string; revisionId: string };

function fact(doc: Doc, label: string, periodEnd: string, printed: string, o: Opts = {}): FactWithSource {
  const scale = o.scale === undefined ? "10000000" : o.scale;
  const status = o.status ?? "value";
  const reported = status === "value" ? printed.replace(/,/g, "").replace(/^\((.*)\)$/, "-$1") : null;
  const statement = o.statement ?? "income_statement";
  const balance = statement === "balance_sheet";
  const dated = o.dated ?? true;
  const id = crypto.randomUUID();
  return {
    fact: {
      id, workspaceId: WS, revisionId: doc.revisionId, companyId: null, statement, basis: o.basis ?? "consolidated",
      section: o.section ?? "Income", lineOrder: o.order ?? 0, reportedLabel: label, isSubtotal: o.subtotal ?? false,
      componentLabels: o.parts ?? [], periodLabel: `Year ended ${periodEnd}`,
      periodEnd: dated && !balance ? periodEnd : null, asOfDate: dated && balance ? periodEnd : null,
      reportedText: printed, reportedValue: reported, valueStatus: status, unitLabel: "₹ in crore", scaleFactor: scale,
      currency: o.currency ?? "INR",
      normalizedValue: reported === null || scale === null ? null : moveDecimal(reported, scale.length - 1),
      createdAt: new Date(),
    },
    source: { id: crypto.randomUUID(), workspaceId: WS, factId: id, documentId: doc.documentId, pageIndex: (o.page ?? 213) - 1, textLayerMatch: o.match === undefined ? true : o.match },
  };
}

function check(doc: Doc, subject: string, periodEnd: string, status: "passed" | "failed", expected: string, actual: string, o: { statement?: Kind; section?: string } = {}): ExtractionCheckRow {
  return {
    id: crypto.randomUUID(), workspaceId: WS, revisionId: doc.revisionId, checkType: "subtotal", statement: o.statement ?? "income_statement",
    basis: "consolidated", section: o.section ?? "Income", periodLabel: `Year ended ${periodEnd}`, subjectLabel: subject, status, expected, actual, detail: "",
  };
}

function filing(periodEnd: string, build: (d: Doc) => { facts: FactWithSource[]; checks?: ExtractionCheckRow[] }, created = "2026-10-01T00:00:00Z"): Filing {
  const doc = { documentId: crypto.randomUUID(), revisionId: crypto.randomUUID() };
  const { facts, checks = [] } = build(doc);
  return { documentId: doc.documentId, periodEnd, revisionCreatedAt: new Date(created), pageCount: 286, facts, checks };
}

const pl = (tables: ReturnType<typeof stitch>, basis = "consolidated") =>
  tables.find((t) => t.statement === "income_statement" && t.basis === basis)!;
const row = (t: ReturnType<typeof pl>, label: string, n = 0) => t.rows.filter((r) => r.label === label)[n]!;

describe("moveDecimal", () => {
  it("moves the point exactly, both ways", () => {
    expect(moveDecimal("121054000000", -7)).toBe("12105.4");
    expect(moveDecimal("12105.40", 0)).toBe("12105.4");
    expect(moveDecimal("-12.40", 7)).toBe("-124000000");
    expect(moveDecimal("0.05", -2)).toBe("0.0005");
    expect(moveDecimal("-0.00", 0)).toBe("0");
  });
});

describe("normalise", () => {
  it("ignores case, punctuation, & and spacing", () => {
    expect(normalise("Depreciation & Amortisation  expense.")).toBe(normalise("depreciation and amortisation expense"));
  });
});

describe("stitch", () => {
  it("takes each year whole from the newest filing that prints it, oldest year first", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2025-03-31", "11,240.75", { page: 198 }), fact(d, "Revenue from operations", "2024-03-31", "10,312.80", { page: 198 })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40"), fact(d, "Revenue from operations", "2025-03-31", "11,240.75")] }));
    const t = pl(stitch([ar25, ar26]));
    expect(t.columns.map((c) => c.periodEnd)).toEqual(["2024-03-31", "2025-03-31", "2026-03-31"]);
    expect(t.columns.map((c) => c.documentId)).toEqual([ar25.documentId, ar26.documentId, ar26.documentId]);
    expect(row(t, "Revenue from operations").cells.map((c) => c.value)).toEqual(["10312.8", "11240.75", "12105.4"]);
    expect(row(t, "Revenue from operations").cells[2]!.source).toEqual({ documentId: ar26.documentId, pageIndex: 212, pageCount: 286, textLayerMatch: true });
  });

  it("marks a figure restated when an older filing printed something else for that year", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2025-03-31", "2,389.10", { page: 198 })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2026-03-31", "2,602.15"), fact(d, "Freight and forwarding", "2025-03-31", "2,401.60")] }));
    const cells = row(pl(stitch([ar26, ar25])), "Freight and forwarding").cells;
    expect(cells[0]!.value).toBe("2401.6");
    expect(cells[0]!.restated).toEqual({ documentId: ar25.documentId, filingPeriodEnd: "2025-03-31", pageIndex: 197, value: "2389.1", printed: "2,389.10" });
    expect(cells[1]!.restated).toBeNull();
  });

  it("doesn't mark a figure restated when the older filing printed the same", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Other income", "2025-03-31", "312.25")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Other income", "2025-03-31", "312.250")] }));
    expect(row(pl(stitch([ar25, ar26])), "Other income").cells[0]!.restated).toBeNull();
  });

  it("matches lines by printed name, ignoring case, punctuation and &", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Depreciation & amortisation expense", "2025-03-31", "742.80")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Depreciation and Amortisation Expense.", "2026-03-31", "806.25")] }));
    const t = pl(stitch([ar25, ar26]));
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.label).toBe("Depreciation and Amortisation Expense.");
  });

  it("keeps a renamed line as two rows, each missing where the other is printed", () => {
    const ar23 = filing("2023-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding expenses", "2023-03-31", "2,040.10")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2026-03-31", "2,602.15")] }));
    const t = pl(stitch([ar23, ar26]));
    expect(row(t, "Freight and forwarding").cells.map((c) => c.status)).toEqual(["missing", "value"]);
    expect(row(t, "Freight and forwarding expenses").cells.map((c) => c.status)).toEqual(["value", "missing"]);
    expect(row(t, "Freight and forwarding").cells[0]!.value).toBeNull();
  });

  it("orders rows by the newest filing and puts an older-only row after the row before it", () => {
    const ar23 = filing("2023-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2023-03-31", "9,605.25", { order: 0 }),
      fact(d, "Excise duty", "2023-03-31", "120.00", { order: 1 }),
      fact(d, "Other income", "2023-03-31", "244.75", { order: 2 }),
    ] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2026-03-31", "12,105.40", { order: 0 }),
      fact(d, "Other income", "2026-03-31", "374.60", { order: 1 }),
    ] }));
    expect(pl(stitch([ar23, ar26])).rows.map((r) => r.label)).toEqual(["Revenue from operations", "Excise duty", "Other income"]);
  });

  it("keeps lines with the same name apart by section and occurrence", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Borrowings", "2026-03-31", "2,410.80", { statement: "balance_sheet", section: "Non-current liabilities", order: 0 }),
      fact(d, "Borrowings", "2026-03-31", "312.45", { statement: "balance_sheet", section: "Current liabilities", order: 1 }),
      fact(d, "Others", "2026-03-31", "10.00", { statement: "balance_sheet", section: "Current liabilities", order: 2 }),
      fact(d, "Others", "2026-03-31", "20.00", { statement: "balance_sheet", section: "Current liabilities", order: 3 }),
    ] }));
    const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
    expect(bs.rows.map((r) => r.cells[0]!.value)).toEqual(["2410.8", "312.45", "10", "20"]);
    expect(new Set(bs.rows.map((r) => r.key)).size).toBe(4);
  });

  it("converts an older filing's lakh to the table's crore", () => {
    const ar23 = filing("2023-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2023-03-31", "9,60,525.00", { scale: "100000" })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40")] }));
    const t = pl(stitch([ar23, ar26]));
    expect(t.unit).toEqual({ label: "₹ in crore", scale: "10000000", currency: "INR" });
    expect(row(t, "Revenue from operations").cells[0]!.value).toBe("9605.25");
  });

  it("reads a per-share line as printed, not scaled by the statement's unit", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [fact(d, "Basic", "2026-03-31", "61.98", { section: "Earnings per equity share (face value ₹10)" })] }));
    const r = row(pl(stitch([ar])), "Basic");
    expect(r.perShare).toBe(true);
    expect(r.cells[0]!.value).toBe("61.98");
  });

  it("leaves out a filing in another currency, and one whose unit can't be converted", () => {
    const usd = filing("2025-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2025-03-31", "1,350.00", { currency: "USD", scale: "1000000" })] }));
    const odd = filing("2024-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2024-03-31", "10.00", { scale: null })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40")] }));
    const t = pl(stitch([usd, odd, ar26]));
    expect(t.columns.map((c) => c.periodEnd)).toEqual(["2026-03-31"]);
    expect(t.leftOut).toEqual([
      { documentId: usd.documentId, reason: "other_currency" },
      { documentId: odd.documentId, reason: "other_unit" },
    ]);
  });

  it("counts figures with no date and leaves them out", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40"), fact(d, "Other income", "2026-03-31", "374.60", { dated: false })] }));
    const t = pl(stitch([ar]));
    expect(t.unplaced).toBe(1);
    expect(t.rows.map((r) => r.label)).toEqual(["Revenue from operations"]);
  });

  it("gives a subtotal its check, and each of its lines the subtotal's check", () => {
    const ar = filing("2026-03-31", (d) => ({
      facts: [
        fact(d, "Revenue from operations", "2026-03-31", "12,105.40", { order: 0 }),
        fact(d, "Other income", "2026-03-31", "374.60", { order: 1 }),
        fact(d, "Total income", "2026-03-31", "12,480.00", { order: 2, subtotal: true, parts: ["Revenue from operations", "Other income"] }),
        fact(d, "Exceptional items", "2026-03-31", "-", { order: 3, status: "dash" }),
      ],
      checks: [check(d, "Total income", "2026-03-31", "failed", "12480.00", "12489.00")],
    }));
    const t = pl(stitch([ar]));
    expect(row(t, "Total income").cells[0]!.check).toEqual({ role: "subject", status: "failed", subjectLabel: "Total income", expected: "12480", actual: "12489" });
    expect(row(t, "Other income").cells[0]!.check).toEqual({ role: "component", status: "failed", subjectLabel: "Total income", expected: "12480", actual: "12489" });
    expect(row(t, "Exceptional items").cells[0]!.check).toEqual({ role: "none", status: null, subjectLabel: null, expected: null, actual: null });
  });

  it("matches a check to its subtotal by section when two subtotals share a name", () => {
    const ar = filing("2026-03-31", (d) => ({
      facts: [
        fact(d, "Total", "2026-03-31", "13,288.00", { statement: "balance_sheet", section: "Non-current assets", subtotal: true, order: 0 }),
        fact(d, "Total", "2026-03-31", "4,292.00", { statement: "balance_sheet", section: "Current assets", subtotal: true, order: 1 }),
      ],
      checks: [
        check(d, "Total", "2026-03-31", "passed", "13288.00", "13288.00", { statement: "balance_sheet", section: "Non-current assets" }),
        check(d, "Total", "2026-03-31", "failed", "4300.00", "4292.00", { statement: "balance_sheet", section: "Current assets" }),
      ],
    }));
    const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
    expect(bs.rows.map((r) => r.cells[0]!.check.status)).toEqual(["passed", "failed"]);
  });

  it("keeps a printed dash and an unreadable figure apart from a missing one", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Exceptional items", "2026-03-31", "-", { status: "dash" }),
      fact(d, "Other comprehensive income", "2026-03-31", "(12,4O)", { status: "unparsed", order: 1 }),
    ] }));
    const t = pl(stitch([ar]));
    expect(row(t, "Exceptional items").cells[0]).toMatchObject({ status: "dash", value: null, printed: "-" });
    expect(row(t, "Other comprehensive income").cells[0]).toMatchObject({ status: "unparsed", value: null, printed: "(12,4O)" });
  });

  it("keeps one table per statement and basis that has figures", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2026-03-31", "12,105.40"),
      fact(d, "Revenue from operations", "2026-03-31", "11,482.20", { basis: "standalone" }),
      fact(d, "Total assets", "2026-03-31", "17,580.00", { statement: "balance_sheet" }),
    ] }));
    expect(stitch([ar]).map((t) => `${t.statement}/${t.basis}`)).toEqual(["income_statement/consolidated", "income_statement/standalone", "balance_sheet/consolidated"]);
  });
});
```

- [ ] **Step 2: Run them.** `pnpm --filter @maester/api test -- stitch`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `apps/api/src/financials/stitch.ts`.**

```ts
import type { CellCheck, FinancialCell, FinancialColumn, FinancialRow, StatementTable } from "@maester/contracts";
import type { ExtractionCheckRow, FactWithSource } from "@maester/db";

/**
 * Puts a company's years together from the facts of its read annual reports
 * (docs/superpowers/specs/2026-10-13-company-financials-design.md, "The table").
 * Each column comes whole from the newest filing that prints its period, so every column
 * adds up; an older filing that printed a different figure for the same line and year marks
 * the cell restated. Lines match across filings by printed name. Pure: no database.
 */

export type Filing = {
  documentId: string;
  /** The filing's own period end (its classification's): the newest filing is the latest. */
  periodEnd: string | null;
  revisionCreatedAt: Date;
  pageCount: number;
  facts: FactWithSource[];
  checks: ExtractionCheckRow[];
};

const STATEMENTS = ["income_statement", "balance_sheet", "cash_flow"] as const;
const BASES = ["consolidated", "standalone", "unknown"] as const;
const PER_SHARE = /earnings per (equity )?share|\beps\b/;

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Moves the decimal point `places` to the right (negative: to the left). Exact; trims trailing zeros. */
export function moveDecimal(value: string, places: number): string {
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

/** The exponent of a power-of-ten scale ("10000000" → 7); null for anything else. */
function exponent(scale: string | null): number | null {
  if (scale === null) return null;
  const m = /^1(0*)(?:\.0*)?$/.exec(scale);
  return m ? m[1]!.length : null;
}

function newestFirst(a: Filing, b: Filing): number {
  const pa = a.periodEnd ?? "";
  const pb = b.periodEnd ?? "";
  if (pa !== pb) return pa < pb ? 1 : -1;
  return b.revisionCreatedAt.getTime() - a.revisionCreatedAt.getTime();
}

const dateOf = (f: FactWithSource) => f.fact.periodEnd ?? f.fact.asOfDate;
const perShare = (f: FactWithSource) => PER_SHARE.test(normalise(f.fact.section)) || PER_SHARE.test(normalise(f.fact.reportedLabel));

type Unit = { label: string | null; scale: string | null; currency: string | null };

/** How to bring a filing's figures into the table's unit, or why it can't. */
function converter(facts: FactWithSource[], unit: Unit): { move: number | null; reason: "other_currency" | "other_unit" | null } {
  const plain = facts.filter((f) => !perShare(f));
  const currency = plain.find((f) => f.fact.currency)?.fact.currency ?? null;
  if (currency && unit.currency && currency !== unit.currency) return { move: null, reason: "other_currency" };
  // A filing with no unit (scale null) is not "the same unit" as a table that has one.
  const scale = plain.length > 0 ? plain[0]!.fact.scaleFactor : unit.scale;
  if (scale === unit.scale) return { move: 0, reason: null };
  const from = exponent(scale);
  const to = exponent(unit.scale);
  if (from === null || to === null) return { move: null, reason: "other_unit" };
  return { move: from - to, reason: null };
}

const NO_CHECK: CellCheck = { role: "none", status: null, subjectLabel: null, expected: null, actual: null };

type Placed = { filing: Filing; move: number; byKey: Map<string, FactWithSource>; keys: string[] };

function keyed(facts: FactWithSource[]): { byKey: Map<string, FactWithSource>; keys: string[] } {
  const seen = new Map<string, number>();
  const byKey = new Map<string, FactWithSource>();
  const keys: string[] = [];
  for (const f of [...facts].sort((a, b) => a.fact.lineOrder - b.fact.lineOrder)) {
    const base = `${normalise(f.fact.section)}|${normalise(f.fact.reportedLabel)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = `${base}|${n}`;
    byKey.set(key, f);
    keys.push(key);
  }
  return { byKey, keys };
}

function checkFor(f: FactWithSource, filing: Filing, siblings: FactWithSource[], move: number): CellCheck {
  // A check names its section when it has one: two subtotals called "Total" are told apart by it.
  const index = (subject: string, section: string) =>
    filing.checks.find(
      (c) =>
        c.statement === f.fact.statement &&
        c.basis === f.fact.basis &&
        (c.section === null || normalise(c.section) === normalise(section)) &&
        normalise(c.periodLabel) === normalise(f.fact.periodLabel) &&
        normalise(c.subjectLabel) === normalise(subject),
    );
  const rescale = (v: string | null) => (v === null ? null : moveDecimal(v, move));
  const own = index(f.fact.reportedLabel, f.fact.section);
  if (own) return { role: "subject", status: own.status, subjectLabel: own.subjectLabel, expected: rescale(own.expected), actual: rescale(own.actual) };
  const label = normalise(f.fact.reportedLabel);
  const parent = siblings.find(
    (s) => s.fact.isSubtotal && normalise(s.fact.section) === normalise(f.fact.section) && s.fact.componentLabels.some((l) => normalise(l) === label),
  );
  const theirs = parent ? index(parent.fact.reportedLabel, parent.fact.section) : undefined;
  if (parent && theirs) {
    return { role: "component", status: theirs.status, subjectLabel: parent.fact.reportedLabel, expected: rescale(theirs.expected), actual: rescale(theirs.actual) };
  }
  return NO_CHECK;
}

function valueOf(f: FactWithSource, move: number, unit: Unit): string | null {
  if (f.fact.valueStatus !== "value" || f.fact.reportedValue === null) return null;
  if (perShare(f)) return moveDecimal(f.fact.reportedValue, 0);
  if (move === 0) return moveDecimal(f.fact.reportedValue, 0);
  const to = exponent(unit.scale);
  if (f.fact.normalizedValue !== null && to !== null) return moveDecimal(f.fact.normalizedValue, -to);
  return null;
}

function cellOf(f: FactWithSource, placed: Placed, unit: Unit, siblings: FactWithSource[]): FinancialCell {
  return {
    status: f.fact.valueStatus,
    value: valueOf(f, placed.move, unit),
    printed: f.fact.reportedText,
    factId: f.fact.id,
    revisionId: f.fact.revisionId,
    source: { documentId: f.source.documentId, pageIndex: f.source.pageIndex, pageCount: placed.filing.pageCount, textLayerMatch: f.source.textLayerMatch },
    check: checkFor(f, placed.filing, siblings, placed.move),
    restated: null,
  };
}

const MISSING: FinancialCell = { status: "missing", value: null, printed: null, factId: null, revisionId: null, source: null, check: NO_CHECK, restated: null };

function stitchOne(ordered: Filing[], statement: (typeof STATEMENTS)[number], basis: (typeof BASES)[number]): StatementTable | null {
  const mine = ordered
    .map((filing) => ({ filing, facts: filing.facts.filter((f) => f.fact.statement === statement && f.fact.basis === basis) }))
    .filter((x) => x.facts.length > 0);
  if (mine.length === 0) return null;

  const head = mine[0]!.facts.find((f) => !perShare(f)) ?? mine[0]!.facts[0]!;
  const unit: Unit = { label: head.fact.unitLabel, scale: head.fact.scaleFactor, currency: head.fact.currency };

  let unplaced = 0;
  const leftOut: StatementTable["leftOut"] = [];
  /** period → filings that print it, newest first. */
  const byPeriod = new Map<string, Placed[]>();
  for (const { filing, facts } of mine) {
    const { move, reason } = converter(facts, unit);
    if (move === null) {
      leftOut.push({ documentId: filing.documentId, reason: reason! });
      continue;
    }
    const groups = new Map<string, FactWithSource[]>();
    for (const f of facts) {
      const day = dateOf(f);
      if (!day) {
        unplaced++;
        continue;
      }
      groups.set(day, [...(groups.get(day) ?? []), f]);
    }
    for (const [day, group] of groups) {
      const placed = byPeriod.get(day) ?? [];
      placed.push({ filing, move, ...keyed(group) });
      byPeriod.set(day, placed);
    }
  }
  if (byPeriod.size === 0) return null;

  const periods = [...byPeriod.keys()].sort();
  const owners = periods.map((p) => byPeriod.get(p)![0]!);

  // Rows: the newest owner's order first; an older-only key goes in after the key before it.
  const order: string[] = [];
  const meta = new Map<string, { section: string; label: string; isSubtotal: boolean; perShare: boolean }>();
  for (const owner of [...owners].reverse()) {
    let after = -1;
    for (const key of owner.keys) {
      const at = order.indexOf(key);
      if (at >= 0) {
        after = at;
        continue;
      }
      order.splice(after + 1, 0, key);
      after += 1;
      const f = owner.byKey.get(key)!;
      meta.set(key, { section: f.fact.section, label: f.fact.reportedLabel, isSubtotal: f.fact.isSubtotal, perShare: perShare(f) });
    }
  }

  const columns: FinancialColumn[] = owners.map((owner, i) => {
    const any = owner.byKey.values().next().value!;
    return { periodEnd: periods[i]!, periodLabel: any.fact.periodLabel, documentId: owner.filing.documentId, filingPeriodEnd: owner.filing.periodEnd };
  });

  const rows: FinancialRow[] = order.map((key) => {
    const m = meta.get(key)!;
    const cells = periods.map((period, i) => {
      const owner = owners[i]!;
      const f = owner.byKey.get(key);
      if (!f) return MISSING;
      const cell = cellOf(f, owner, unit, [...owner.byKey.values()]);
      for (const other of byPeriod.get(period)!.slice(1)) {
        const g = other.byKey.get(key);
        if (!g) continue;
        const theirs = valueOf(g, other.move, unit);
        if (g.fact.valueStatus !== f.fact.valueStatus || theirs !== cell.value) {
          cell.restated = { documentId: other.filing.documentId, filingPeriodEnd: other.filing.periodEnd, pageIndex: g.source.pageIndex, value: theirs, printed: g.fact.reportedText };
        }
        break;
      }
      return cell;
    });
    return { key, section: m.section, label: m.label, isSubtotal: m.isSubtotal, perShare: m.perShare, cells };
  });

  return { statement, basis, unit, columns, rows, unplaced, leftOut };
}

export function stitch(filings: Filing[]): StatementTable[] {
  const ordered = [...filings].sort(newestFirst);
  const tables: StatementTable[] = [];
  for (const statement of STATEMENTS) {
    for (const basis of BASES) {
      const table = stitchOne(ordered, statement, basis);
      if (table) tables.push(table);
    }
  }
  return tables;
}
```

Notes for the implementer:
- `restated` compares with the newest *other* filing that prints the same line and year; `break` after the first one found.
- `ExtractionCheckRow.status` is `"passed" | "failed" | "not_checked"`, which matches `CellCheck.status`.
- The "lakh" test: `normalizedValue` of "9,60,525.00" at scale 10^5 is "96052500000"; moved by −7 it is "9605.25".

- [ ] **Step 4: Run the tests.** `pnpm --filter @maester/api test -- stitch`. Expected: PASS. Then `pnpm --filter @maester/api typecheck && pnpm --filter @maester/api lint`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(api): stitch a company's years from its annual reports`.

---

### Task 4: Summarise a share's closes (pure)

**Files:**
- Create: `apps/api/src/financials/stock.ts`
- Test: `apps/api/test/stock.test.ts`

**Interfaces:**
- Consumes: `MarketPointRow` from `@maester/db`; `CompanyStock` from `@maester/contracts`.
- Produces (used by Task 5): `export function stockFrom(symbol: string, points: { day: string; value: number; source: string }[]): CompanyStock;` and `export function minusDays(day: string, n: number): string;`

- [ ] **Step 1: Write the failing tests** `apps/api/test/stock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { minusDays, stockFrom } from "../src/financials/stock.js";

const SRC = "Dhan · NSE close";
/** One close a day from `from` for `days` days, with the given values by index. */
function closes(from: string, days: number, value: (i: number) => number) {
  return Array.from({ length: days }, (_, i) => ({ day: minusDays(from, -i), value: value(i), source: SRC }));
}

describe("minusDays", () => {
  it("counts calendar days", () => {
    expect(minusDays("2026-10-10", 365)).toBe("2025-10-10");
    expect(minusDays("2026-03-01", 1)).toBe("2026-02-28");
  });
});

describe("stockFrom", () => {
  it("gives the last close, the one before, a year earlier, and the year's low and high", () => {
    const points = closes("2025-09-01", 405, (i) => 1000 + i);
    points[200]!.value = 900;
    const s = stockFrom("SYNCEM", points);
    const last = points.at(-1)!;
    expect(s.state).toBe("ok");
    expect(s.last).toEqual({ day: last.day, value: last.value });
    expect(s.previous).toEqual({ day: points.at(-2)!.day, value: points.at(-2)!.value });
    expect(s.yearAgo!.day).toBe(minusDays(last.day, 365));
    expect(s.low).toEqual({ day: points[200]!.day, value: 900 });
    expect(s.high).toEqual({ day: last.day, value: last.value });
    expect(s.series[0]!.day > minusDays(last.day, 365)).toBe(true);
    expect(s.series.at(-1)!.day).toBe(last.day);
    expect(s.source).toBe(SRC);
  });

  it("has no close a year earlier when the closes start later than that", () => {
    const s = stockFrom("NEWCO", closes("2026-06-01", 60, () => 500));
    expect(s.yearAgo).toBeNull();
    expect(s.series).toHaveLength(60);
  });

  it("has no close before a single day", () => {
    const s = stockFrom("ONE", closes("2026-10-10", 1, () => 500));
    expect(s.previous).toBeNull();
    expect(s.low).toEqual({ day: "2026-10-10", value: 500 });
  });
});
```

- [ ] **Step 2: Run them.** `pnpm --filter @maester/api test -- stock`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `apps/api/src/financials/stock.ts`.**

```ts
import type { CompanyStock, StockPoint } from "@maester/contracts";

/** A share's NSE closes summarised for the Research summary. Pure: the route reads the points. */

const DAY = 86_400_000;
/** A close more than this many days before the year-ago day is too old to compare with. */
const YEAR_AGO_SLACK = 10;

export function minusDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
}

export function stockFrom(symbol: string, points: { day: string; value: number; source: string }[]): CompanyStock {
  const last = points.at(-1);
  if (!last) return { state: "not_tracked", symbol, source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] };
  const point = (p: { day: string; value: number }): StockPoint => ({ day: p.day, value: p.value });
  const yearBefore = minusDays(last.day, 365);
  const earlier = [...points].reverse().find((p) => p.day <= yearBefore);
  const yearAgo = earlier && earlier.day >= minusDays(yearBefore, YEAR_AGO_SLACK) ? point(earlier) : null;
  const series = points.filter((p) => p.day > yearBefore).map(point);
  let low = series[0]!;
  let high = series[0]!;
  for (const p of series) {
    if (p.value < low.value) low = p;
    if (p.value > high.value) high = p;
  }
  const previous = points.at(-2);
  return { state: "ok", symbol, source: last.source, last: point(last), previous: previous ? point(previous) : null, yearAgo, low, high, series };
}
```

- [ ] **Step 4: Run the checks.** `pnpm --filter @maester/api test -- stock && pnpm --filter @maester/api typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(api): summarise a share's closes for research`.

---

### Task 5: Research queries and routes

**Files:**
- Create: `packages/db/src/queries/research.ts`
- Modify: `packages/db/src/index.ts` (export the new queries)
- Test: `packages/db/test/research.test.ts`
- Create: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/app.ts` (mount), `apps/api/src/routes/documents.ts` (the file redirect)
- Test: `apps/api/test/research.test.ts`

**Interfaces:**
- Consumes: `stitch`, `Filing` (Task 3); `stockFrom`, `minusDays` (Task 4); `getCurrentRevision`, `getCompany`, `listCompanies`, `latestMarketDay`, `listMarketSeries`, `getConnection` from `@maester/db`.
- Produces:
  - `packages/db`: `listCompanyFilings(db, workspaceId, companyId?): Promise<CompanyFilingRow[]>`, `listFactsWithSourcesForRevisions(db, workspaceId, revisionIds): Promise<FactWithSource[]>`, `listChecksForRevisions(db, workspaceId, revisionIds): Promise<ExtractionCheckRow[]>`, `type CompanyFilingRow = { documentId: string; companyId: string; originalName: string; intakeState: IntakeStateValue | null; kind: ClassificationKindValue | null; periodEnd: string | null; createdAt: Date }`.
  - HTTP (all under `/v1/workspaces/:ws`, session and workspace required):
    - `GET /research/companies` → `ResearchCompanies`
    - `GET /companies/:id/financials` → `CompanyFinancials` (404 `NOT_FOUND` "company not found")
    - `GET /companies/:id/stock` → `CompanyStock` (404 as above)
    - `GET /documents/:id/file` → 302 to a signed URL, `Cache-Control: no-store` (404 not found; 409 `INVALID_STATE` when not stored)

- [ ] **Step 1: Write the failing query tests** `packages/db/test/research.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { ensurePersonalWorkspace } from "../src/queries/workspaces.js";
import { listChecksForRevisions, listCompanyFilings, listFactsWithSourcesForRevisions } from "../src/queries/research.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function setup() {
  await insertUser(db, "u1", "u1@example.com");
  const ws = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
  const company = crypto.randomUUID();
  await db.insert(schema.company).values({ id: company, workspaceId: ws.id, displayName: "Synthetic Cements Limited", country: "IN", createdByUserId: "u1" });
  return { ws: ws.id, company };
}

async function doc(ws: string, companyId: string | null, name: string, intakeState: "read" | "kept" | null = "read") {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId: ws, companyId, originalName: name, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${id}/original.pdf`, state: "stored", intakeState, createdByUserId: "u1",
  });
  return id;
}

describe("listCompanyFilings", () => {
  it("lists a company's documents with their current classification", async () => {
    const { ws, company } = await setup();
    const a = await doc(ws, company, "ar-2025-26.pdf");
    await doc(ws, null, "loose.pdf");
    await db.insert(schema.documentClassification).values({ id: crypto.randomUUID(), workspaceId: ws, documentId: a, kind: "other", setBy: "maester", createdAt: new Date("2026-10-01T00:00:00Z") });
    await db.insert(schema.documentClassification).values({ id: crypto.randomUUID(), workspaceId: ws, documentId: a, kind: "annual_report", periodEnd: "2026-03-31", setBy: "investor", createdAt: new Date("2026-10-02T00:00:00Z") });
    const rows = await listCompanyFilings(db, ws, company);
    expect(rows).toEqual([expect.objectContaining({ documentId: a, companyId: company, originalName: "ar-2025-26.pdf", intakeState: "read", kind: "annual_report", periodEnd: "2026-03-31" })]);
    expect(await listCompanyFilings(db, ws)).toHaveLength(1);
  });

  it("returns a document never classified with no kind", async () => {
    const { ws, company } = await setup();
    await doc(ws, company, "old.pdf", null);
    expect(await listCompanyFilings(db, ws, company)).toEqual([expect.objectContaining({ kind: null, periodEnd: null, intakeState: null })]);
  });
});

describe("facts and checks for several revisions", () => {
  it("returns nothing for no revisions", async () => {
    const { ws } = await setup();
    expect(await listFactsWithSourcesForRevisions(db, ws, [])).toEqual([]);
    expect(await listChecksForRevisions(db, ws, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them.** `pnpm db:up && pnpm --filter @maester/db test -- research`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `packages/db/src/queries/research.ts`.**

```ts
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { documentClassification } from "../schema/classification.js";
import { extractionCheck, financialFact, sourceReference, type ExtractionCheckRow } from "../schema/extraction.js";
import { document } from "../schema/platform.js";
import type { FactWithSource } from "./extraction.js";

export type CompanyFilingRow = {
  documentId: string;
  companyId: string;
  originalName: string;
  intakeState: (typeof document.$inferSelect)["intakeState"];
  kind: (typeof documentClassification.$inferSelect)["kind"] | null;
  periodEnd: string | null;
  createdAt: Date;
};

/**
 * Documents filed under a company (all companies when `companyId` is left out), newest first,
 * each with its current classification's kind and period. The company is the document's own
 * `company_id`: a fact's copy of it is only what it was when the fact was read.
 */
export async function listCompanyFilings(db: Db, workspaceId: string, companyId?: string): Promise<CompanyFilingRow[]> {
  const docs = await db
    .select()
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), companyId ? eq(document.companyId, companyId) : isNotNull(document.companyId)))
    .orderBy(desc(document.createdAt), desc(document.id));
  if (docs.length === 0) return [];
  const classifications = await db
    .select({ documentId: documentClassification.documentId, kind: documentClassification.kind, periodEnd: documentClassification.periodEnd })
    .from(documentClassification)
    .where(and(eq(documentClassification.workspaceId, workspaceId), inArray(documentClassification.documentId, docs.map((d) => d.id))))
    .orderBy(desc(documentClassification.createdAt), desc(documentClassification.id));
  const current = new Map<string, (typeof classifications)[number]>();
  for (const c of classifications) if (!current.has(c.documentId)) current.set(c.documentId, c);
  return docs.map((d) => ({
    documentId: d.id,
    companyId: d.companyId!,
    originalName: d.originalName,
    intakeState: d.intakeState,
    kind: current.get(d.id)?.kind ?? null,
    periodEnd: current.get(d.id)?.periodEnd ?? null,
    createdAt: d.createdAt,
  }));
}

/** Facts of several revisions, each with its source, in statement order. */
export async function listFactsWithSourcesForRevisions(db: Db, workspaceId: string, revisionIds: string[]): Promise<FactWithSource[]> {
  if (revisionIds.length === 0) return [];
  return db
    .select({ fact: financialFact, source: sourceReference })
    .from(financialFact)
    .innerJoin(sourceReference, eq(sourceReference.factId, financialFact.id))
    .where(and(eq(financialFact.workspaceId, workspaceId), inArray(financialFact.revisionId, revisionIds)))
    .orderBy(asc(financialFact.revisionId), asc(financialFact.statement), asc(financialFact.basis), asc(financialFact.lineOrder), asc(financialFact.id));
}

export async function listChecksForRevisions(db: Db, workspaceId: string, revisionIds: string[]): Promise<ExtractionCheckRow[]> {
  if (revisionIds.length === 0) return [];
  return db
    .select()
    .from(extractionCheck)
    .where(and(eq(extractionCheck.workspaceId, workspaceId), inArray(extractionCheck.revisionId, revisionIds)));
}
```

Add to `packages/db/src/index.ts`, after the extraction export line:

```ts
export { listCompanyFilings, listFactsWithSourcesForRevisions, listChecksForRevisions, type CompanyFilingRow } from "./queries/research.js";
```

If `periodEnd` comes back as a `Date` rather than a string (check `documentClassification.periodEnd`'s `date()` mode), declare the column read with `mode: "string"` behaviour by converting: `periodEnd: … ? String(…).slice(0, 10) : null`, and keep the test's string expectation.

- [ ] **Step 4: Run the query tests.** `pnpm --filter @maester/db test -- research && pnpm --filter @maester/db typecheck`. Expected: PASS.

- [ ] **Step 5: Write the failing route tests** `apps/api/test/research.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanyFinancials, CompanyStock, JobTypes, ResearchCompanies } from "@maester/contracts";
import { schema, upsertMarketPoints } from "@maester/db";
import { moveDecimal } from "../src/financials/stitch.js";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

type Line = { label: string; period: string; printed: string; page?: number; section?: string; order?: number };

/** A read annual report for a company: document, classification read under itself, revision, facts. */
async function seedFiling(ws: string, userId: string, companyId: string, periodEnd: string, lines: Line[], opts: { kind?: "annual_report" | "financial_results"; intakeState?: "read" | "kept" } = {}) {
  const documentId = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id: documentId, workspaceId: ws, companyId, originalName: `ar-${periodEnd}.pdf`, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${documentId}/original.pdf`, state: "stored", intakeState: opts.intakeState ?? "read", createdByUserId: userId,
  });
  const classificationId = crypto.randomUUID();
  await ctx.db.insert(schema.documentClassification).values({
    id: classificationId, workspaceId: ws, documentId, kind: opts.kind ?? "annual_report", periodEnd, periodLabel: `Year ended ${periodEnd}`,
    companyId, setBy: "maester", statementsFound: [],
  });
  await ctx.db.update(schema.documentClassification).set({ readsUnderId: classificationId }).where(eq(schema.documentClassification.id, classificationId));
  const jobId = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({ id: jobId, workspaceId: ws, type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: documentId, idempotencyKey: `seed-${jobId}`, state: "succeeded" });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId: ws, documentId, jobId, classificationId, state: "complete", pipelineVersion: "extract-1", model: "m", promptVersion: "p",
    pageCount: 286, companyNameAsPrinted: "Synthetic Cements Limited", coverage: { statements: [] },
  });
  for (const line of lines) {
    const factId = crypto.randomUUID();
    const reported = line.printed.replace(/,/g, "");
    await ctx.db.insert(schema.financialFact).values({
      id: factId, workspaceId: ws, revisionId, companyId, statement: "income_statement", basis: "consolidated", section: line.section ?? "Income",
      lineOrder: line.order ?? 0, reportedLabel: line.label, isSubtotal: false, componentLabels: [], periodLabel: `Year ended ${line.period}`,
      periodEnd: line.period, reportedText: line.printed, reportedValue: reported, valueStatus: "value", unitLabel: "₹ in crore",
      scaleFactor: "10000000", currency: "INR", normalizedValue: moveDecimal(reported, 7),
    });
    await ctx.db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId, pageIndex: (line.page ?? 213) - 1, textLayerMatch: true });
  }
  return documentId;
}

describe("GET /companies/:id/financials", () => {
  it("stitches the company's read annual reports, newest filing per year", async () => {
    const a = await ctx.signUp("fin-a@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const ar25 = await seedFiling(a.workspaceId, a.userId, company, "2025-03-31", [{ label: "Freight and forwarding", period: "2025-03-31", printed: "2,389.10", page: 198 }]);
    const ar26 = await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", [
      { label: "Freight and forwarding", period: "2026-03-31", printed: "2,602.15" },
      { label: "Freight and forwarding", period: "2025-03-31", printed: "2,401.60" },
    ]);
    await seedFiling(a.workspaceId, a.userId, company, "2026-06-30", [{ label: "Freight and forwarding", period: "2026-06-30", printed: "700.00" }], { kind: "financial_results" });
    await seedFiling(a.workspaceId, a.userId, company, "2024-03-31", [{ label: "Freight and forwarding", period: "2024-03-31", printed: "2,180.45" }], { intakeState: "kept" });

    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/financials`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    const body = CompanyFinancials.parse(await res.json());
    expect(body.filings).toHaveLength(4);
    expect(body.filings.filter((f) => f.counted).map((f) => f.documentId).sort()).toEqual([ar25, ar26].sort());
    const t = body.tables.find((x) => x.statement === "income_statement" && x.basis === "consolidated")!;
    expect(t.columns.map((c) => [c.periodEnd, c.documentId])).toEqual([["2025-03-31", ar26], ["2026-03-31", ar26]]);
    expect(t.rows[0]!.cells[0]).toMatchObject({ value: "2401.6", restated: { documentId: ar25, value: "2389.1", pageIndex: 197 } });
  });

  it("is not found in another workspace", async () => {
    const a = await ctx.signUp("fin-b@example.com");
    const b = await ctx.signUp("fin-c@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const res = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/companies/${company}/financials`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });

  it("has no tables when nothing is read", async () => {
    const a = await ctx.signUp("fin-d@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const body = CompanyFinancials.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/financials`, { headers: { cookie: a.cookie } })).json());
    expect(body.tables).toEqual([]);
    expect(body.filings).toEqual([]);
  });
});

describe("GET /research/companies", () => {
  it("counts each company's read annual reports and its latest year", async () => {
    const a = await ctx.signUp("list-a@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const empty = await ctx.createCompany(a.workspaceId, a.cookie, "Harbour Cements Limited");
    await seedFiling(a.workspaceId, a.userId, company, "2025-03-31", []);
    await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", []);
    const body = ResearchCompanies.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/research/companies`, { headers: { cookie: a.cookie } })).json());
    expect(body.items.map((i) => [i.company.displayName, i.annualReportsRead, i.latestPeriodEnd])).toEqual([
      ["Harbour Cements Limited", 0, null],
      ["Synthetic Cements Limited", 2, "2026-03-31"],
    ]);
    expect(body.items.find((i) => i.company.id === empty)!.reading).toBe(0);
  });
});

describe("GET /companies/:id/stock", () => {
  async function companyWith(email: string, symbol: string | null) {
    const a = await ctx.signUp(email);
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    if (symbol) await ctx.db.update(schema.company).set({ nseSymbol: symbol }).where(eq(schema.company.id, company));
    const read = async () => CompanyStock.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/stock`, { headers: { cookie: a.cookie } })).json());
    return { read };
  }

  it("says there's no symbol", async () => {
    expect((await (await companyWith("stock-a@example.com", null)).read()).state).toBe("no_symbol");
  });

  it("says Dhan isn't connected when there are no closes and no connection", async () => {
    expect((await (await companyWith("stock-b@example.com", "NOCLOSE")).read()).state).toBe("not_connected");
  });

  it("says the share isn't tracked when Dhan is connected but there are no closes", async () => {
    await ctx.db.insert(schema.marketConnection).values({ provider: "dhan", clientId: "1000000001", secretCiphertext: "x", secretLast4: "9f3c", checkedAt: new Date() }).onConflictDoNothing();
    expect((await (await companyWith("stock-c@example.com", "NOTN500")).read()).state).toBe("not_tracked");
  });

  it("summarises the stored closes", async () => {
    await upsertMarketPoints(ctx.db, [
      { series: "eq:SYNCEM", day: "2026-10-09", value: 1272.2, source: "Dhan · NSE close" },
      { series: "eq:SYNCEM", day: "2026-10-10", value: 1284.5, source: "Dhan · NSE close" },
    ]);
    const s = await (await companyWith("stock-d@example.com", "SYNCEM")).read();
    expect(s).toMatchObject({ state: "ok", symbol: "SYNCEM", last: { day: "2026-10-10", value: 1284.5 }, previous: { day: "2026-10-09", value: 1272.2 }, source: "Dhan · NSE close" });
  });
});

describe("GET /documents/:id/file", () => {
  it("redirects to the stored PDF and is not cached", async () => {
    const a = await ctx.signUp("file-a@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const doc = await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", []);
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${doc}/file`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is not found in another workspace", async () => {
    const a = await ctx.signUp("file-b@example.com");
    const b = await ctx.signUp("file-c@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const doc = await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", []);
    const res = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/documents/${doc}/file`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run them.** `pnpm --filter @maester/api test -- research`. Expected: FAIL (404 for every route).

- [ ] **Step 7: Write `apps/api/src/routes/research.ts`.**

```ts
import { Hono } from "hono";
import type { CompanyFinancials, CompanyStock, ResearchCompanies } from "@maester/contracts";
import {
  getCompany, getConnection, getCurrentRevision, latestMarketDay, listChecksForRevisions, listCompanies, listCompanyFilings,
  listFactsWithSourcesForRevisions, listMarketSeries,
} from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { stitch, type Filing } from "../financials/stitch.js";
import { minusDays, stockFrom } from "../financials/stock.js";
import { uuidParam } from "../middleware/params.js";
import { toCompany } from "../serialize.js";

/** Most companies the Research list shows: the API's largest page. Personal use keeps far fewer. */
const COMPANY_LIMIT = 100;
/** Closes read for the summary: a year and the slack to find the close a year earlier. */
const STOCK_DAYS = 380;

const counts = (kind: string | null, intakeState: string | null) => kind === "annual_report" && intakeState === "read";

/** `/research`: the Research list. */
export function researchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/companies", async (c) => {
    const ws = c.get("workspace").id;
    const [page, filings] = await Promise.all([listCompanies(deps.db, ws, { limit: COMPANY_LIMIT }), listCompanyFilings(deps.db, ws)]);
    const items = page.items
      .map((company) => {
        const mine = filings.filter((f) => f.companyId === company.id);
        const read = mine.filter((f) => counts(f.kind, f.intakeState));
        const latest = read.map((f) => f.periodEnd).filter((d): d is string => d !== null).sort().at(-1) ?? null;
        return {
          company: toCompany(company),
          annualReportsRead: read.length,
          latestPeriodEnd: latest,
          reading: mine.filter((f) => f.intakeState === "identifying" || f.intakeState === "reading").length,
          failed: mine.filter((f) => f.intakeState === "identify_failed" || f.intakeState === "read_failed").length,
        };
      })
      .sort((a, b) => a.company.displayName.localeCompare(b.company.displayName));
    const body: ResearchCompanies = { items };
    return c.json(body);
  });
  return r;
}

/** `/companies/:id/financials` and `/companies/:id/stock`. */
export function companyResearchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id/financials", async (c) => {
    const ws = c.get("workspace").id;
    const company = await getCompany(deps.db, ws, uuidParam(c, "id"));
    if (!company) throw new HttpError("NOT_FOUND", "company not found");
    const filings = await listCompanyFilings(deps.db, ws, company.id);
    const inputs: (Filing & { revisionId: string })[] = [];
    for (const f of filings.filter((x) => counts(x.kind, x.intakeState))) {
      const revision = await getCurrentRevision(deps.db, ws, f.documentId);
      if (!revision) continue;
      inputs.push({ documentId: f.documentId, periodEnd: f.periodEnd, revisionCreatedAt: revision.createdAt, pageCount: revision.pageCount, facts: [], checks: [], revisionId: revision.id });
    }
    const ids = inputs.map((i) => i.revisionId);
    const [facts, checks] = await Promise.all([listFactsWithSourcesForRevisions(deps.db, ws, ids), listChecksForRevisions(deps.db, ws, ids)]);
    for (const input of inputs) {
      input.facts = facts.filter((f) => f.fact.revisionId === input.revisionId);
      input.checks = checks.filter((k) => k.revisionId === input.revisionId);
    }
    const body: CompanyFinancials = {
      company: toCompany(company),
      filings: filings.map((f) => ({
        documentId: f.documentId, originalName: f.originalName, kind: f.kind, periodEnd: f.periodEnd, intakeState: f.intakeState,
        counted: inputs.some((i) => i.documentId === f.documentId),
      })),
      tables: stitch(inputs),
    };
    return c.json(body);
  });

  r.get("/:id/stock", async (c) => {
    const company = await getCompany(deps.db, c.get("workspace").id, uuidParam(c, "id"));
    if (!company) throw new HttpError("NOT_FOUND", "company not found");
    const none = { source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] };
    const symbol = company.nseSymbol;
    if (!symbol) {
      const body: CompanyStock = { state: "no_symbol", symbol: null, ...none };
      return c.json(body);
    }
    const series = `eq:${symbol}`;
    const last = await latestMarketDay(deps.db, series);
    if (!last) {
      const dhan = await getConnection(deps.db, "dhan");
      const body: CompanyStock = { state: dhan ? "not_tracked" : "not_connected", symbol, ...none };
      return c.json(body);
    }
    const points = (await listMarketSeries(deps.db, [series], minusDays(last, STOCK_DAYS)))[series] ?? [];
    const body: CompanyStock = stockFrom(symbol, points.map((p) => ({ day: p.day, value: p.value, source: p.source })));
    return c.json(body);
  });

  return r;
}
```

`revision.createdAt` is the `ts()` column; if it is a string in this schema, wrap it: `new Date(revision.createdAt)`.

- [ ] **Step 8: Mount the routes and add the file redirect.** In `apps/api/src/app.ts`, import `{ companyResearchRoutes, researchRoutes }` from `./routes/research.js` and, after `ws.route("/companies", companyRoutes(deps));`, add:

```ts
    ws.route("/companies", companyResearchRoutes(deps));
    ws.route("/research", researchRoutes(deps));
```

In `apps/api/src/routes/documents.ts`, after the `/:id/download` route:

```ts
  // The PDF itself, for a plain link: "…/file#page=213" opens it at the page, since the browser
  // keeps the fragment across this redirect. Signed for a short while and never cached.
  r.get("/:id/file", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}`);
    const signed = await deps.store.signDownload(doc.storageKey, { expiresInSeconds: deps.env.DOWNLOAD_URL_TTL_SECONDS });
    c.header("Cache-Control", "no-store");
    return c.redirect(signed.url, 302);
  });
```

- [ ] **Step 9: Run the checks.** `pnpm --filter @maester/api test && pnpm --filter @maester/api typecheck && pnpm --filter @maester/api lint && pnpm --filter @maester/db lint`. Expected: PASS (all API suites, not only the new one).

- [ ] **Step 10: Commit.** `feat(api): research list, company financials and stock, and a PDF link`.

---

### Task 6: Web types, client and view words

**Files:**
- Create: `apps/web/src/lib/research/types.ts`, `apps/web/src/lib/research/client.ts`, `apps/web/src/lib/research/view.ts`, `apps/web/src/lib/research/links.ts`, `apps/web/src/lib/content/research.ts`
- Test: `apps/web/src/lib/research/client.test.ts`, `apps/web/src/lib/research/view.test.ts`

**Interfaces:**
- Consumes: `getJson`, `readMe`, `Fetcher` from `$lib/documents/client`; `resolve` from `$app/paths` (in `links.ts` only, so the tested modules don't import SvelteKit).
- Produces (used by Tasks 7–9): the mirrored types; `researchApi(fetcher, workspaceId)` with `companies()`, `financials(id)`, `stock(id)`, `pageHref(documentId, pageIndex)`; from `links.ts`: `companyHref`; from `view.ts`: `fyLabel`, `filingShort`, `filingLong`, `figure`, `unitWords`, `unitShort`, `cellText`, `cellReason`, `pageWords`, `onPage`, `addsUp`, `standing`, `readFrom`; `researchContent` copy.

- [ ] **Step 1: Write `apps/web/src/lib/research/types.ts`** (mirror; header names the contract file):

```ts
/**
 * The API's research shapes, as the Research pages read them. apps/web is a standalone project
 * and cannot import @maester/contracts, so these mirror packages/contracts/src/research.ts
 * (and Company from company.ts). When a contract changes, change it here too.
 */
import type { ClassificationKind, Company, IntakeState, ReportingBasis, StatementKind } from '$lib/documents/types';

export type CellStatus = 'value' | 'dash' | 'unparsed' | 'missing';

export interface CellCheck {
	role: 'subject' | 'component' | 'none';
	status: 'passed' | 'failed' | 'not_checked' | null;
	subjectLabel: string | null;
	expected: string | null;
	actual: string | null;
}

export interface CellSource {
	documentId: string;
	/** 0-based; pages are shown counted from 1. */
	pageIndex: number;
	pageCount: number;
	textLayerMatch: boolean | null;
}

export interface Restated {
	documentId: string;
	filingPeriodEnd: string | null;
	pageIndex: number;
	value: string | null;
	printed: string;
}

export interface FinancialCell {
	status: CellStatus;
	value: string | null;
	printed: string | null;
	factId: string | null;
	revisionId: string | null;
	source: CellSource | null;
	check: CellCheck;
	restated: Restated | null;
}

export interface FinancialRow {
	key: string;
	section: string;
	label: string;
	isSubtotal: boolean;
	perShare: boolean;
	cells: FinancialCell[];
}

export interface FinancialColumn {
	periodEnd: string;
	periodLabel: string;
	documentId: string;
	filingPeriodEnd: string | null;
}

export interface TableUnit {
	label: string | null;
	scale: string | null;
	currency: string | null;
}

export interface StatementTable {
	statement: StatementKind;
	basis: ReportingBasis;
	unit: TableUnit;
	columns: FinancialColumn[];
	rows: FinancialRow[];
	unplaced: number;
	leftOut: { documentId: string; reason: 'other_currency' | 'other_unit' }[];
}

export interface CompanyFiling {
	documentId: string;
	originalName: string;
	kind: ClassificationKind | null;
	periodEnd: string | null;
	intakeState: IntakeState | null;
	counted: boolean;
}

export interface CompanyFinancials {
	company: Company;
	filings: CompanyFiling[];
	tables: StatementTable[];
}

export interface StockPoint {
	day: string;
	value: number;
}

export interface CompanyStock {
	state: 'ok' | 'no_symbol' | 'not_connected' | 'not_tracked';
	symbol: string | null;
	source: string | null;
	last: StockPoint | null;
	previous: StockPoint | null;
	yearAgo: StockPoint | null;
	low: StockPoint | null;
	high: StockPoint | null;
	series: StockPoint[];
}

export interface ResearchCompany {
	company: Company;
	annualReportsRead: number;
	latestPeriodEnd: string | null;
	reading: number;
	failed: number;
}
```

If `Company` in `$lib/documents/types` lacks `nseSymbol`, `bseCode` or `cin`, add them there (they are in the contract).

- [ ] **Step 2: Write the copy `apps/web/src/lib/content/research.ts`.**

```ts
/**
 * Copy for the Research pages (/terminal/research and the company page). Plain words from the
 * investor's side (docs/DESIGN.md section 7). It describes the company's own figures and the
 * share's closes; it never advises. Unknown is "—" with its reason, never zero.
 */
export const researchContent = {
	heading: 'Research',
	lede: 'Each company you’ve added, with the figures from its filings and the page each one came from.',
	loading: 'Loading your companies.',
	loadFailed: {
		title: 'Research didn’t load.',
		detail: 'Your filings are safe. Check your connection and try again.',
		retry: 'Try again'
	},
	noWorkspace: { title: 'There’s no workspace to show.', detail: 'Sign out and in again.' },
	empty: 'Nothing here yet. Add a filing in Documents and its company appears here once it’s read.',
	addFiling: 'Add a filing in Documents',
	missingCompany: 'Missing a company?',
	count: (n: number) => `${n} ${n === 1 ? 'company' : 'companies'}. A company’s figures appear once one of its filings is read.`,
	columns: { company: 'Company', readFrom: 'Read from', latest: 'Latest year', standing: 'Where it stands' },
	reports: (n: number) => (n === 0 ? 'No annual report read yet' : `${n} annual ${n === 1 ? 'report' : 'reports'}`),
	standing: {
		failed: (n: number) => `${n} ${n === 1 ? 'filing' : 'filings'} didn’t read`,
		reading: (n: number) => `Reading ${n} ${n === 1 ? 'filing' : 'filings'}`,
		read: 'Read',
		nothing: 'Nothing read yet'
	},

	company: {
		back: 'Research',
		loading: (name: string | null) => (name ? `Loading ${name}.` : 'Loading the company.'),
		notFound: { title: 'This company isn’t in your workspace.', back: 'Back to Research' },
		financialsFailed: {
			title: 'The statements didn’t load.',
			detail: 'Your filings are safe. Try again.',
			retry: 'Try again'
		},
		stockFailed: {
			title: 'The prices didn’t load.',
			detail: 'The business figures below are still current.',
			retry: 'Try again'
		},
		readFrom: (n: number) => `Read from ${n} annual ${n === 1 ? 'report' : 'reports'}:`,
		nothingRead: (name: string) => `No annual report for ${name} has been read yet.`,
		addInDocuments: 'Add one in Documents',
		notInTable: (names: string) => `Results for a quarter or half year aren’t in this table yet: ${names}.`
	},

	summary: {
		heading: 'The stock and the business',
		labels: {
			close: 'Last close',
			range: '52-week range',
			pe: 'Price to earnings',
			profit: (fy: string) => `Profit for ${fy}`,
			profitUnknown: 'Profit for the latest year'
		},
		closeNote: (day: string) => `NSE close, ${day}. From your Dhan data.`,
		dayChange: (change: string, pct: string) => `${change} (${pct}) on the day`,
		rangeNote: (low: string, high: string) => `Low on ${low}, high on ${high}. The block is the last close.`,
		peNote: (close: string, eps: string, fy: string, page: number) =>
			`${close} ÷ ${eps}, the basic earnings per share for ${fy} (annual report, page ${page}).`,
		profitChange: (pct: string, fy: string) => `${pct} on ${fy}`,
		profitNote: (basis: string, revenue: string | null, change: string | null) =>
			[basis, revenue ? `Revenue ${revenue}${change ? `, ${change}` : ''}.` : null].filter(Boolean).join(' '),
		noPrice: {
			no_symbol: 'Maester has no NSE symbol for this company.',
			not_connected: 'Connect Dhan in Settings to see prices.',
			not_tracked: 'Maester keeps prices for Nifty 500 shares only, and this isn’t one.',
			failed: 'The prices didn’t load.'
		},
		needsCloses: 'Needs the year’s closes.',
		needsPrice: 'Needs a price.',
		noEps: 'The filing’s earnings per share wasn’t read.',
		loss: (fy: string) => `The company made a loss in ${fy}, so there’s no price to earnings.`,
		noFigures: 'No annual report read yet.',
		settings: 'Settings',
		chart: {
			heading: 'The last year’s closes',
			source: 'NSE, ₹ a share. From your Dhan data.',
			value: 'Close',
			label: (name: string, low: string, high: string, last: string) =>
				`${name}’s NSE closes for the last year: low ${low}, high ${high}, last ${last}.`,
			today: (close: string) => `${close} last`,
			low: (value: string, day: string) => `Low ${value}, ${day}`,
			high: (value: string, day: string) => `High ${value}, ${day}`
		}
	},

	statements: {
		heading: 'Statements',
		kinds: { income_statement: 'Profit and loss', balance_sheet: 'Balance sheet', cash_flow: 'Cash flow' },
		bases: { consolidated: 'Consolidated', standalone: 'Standalone', unknown: 'Basis not stated' },
		statementGroup: 'Statement',
		basisGroup: 'Basis',
		caption: (basis: string, kind: string) => `${basis} ${kind.toLowerCase()}, years to their period end.`,
		line: 'Line, as printed',
		unit: (words: string) => `${words}.`,
		perShareUnit: '₹ a share',
		region: (kind: string) => `${kind} by year, scrolls sideways`,
		restated: (fy: string) => `${fy} restated`,
		newestWins: 'Each year comes whole from the newest filing that prints it, so every column adds up.',
		notRead: (basis: string, kind: string) => `No ${basis.toLowerCase()} ${kind.toLowerCase()} has been read yet.`,
		unplaced: (n: number) => `${n} ${n === 1 ? 'figure had' : 'figures had'} no date and ${n === 1 ? 'is' : 'are'} left out.`,
		leftOut: {
			other_currency: (filing: string) => `${filing} reports in another currency and is left out.`,
			other_unit: (filing: string) => `${filing} uses a unit Maester can’t convert and is left out.`
		}
	},

	panel: {
		eyebrow: 'Selected figure',
		none: 'Select a figure to see where it came from.',
		context: (kind: string, basis: string, period: string) => `${kind} · ${basis.toLowerCase()} · ${period}`,
		terms: { from: 'From', restated: 'Restated', onPage: 'On the page', addsUp: 'Adds up', usedIn: 'Used in', reviewed: 'Reviewed' },
		from: (filing: string, page: string) => `${filing}, ${page}`,
		restated: (filing: string, printed: string, page: number) =>
			`${filing} printed ${printed} for this year, on page ${page}. The newer filing’s figure is shown.`,
		usedIn: 'Price to earnings, in the summary above',
		reviewed: 'Not yet',
		open: (page: number) => `Open the PDF at page ${page}`,
		openNote: (page: number) => `Opens the filing in a new tab. If it opens at the start, go to page ${page}.`,
		back: 'Back to the table'
	},

	words: {
		page: (page: number, of: number) => `Page ${page} of ${of}`,
		found: 'Found in the page’s text',
		scanned: (page: number) => `Page ${page} is scanned: not checked against its text`,
		notFound: { strong: 'Not found.', text: (printed: string) => `The page’s text doesn’t contain ${printed}.` },
		noSum: 'No sum covers this line',
		adds: 'Adds up',
		partOf: (subject: string, ok: boolean) => `Part of ${subject.toLowerCase()}, which ${ok ? 'adds up' : 'doesn’t add up'}`,
		notChecked: 'Not checked',
		failed: { strong: 'No.', text: (expected: string, actual: string, diff: string, more: boolean) => `The lines add up to ${expected}; the page prints ${actual}, ${diff} ${more ? 'more' : 'less'}.` },
		missing: (filing: string) => `Not printed under this name in ${filing}.`,
		dash: (page: number) => `A dash printed on page ${page}. Maester doesn’t read it as zero.`,
		unparsed: (page: number) => `Maester couldn’t read what page ${page} prints here.`
	}
} as const;
```

- [ ] **Step 3: Write the failing tests** `apps/web/src/lib/research/client.test.ts` and `view.test.ts`:

```ts
// client.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '$lib/documents/client';
import { researchApi } from './client';

const WS = '11111111-2222-4333-8444-555555555555';
const CO = '66666666-7777-4888-9999-000000000000';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('researchApi', () => {
	it('reads the list, the financials and the stock under the workspace', async () => {
		const calls: string[] = [];
		const fetcher = vi.fn(async (url: string) => {
			calls.push(url);
			return json(200, {});
		}) as unknown as Fetcher;
		const api = researchApi(fetcher, WS);
		await api.companies();
		await api.financials(CO);
		await api.stock(CO);
		expect(calls).toEqual([
			`/v1/workspaces/${WS}/research/companies`,
			`/v1/workspaces/${WS}/companies/${CO}/financials`,
			`/v1/workspaces/${WS}/companies/${CO}/stock`
		]);
	});

	it('links to the PDF at a page counted from 1', () => {
		const api = researchApi((() => Promise.reject()) as unknown as Fetcher, WS);
		expect(api.pageHref(CO, 212)).toBe(`/v1/workspaces/${WS}/documents/${CO}/file#page=213`);
	});
});
```

```ts
// view.test.ts
import { describe, expect, it } from 'vitest';
import type { CellCheck, FinancialCell } from './types';
import { addsUp, cellReason, cellText, figure, filingShort, fyLabel, onPage, standing, unitShort, unitWords } from './view';

const NO_CHECK: CellCheck = { role: 'none', status: null, subjectLabel: null, expected: null, actual: null };
const cell = (over: Partial<FinancialCell> = {}): FinancialCell => ({
	status: 'value', value: '12105.4', printed: '12,105.40', factId: 'f', revisionId: 'r',
	source: { documentId: 'd', pageIndex: 212, pageCount: 286, textLayerMatch: true }, check: NO_CHECK, restated: null, ...over
});

describe('fyLabel', () => {
	it('names an Indian financial year, and any other year end by its date', () => {
		expect(fyLabel('2026-03-31')).toBe('2025–26');
		expect(fyLabel('2000-03-31')).toBe('1999–00');
		expect(fyLabel('2025-12-31')).toBe('Year to 31 Dec 2025');
	});
	it('names a filing by its year', () => {
		expect(filingShort('2026-03-31')).toBe('AR 2025–26');
		expect(filingShort(null)).toBe('An annual report');
	});
});

describe('figure', () => {
	it('groups the Indian way with two decimals and a real minus', () => {
		expect(figure('12105.4')).toBe('12,105.40');
		expect(figure('123456.5')).toBe('1,23,456.50');
		expect(figure('-12.4')).toBe('−12.40');
		expect(figure('0')).toBe('0.00');
	});
});

describe('units', () => {
	it('names the table unit in words', () => {
		expect(unitWords({ label: '₹ in crore', scale: '10000000', currency: 'INR' })).toBe('₹ crore');
		expect(unitWords({ label: 'Rs. in lakhs', scale: '100000', currency: 'INR' })).toBe('₹ lakh');
		expect(unitWords({ label: '$ in millions', scale: '1000000', currency: 'USD' })).toBe('USD million');
		expect(unitWords({ label: 'Rupees', scale: '1', currency: 'INR' })).toBe('₹');
		expect(unitWords({ label: 'odd', scale: null, currency: null })).toBe('the unit printed: odd');
		expect(unitShort({ label: '₹ in crore', scale: '10000000', currency: 'INR' })).toBe('cr');
	});
});

describe('cells', () => {
	it('shows a dash as printed and unknown as —, with the reason', () => {
		expect(cellText(cell())).toBe('12,105.40');
		expect(cellText(cell({ status: 'dash', value: null, printed: '-' }))).toBe('–');
		expect(cellText(cell({ status: 'missing', value: null, source: null }))).toBe('—');
		expect(cellReason(cell({ status: 'missing', value: null, source: null }), 'AR 2023–24')).toBe('Not printed under this name in AR 2023–24.');
		expect(cellReason(cell({ status: 'dash', value: null }), 'AR 2025–26')).toBe('A dash printed on page 213. Maester doesn’t read it as zero.');
		expect(cellReason(cell({ status: 'unparsed', value: null }), 'AR 2025–26')).toBe('Maester couldn’t read what page 213 prints here.');
		expect(cellReason(cell(), 'AR 2025–26')).toBeNull();
	});
});

describe('onPage', () => {
	it('says whether the page’s text holds the figure', () => {
		expect(onPage(cell())).toEqual({ text: 'Found in the page’s text' });
		expect(onPage(cell({ source: { documentId: 'd', pageIndex: 212, pageCount: 286, textLayerMatch: null } }))).toEqual({ text: 'Page 213 is scanned: not checked against its text' });
		expect(onPage(cell({ printed: '10,012.30', source: { documentId: 'd', pageIndex: 148, pageCount: 286, textLayerMatch: false } }))).toEqual({ strong: 'Not found.', text: 'The page’s text doesn’t contain 10,012.30.' });
	});
});

describe('addsUp', () => {
	it('says what the check found, in the table unit', () => {
		expect(addsUp(cell())).toEqual({ text: 'No sum covers this line' });
		expect(addsUp(cell({ check: { role: 'component', status: 'passed', subjectLabel: 'Total income', expected: '12480', actual: '12480' } }))).toEqual({ text: 'Part of total income, which adds up' });
		expect(addsUp(cell({ check: { role: 'subject', status: 'passed', subjectLabel: 'Total income', expected: '12480', actual: '12480' } }))).toEqual({ text: 'Adds up' });
		expect(addsUp(cell({ check: { role: 'subject', status: 'failed', subjectLabel: 'Total expenses', expected: '10021.3', actual: '10012.3' } }))).toEqual({
			strong: 'No.', text: 'The lines add up to 10,021.30; the page prints 10,012.30, 9.00 less.'
		});
		expect(addsUp(cell({ check: { role: 'subject', status: 'not_checked', subjectLabel: 'Total', expected: null, actual: null } }))).toEqual({ text: 'Not checked' });
	});
});

describe('standing', () => {
	it('puts a failure first, then reading, then read', () => {
		expect(standing({ annualReportsRead: 2, reading: 1, failed: 1 })).toBe('1 filing didn’t read');
		expect(standing({ annualReportsRead: 2, reading: 1, failed: 0 })).toBe('Reading 1 filing');
		expect(standing({ annualReportsRead: 2, reading: 0, failed: 0 })).toBe('Read');
		expect(standing({ annualReportsRead: 0, reading: 0, failed: 0 })).toBe('Nothing read yet');
	});
});
```

- [ ] **Step 4: Run them.** `pnpm --dir apps/web test -- research`. Expected: FAIL (modules not found).

- [ ] **Step 5: Write `apps/web/src/lib/research/client.ts` and `view.ts`.**

```ts
// client.ts
/**
 * A small typed client for the Research routes of the API (apps/api/src/routes/research.ts and
 * the /file redirect in documents.ts). Same origin, session cookie, `fetch` passed in for tests.
 */
import { getJson, type Fetcher } from '$lib/documents/client';
import type { CompanyFinancials, CompanyStock, ResearchCompany } from './types';

export function researchApi(fetcher: Fetcher, workspaceId: string) {
	const base = `/v1/workspaces/${encodeURIComponent(workspaceId)}`;
	const company = (id: string) => `${base}/companies/${encodeURIComponent(id)}`;
	return {
		companies: () => getJson<{ items: ResearchCompany[] }>(fetcher, `${base}/research/companies`),
		financials: (id: string) => getJson<CompanyFinancials>(fetcher, `${company(id)}/financials`),
		stock: (id: string) => getJson<CompanyStock>(fetcher, `${company(id)}/stock`),
		/** The stored PDF at a page: the API redirects and the browser keeps "#page=". Counted from 1. */
		pageHref: (documentId: string, pageIndex: number) =>
			`${base}/documents/${encodeURIComponent(documentId)}/file#page=${pageIndex + 1}`
	};
}

export type ResearchApi = ReturnType<typeof researchApi>;
```

```ts
// links.ts
/** Links into the Research pages. Kept apart from view.ts so the tested modules never import SvelteKit. */
import { resolve } from '$app/paths';

/** The company page: prerendered once, so the company travels in the query. */
export function companyHref(id: string): string {
	return `${resolve('/terminal/research/company')}?id=${encodeURIComponent(id)}`;
}
```

```ts
// view.ts
/**
 * Words and numbers for the Research pages. Pure, so it is tested without Svelte. Figures use
 * Indian grouping and a real minus; pages are counted from 1; unknown is "—" with its reason.
 */
import { researchContent as copy } from '$lib/content/research';
import type { FinancialCell, ResearchCompany, TableUnit } from './types';

const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const twoDecimals = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2025–26" for a year to 31 March; "Year to 31 Dec 2025" for any other year end. */
export function fyLabel(periodEnd: string): string {
	const [y, m, d] = periodEnd.split('-').map(Number) as [number, number, number];
	if (m === 3 && d === 31) return `${y - 1}–${String(y % 100).padStart(2, '0')}`;
	return `Year to ${d} ${MONTHS[m - 1]} ${y}`;
}

export const filingShort = (periodEnd: string | null) => (periodEnd ? `AR ${fyLabel(periodEnd)}` : 'An annual report');
export const filingLong = (periodEnd: string | null) => (periodEnd ? `Annual report ${fyLabel(periodEnd)}` : 'An annual report');

/** A decimal string as a table figure: "1,23,456.50", "−12.40". */
export function figure(value: string): string {
	const n = Number(value);
	const body = twoDecimals.format(Math.abs(n));
	return n < 0 && body !== '0.00' ? MINUS + body : body;
}

const SCALE_WORDS: Record<string, [string, string]> = {
	'1': ['', ''],
	'1000': ['thousand', 'k'],
	'100000': ['lakh', 'lakh'],
	'1000000': ['million', 'mn'],
	'10000000': ['crore', 'cr'],
	'1000000000': ['billion', 'bn']
};

function currencyWord(currency: string | null): string {
	return !currency || currency === 'INR' ? '₹' : currency;
}

/** "₹ crore", "USD million", "₹"; an unknown scale names the printed unit. */
export function unitWords(unit: TableUnit): string {
	const scale = unit.scale ? String(Number(unit.scale)) : null;
	const words = scale ? SCALE_WORDS[scale] : undefined;
	if (!words) return `the unit printed: ${unit.label ?? 'none'}`;
	return words[0] ? `${currencyWord(unit.currency)} ${words[0]}` : currencyWord(unit.currency);
}

/** The short unit after a headline figure: "cr", "lakh", "mn"; "" for rupees. */
export function unitShort(unit: TableUnit): string {
	const scale = unit.scale ? String(Number(unit.scale)) : null;
	return (scale && SCALE_WORDS[scale]?.[1]) || '';
}

export function cellText(cell: FinancialCell): string {
	if (cell.status === 'value' && cell.value !== null) return figure(cell.value);
	if (cell.status === 'dash') return '–';
	return '—';
}

/** Why a cell shows no figure, for the figure panel and for screen readers; null when it does. */
export function cellReason(cell: FinancialCell, filing: string): string | null {
	const page = cell.source ? cell.source.pageIndex + 1 : 0;
	if (cell.status === 'missing') return copy.words.missing(filing);
	if (cell.status === 'dash') return copy.words.dash(page);
	if (cell.status === 'unparsed' || cell.value === null) return copy.words.unparsed(page);
	return null;
}

export const pageWords = (cell: FinancialCell) =>
	cell.source ? copy.words.page(cell.source.pageIndex + 1, cell.source.pageCount) : '—';

export type Words = { strong?: string; text: string };

export function onPage(cell: FinancialCell): Words {
	const s = cell.source;
	if (!s) return { text: '—' };
	if (s.textLayerMatch === true) return { text: copy.words.found };
	if (s.textLayerMatch === null) return { text: copy.words.scanned(s.pageIndex + 1) };
	return { strong: copy.words.notFound.strong, text: copy.words.notFound.text(cell.printed ?? '') };
}

export function addsUp(cell: FinancialCell): Words {
	const c = cell.check;
	if (c.role === 'none' || c.status === null) return { text: copy.words.noSum };
	if (c.status === 'not_checked') return { text: copy.words.notChecked };
	if (c.role === 'component') return { text: copy.words.partOf(c.subjectLabel ?? '', c.status === 'passed') };
	if (c.status === 'passed') return { text: copy.words.adds };
	const expected = Number(c.expected);
	const actual = Number(c.actual);
	const diff = figure(String(Math.abs(expected - actual).toFixed(2)));
	return {
		strong: copy.words.failed.strong,
		text: copy.words.failed.text(figure(c.expected ?? '0'), figure(c.actual ?? '0'), diff, actual > expected)
	};
}

/** The list's "Where it stands": a failure first, then work in progress, then read. */
export function standing(c: Pick<ResearchCompany, 'annualReportsRead' | 'reading' | 'failed'>): string {
	if (c.failed > 0) return copy.standing.failed(c.failed);
	if (c.reading > 0) return copy.standing.reading(c.reading);
	return c.annualReportsRead > 0 ? copy.standing.read : copy.standing.nothing;
}

export const readFrom = (n: number) => copy.reports(n);
```

- [ ] **Step 6: Run the tests.** `pnpm --dir apps/web test -- research`. Expected: PASS.

- [ ] **Step 7: Commit.** `feat(web): research types, client and view words`.

---

### Task 7: The stock and business summary (pure)

**Files:**
- Create: `apps/web/src/lib/research/summary.ts`
- Test: `apps/web/src/lib/research/summary.test.ts`

**Interfaces:**
- Consumes: Task 6 types and `figure`, `fyLabel`, `unitShort`; `price`, `percent` from `$lib/terminal/format`.
- Produces (used by Task 9):

```ts
export interface SummaryFigure { label: string; value: string | null; reason: string | null; change: string | null; note: string | null; rulerPct: number | null; settingsLink: boolean }
export interface Summary { sentence: string | null; figures: [SummaryFigure, SummaryFigure, SummaryFigure, SummaryFigure]; epsCell: { tableIndex: number; row: number; col: number } | null }
export function summarize(input: { financials: CompanyFinancials | null; stock: CompanyStock | null; stockFailed: boolean }): Summary;
export function shortName(displayName: string): string;
export function longDay(day: string): string;   // "Friday 10 October"
export function shortDay(day: string): string;  // "12 Jan"
```

- [ ] **Step 1: Write the failing tests** `apps/web/src/lib/research/summary.test.ts`. The fixture is the canvas's Synthetic Cements: consolidated profit and loss for 2024–25 and 2025–26 in ₹ crore with basic earnings per share, and closes giving 1,284.50 on Friday 9 October 2026 (10 October 2026 is a Saturday; the canvas's "Friday 10" is corrected to 9).

```ts
import { describe, expect, it } from 'vitest';
import type { CompanyFinancials, CompanyStock, FinancialCell, FinancialRow, StatementTable } from './types';
import { longDay, shortName, summarize } from './summary';

const NO = { role: 'none', status: null, subjectLabel: null, expected: null, actual: null } as const;
const v = (value: string | null, page = 213): FinancialCell => ({
	status: value === null ? 'missing' : 'value', value, printed: value, factId: 'f', revisionId: 'r',
	source: value === null ? null : { documentId: 'd26', pageIndex: page - 1, pageCount: 286, textLayerMatch: true }, check: NO, restated: null
});
const r = (label: string, a: string | null, b: string | null, over: Partial<FinancialRow> = {}): FinancialRow => ({
	key: label, section: 'Income', label, isSubtotal: false, perShare: false, cells: [v(a), v(b)], ...over
});
function pl(rows: FinancialRow[], basis: 'consolidated' | 'standalone' = 'consolidated'): StatementTable {
	return {
		statement: 'income_statement', basis, unit: { label: '₹ in crore', scale: '10000000', currency: 'INR' },
		columns: [
			{ periodEnd: '2025-03-31', periodLabel: 'Year ended 31 March 2025', documentId: 'd26', filingPeriodEnd: '2026-03-31' },
			{ periodEnd: '2026-03-31', periodLabel: 'Year ended 31 March 2026', documentId: 'd26', filingPeriodEnd: '2026-03-31' }
		],
		rows, unplaced: 0, leftOut: []
	};
}
const company = { id: 'c', workspaceId: 'w', displayName: 'Synthetic Cements Limited', country: 'IN', cin: null, bseCode: null, nseSymbol: 'SYNCEM', createdAt: '' };
const canvas = (rows = [
	r('Revenue from operations', '11240.75', '12105.4'),
	r('Profit for the year', '1144', '1459', { isSubtotal: true }),
	r('Basic', '48.6', '61.98', { section: 'Earnings per equity share (₹)', perShare: true })
]): CompanyFinancials => ({ company, filings: [], tables: [pl(rows)] });
const stock: CompanyStock = {
	state: 'ok', symbol: 'SYNCEM', source: 'Dhan · NSE close',
	last: { day: '2026-10-09', value: 1284.5 }, previous: { day: '2026-10-08', value: 1272.2 }, yearAgo: { day: '2025-10-09', value: 1085 },
	low: { day: '2026-01-12', value: 1021.15 }, high: { day: '2026-09-24', value: 1342.8 },
	series: [{ day: '2026-10-08', value: 1272.2 }, { day: '2026-10-09', value: 1284.5 }]
};

describe('shortName and longDay', () => {
	it('drops a trailing Limited and names the day', () => {
		expect(shortName('Synthetic Cements Limited')).toBe('Synthetic Cements');
		expect(shortName('Kestrel Power Ltd.')).toBe('Kestrel Power');
		expect(longDay('2026-10-09')).toBe('Friday 9 October');
	});
});

describe('summarize', () => {
	it('writes the canvas sentence and figures', () => {
		const s = summarize({ financials: canvas(), stock, stockFailed: false });
		expect(s.sentence).toBe('Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier. In 2025–26 its revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore.');
		expect(s.figures.map((f) => f.value)).toEqual(['₹1,284.50', '₹1,021.15 – 1,342.80', '20.7', '₹1,459 cr']);
		expect(s.figures[0]!.change).toBe('+12.30 (+0.97%) on the day');
		expect(s.figures[0]!.note).toBe('NSE close, Friday 9 Oct. From your Dhan data.');
		expect(s.figures[1]!.rulerPct).toBe(82);
		expect(s.figures[2]!.note).toBe('1,284.50 ÷ 61.98, the basic earnings per share for 2025–26 (annual report, page 213).');
		expect(s.figures[3]!.change).toBe('+27.5% on 2024–25');
		expect(s.epsCell).toEqual({ tableIndex: 0, row: 2, col: 1 });
	});

	it('uses the printed earnings per share, not a scaled one', () => {
		const s = summarize({ financials: canvas(), stock, stockFailed: false });
		expect(Number(s.figures[2]!.value)).toBeCloseTo(1284.5 / 61.98, 1);
	});

	it('shows the business figures with no price, each price figure saying why', () => {
		const s = summarize({ financials: canvas(), stock: { ...stock, state: 'not_tracked', last: null, previous: null, yearAgo: null, low: null, high: null, series: [] }, stockFailed: false });
		expect(s.figures.slice(0, 3).map((f) => [f.value, f.reason])).toEqual([
			[null, 'Maester keeps prices for Nifty 500 shares only, and this isn’t one.'],
			[null, 'Needs the year’s closes.'],
			[null, 'Needs a price.']
		]);
		expect(s.figures[3]!.value).toBe('₹1,459 cr');
		expect(s.sentence).toBe('In 2025–26 Synthetic Cements’ revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore.');
	});

	it('points to Settings when Dhan isn’t connected', () => {
		const s = summarize({ financials: canvas(), stock: { ...stock, state: 'not_connected', last: null, previous: null, yearAgo: null, low: null, high: null, series: [] }, stockFailed: false });
		expect(s.figures[0]).toMatchObject({ value: null, reason: 'Connect Dhan in Settings to see prices.', settingsLink: true });
	});

	it('says a loss in words, with no percentage against a loss', () => {
		const s = summarize({ financials: canvas([r('Revenue from operations', '11240.75', '10105.4'), r('Profit for the year', '-120', '-310', { isSubtotal: true }), r('Basic', '-5.1', '-13.17', { section: 'Earnings per share', perShare: true })]), stock, stockFailed: false });
		expect(s.sentence).toContain('In 2025–26 its revenue fell 10.1% to ₹10,105 crore and it made a loss of ₹310 crore, against a loss of ₹120 crore the year before.');
		expect(s.figures[2]).toMatchObject({ value: null, reason: 'The company made a loss in 2025–26, so there’s no price to earnings.' });
		expect(s.figures[3]!.change).toBeNull();
	});

	it('says why price to earnings is missing when no earnings per share was read', () => {
		const s = summarize({ financials: canvas([r('Revenue from operations', '11240.75', '12105.4'), r('Profit for the year', '1144', '1459', { isSubtotal: true })]), stock, stockFailed: false });
		expect(s.figures[2]).toMatchObject({ value: null, reason: 'The filing’s earnings per share wasn’t read.' });
	});

	it('leaves out what it doesn’t know, and never writes a sentence from nothing', () => {
		const s = summarize({ financials: null, stock: null, stockFailed: true });
		expect(s.sentence).toBeNull();
		expect(s.figures.map((f) => f.value)).toEqual([null, null, null, null]);
		expect(s.figures[0]!.reason).toBe('The prices didn’t load.');
	});
});
```

- [ ] **Step 2: Run them.** `pnpm --dir apps/web test -- summary`. Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/lib/research/summary.ts`.**

```ts
/**
 * The stock and business summary on a company's page: one sentence filled in by rule (never by
 * a model), and four headline figures. Prices are the investor's own Dhan closes; the business
 * figures are the newest year read. Price to earnings divides the last close by the basic
 * earnings per share the annual report prints. Unknown is "—" with its reason; never advice.
 */
import { researchContent as copy } from '$lib/content/research';
import { percent, price } from '$lib/terminal/format';
import type { CompanyFinancials, CompanyStock, FinancialRow, StatementTable } from './types';
import { fyLabel, unitShort, unitWords } from './view';

export interface SummaryFigure {
	label: string;
	value: string | null;
	reason: string | null;
	change: string | null;
	note: string | null;
	rulerPct: number | null;
	settingsLink: boolean;
}
export interface Summary {
	sentence: string | null;
	figures: [SummaryFigure, SummaryFigure, SummaryFigure, SummaryFigure];
	epsCell: { tableIndex: number; row: number; col: number } | null;
}

const MINUS = '−';
const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const at = (day: string) => new Date(`${day}T00:00:00Z`);

export const shortName = (name: string) => name.replace(/\s+(limited|ltd\.?)$/i, '').trim();
/** "Friday 9 October". */
export const longDay = (day: string) => longFmt.format(at(day)).replace(',', '');
/** "9 Oct". */
export const shortDay = (day: string) => shortFmt.format(at(day));

const signed = (n: number) => `${n < 0 ? MINUS : '+'}${two.format(Math.abs(n))}`;
const signedPct = (n: number, digits = 1) => `${n < 0 ? MINUS : '+'}${percent(Math.abs(n), digits)}`;
const change = (now: number, before: number) => ((now - before) / Math.abs(before)) * 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

const REVENUE = /^(revenue from operations|total revenue from operations|income from operations|revenue)$/;
const PROFIT = /^(net )?(profit|profit loss|loss) (for|after tax for) the (year|period)$|^(net profit|profit after tax)$/;

/** The profit and loss to summarise: consolidated if read, otherwise standalone. */
function profitAndLoss(f: CompanyFinancials | null): { table: StatementTable; index: number } | null {
	if (!f) return null;
	for (const basis of ['consolidated', 'standalone', 'unknown'] as const) {
		const index = f.tables.findIndex((t) => t.statement === 'income_statement' && t.basis === basis);
		if (index >= 0) return { table: f.tables[index]!, index };
	}
	return null;
}

/** The newest column with a figure, and the figure in the column before it. */
function latest(row: FinancialRow): { now: number; col: number; before: number | null } | null {
	const cells = row.cells;
	for (let c = cells.length - 1; c >= 0; c--) {
		const cell = cells[c]!;
		if (cell.status === 'value' && cell.value !== null) {
			const prev = c > 0 ? cells[c - 1]! : null;
			return { now: Number(cell.value), col: c, before: prev && prev.status === 'value' && prev.value !== null ? Number(prev.value) : null };
		}
	}
	return null;
}

const blank = (label: string): SummaryFigure => ({ label, value: null, reason: null, change: null, note: null, rulerPct: null, settingsLink: false });

export function summarize(input: { financials: CompanyFinancials | null; stock: CompanyStock | null; stockFailed: boolean }): Summary {
	const { financials, stock } = input;
	const name = financials ? shortName(financials.company.displayName) : '';
	const ok = !input.stockFailed && stock?.state === 'ok' && stock.last !== null ? stock : null;
	const noPrice = input.stockFailed || !stock ? copy.summary.noPrice.failed : stock.state === 'ok' ? copy.summary.noPrice.failed : copy.summary.noPrice[stock.state];

	// Price figures.
	const close = blank(copy.summary.labels.close);
	const range = blank(copy.summary.labels.range);
	if (ok) {
		const last = ok.last!;
		close.value = price(last.value);
		close.note = copy.summary.closeNote(`${weekdayFmt.format(at(last.day))} ${shortDay(last.day)}`);
		if (ok.previous) close.change = copy.summary.dayChange(signed(last.value - ok.previous.value), signedPct(change(last.value, ok.previous.value), 2));
		if (ok.low && ok.high) {
			range.value = `${price(ok.low.value)} – ${two.format(ok.high.value)}`;
			range.rulerPct = ok.high.value > ok.low.value ? Math.round(((last.value - ok.low.value) / (ok.high.value - ok.low.value)) * 100) : 50;
			range.note = copy.summary.rangeNote(shortDay(ok.low.day), shortDay(ok.high.day));
		}
	} else {
		close.reason = noPrice;
		close.settingsLink = !input.stockFailed && stock?.state === 'not_connected';
		range.reason = copy.summary.needsCloses;
	}

	// Business figures, the sentence's second part, and price to earnings.
	const profitFig = blank(copy.summary.labels.profitUnknown);
	const pe = blank(copy.summary.labels.pe);
	let business: string | null = null;
	let epsCell: Summary['epsCell'] = null;
	const pl = profitAndLoss(financials);
	if (!pl) {
		profitFig.reason = copy.summary.noFigures;
		pe.reason = ok ? copy.summary.noFigures : copy.summary.needsPrice;
	} else {
		const { table, index } = pl;
		const short = unitShort(table.unit);
		const word = unitWords(table.unit).replace(/^₹ ?/, '');
		const money = (n: number, compact: boolean) => {
			const unit = compact ? short : word;
			return `₹${whole.format(Math.abs(n))}${unit ? ` ${unit}` : ''}`;
		};
		const revIndex = table.rows.findIndex((r) => !r.perShare && REVENUE.test(norm(r.label)));
		const profIndex = table.rows.findIndex((r) => !r.perShare && PROFIT.test(norm(r.label)));
		const basicIndex = table.rows.findIndex((r) => r.perShare && /basic/.test(norm(`${r.section} ${r.label}`)));
		const epsIndex = basicIndex >= 0 ? basicIndex : table.rows.findIndex((r) => r.perShare);
		const rev = revIndex >= 0 ? latest(table.rows[revIndex]!) : null;
		const prof = profIndex >= 0 ? latest(table.rows[profIndex]!) : null;
		const anchor = prof ?? rev;
		const fy = anchor ? fyLabel(table.columns[anchor.col]!.periodEnd) : null;

		if (prof && fy) {
			profitFig.label = copy.summary.labels.profit(fy);
			profitFig.value = `${prof.now < 0 ? MINUS : ''}${money(prof.now, true)}`;
			if (prof.before !== null && prof.before > 0 && prof.now > 0 && prof.col > 0) {
				profitFig.change = copy.summary.profitChange(signedPct(change(prof.now, prof.before)), fyLabel(table.columns[prof.col - 1]!.periodEnd));
			}
			const revChange = rev && rev.before ? signedPct(change(rev.now, rev.before)) : null;
			profitFig.note = copy.summary.profitNote(`${table.basis === 'standalone' ? 'Standalone' : 'Consolidated'}.`, rev ? money(rev.now, true) : null, revChange);
		} else {
			profitFig.reason = copy.summary.noFigures;
		}

		// "In 2025–26 its revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore."
		// The first clause names the owner: "its" after the price sentence, the company otherwise.
		const owner = ok ? 'its' : name.endsWith('s') ? `${name}’` : `${name}’s`;
		const revClause = (who: string) =>
			!rev ? null
			: rev.before ? `${who} revenue ${rev.now >= rev.before ? 'grew' : 'fell'} ${percent(Math.abs(change(rev.now, rev.before)))} to ${money(rev.now, false)}`
			: `${who} revenue was ${money(rev.now, false)}`;
		const profClause = (who: string) => {
			if (!prof) return null;
			if (prof.now >= 0 && prof.before !== null && prof.before > 0) return `${who} profit ${prof.now >= prof.before ? 'grew' : 'fell'} ${percent(Math.abs(change(prof.now, prof.before)))} to ${money(prof.now, false)}`;
			if (prof.now >= 0) return `${who} profit was ${money(prof.now, false)}${prof.before !== null && prof.before < 0 ? `, against a loss of ${money(prof.before, false)} the year before` : ''}`;
			const against = prof.before === null ? '' : prof.before < 0 ? `, against a loss of ${money(prof.before, false)} the year before` : `, against a profit of ${money(prof.before, false)} the year before`;
			return `it made a loss of ${money(prof.now, false)}${against}`;
		};
		const clauses = rev ? [revClause(owner), profClause('its')] : [profClause(owner)];
		const said = clauses.filter((c): c is string => c !== null);
		if (fy && said.length) business = `In ${fy} ${said.join(' and ')}.`;

		// Price to earnings: the last close ÷ the printed basic earnings per share.
		const eps = epsIndex >= 0 ? latest(table.rows[epsIndex]!) : null;
		if (eps) epsCell = { tableIndex: index, row: epsIndex, col: eps.col };
		if (!ok) pe.reason = copy.summary.needsPrice;
		else if (!eps) pe.reason = copy.summary.noEps;
		else if (eps.now <= 0) pe.reason = copy.summary.loss(fyLabel(table.columns[eps.col]!.periodEnd));
		else {
			const cell = table.rows[epsIndex]!.cells[eps.col]!;
			pe.value = (ok.last!.value / eps.now).toFixed(1);
			pe.note = copy.summary.peNote(two.format(ok.last!.value), two.format(eps.now), fyLabel(table.columns[eps.col]!.periodEnd), (cell.source?.pageIndex ?? 0) + 1);
		}
	}

	// "Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier."
	let priceSentence: string | null = null;
	if (ok && name) {
		const last = ok.last!;
		priceSentence = `${name} closed at ${price(last.value)} on ${longDay(last.day)}`;
		if (ok.yearAgo) {
			const ch = change(last.value, ok.yearAgo.value);
			priceSentence += `, ${percent(Math.abs(ch))} ${ch >= 0 ? 'higher' : 'lower'} than a year earlier`;
		}
		priceSentence += '.';
	}
	const sentence = [priceSentence, business].filter(Boolean).join(' ') || null;
	return { sentence, figures: [close, range, pe, profitFig], epsCell };
}
```

`percent()` from `$lib/terminal/format` gives one decimal by default ("7.7%"); the day change asks for two ("0.97%").

- [ ] **Step 4: Run the tests.** `pnpm --dir apps/web test -- summary`. Expected: PASS. Adjust only the implementation, never the canvas figures in the test.

- [ ] **Step 5: Commit.** `feat(web): stock and business summary for a company`.

---

### Task 8: Keyboard movement in the table, and the chart for a share's closes

**Files:**
- Create: `apps/web/src/lib/research/grid.ts`
- Test: `apps/web/src/lib/research/grid.test.ts`
- Modify: `apps/web/src/lib/market-mood/chart.ts` (`frameFor` takes `left`; add `highest`), `apps/web/src/lib/market-mood/chart.test.ts`
- Modify: `apps/web/src/lib/components/market-mood/MoodChart.svelte` (props `gutter`, `axisFormat`, `highLabel`)

**Interfaces:**
- Produces: `export type Pos = { r: number; c: number }; export function move(pos: Pos, key: string, rows: number, cols: number): Pos | null;` and `frameFor(width, { bandNames, left? })`, `highest(values): number | null`; `MoodChart` props `gutter?: number` (default 48), `axisFormat?: (v: number) => string` (default `format`), `highLabel?: ((value: number, day: string) => string) | null` (default null).

- [ ] **Step 1: Write the failing tests.**

```ts
// grid.test.ts
import { describe, expect, it } from 'vitest';
import { move } from './grid';

describe('move', () => {
	it('moves one figure with the arrows and stops at the edges', () => {
		expect(move({ r: 1, c: 1 }, 'ArrowRight', 5, 4)).toEqual({ r: 1, c: 2 });
		expect(move({ r: 1, c: 3 }, 'ArrowRight', 5, 4)).toEqual({ r: 1, c: 3 });
		expect(move({ r: 0, c: 0 }, 'ArrowUp', 5, 4)).toEqual({ r: 0, c: 0 });
		expect(move({ r: 4, c: 0 }, 'ArrowDown', 5, 4)).toEqual({ r: 4, c: 0 });
	});
	it('jumps to the ends of a row with Home and End', () => {
		expect(move({ r: 2, c: 2 }, 'Home', 5, 4)).toEqual({ r: 2, c: 0 });
		expect(move({ r: 2, c: 0 }, 'End', 5, 4)).toEqual({ r: 2, c: 3 });
	});
	it('leaves other keys alone', () => {
		expect(move({ r: 0, c: 0 }, 'Tab', 5, 4)).toBeNull();
	});
});
```

Add to `chart.test.ts`:

```ts
describe('frameFor left', () => {
	it('takes a wider left gutter for longer axis labels', () => {
		expect(frameFor(600, { bandNames: false }).left).toBe(48);
		expect(frameFor(600, { bandNames: false, left: 72 }).left).toBe(72);
	});
});
describe('highest', () => {
	it('finds the first highest point', () => {
		expect(highest([1, 5, 3, 5])).toBe(1);
		expect(highest([])).toBeNull();
	});
});
```

(Import `highest` alongside the existing imports at the top of `chart.test.ts`.)

- [ ] **Step 2: Run them.** `pnpm --dir apps/web test -- grid chart`. Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// grid.ts
/** Arrow-key movement between the figures of a statement table: one tab stop, moved by keys. */
export type Pos = { r: number; c: number };

export function move(pos: Pos, key: string, rows: number, cols: number): Pos | null {
	const clamp = (n: number, max: number) => Math.max(0, Math.min(max - 1, n));
	switch (key) {
		case 'ArrowUp': return { r: clamp(pos.r - 1, rows), c: pos.c };
		case 'ArrowDown': return { r: clamp(pos.r + 1, rows), c: pos.c };
		case 'ArrowLeft': return { r: pos.r, c: clamp(pos.c - 1, cols) };
		case 'ArrowRight': return { r: pos.r, c: clamp(pos.c + 1, cols) };
		case 'Home': return { r: pos.r, c: 0 };
		case 'End': return { r: pos.r, c: cols - 1 };
		default: return null;
	}
}
```

In `chart.ts`: change `frameFor` to `export function frameFor(width: number, opts: { bandNames: boolean; left?: number }): Frame` with `left: opts.left ?? 48`, and add next to `lowest`:

```ts
/** Index of the first highest value, or null for no values. */
export function highest(values: number[]): number | null {
	if (values.length === 0) return null;
	let at = 0;
	values.forEach((v, i) => {
		if (v > values[at]!) at = i;
	});
	return at;
}
```

In `MoodChart.svelte`:
- Props: add `gutter?: number; axisFormat?: (value: number) => string; highLabel?: ((value: number, day: string) => string) | null;` with defaults `gutter = 48`, `axisFormat` defaulting to `format` (`let axis = $derived(axisFormat ?? format);`), `highLabel = null`.
- `let frame = $derived(frameFor(width, { bandNames: bands, left: gutter }));`
- Axis labels use `{axis(v)}` instead of `{format(v)}`; the table keeps `{format(p.value)}`.
- `let high = $derived(highLabel ? highest(values) : null);` and, after the low mark, the same mark-and-halo block for `high` (skip it when `high === last` or `high === low`), placing the label above the point: `y={Math.max(ly - 10, frame.top + 12)}`.
- Update the header comment: "…or a share's year of closes (the Research summary)".

- [ ] **Step 4: Run the checks.** `pnpm --dir apps/web test -- grid chart && pnpm --dir apps/web check`. Expected: PASS; Market mood's charts unchanged (their callers pass none of the new props).

- [ ] **Step 5: Commit.** `feat(web): keyboard movement for tables; a chart that draws a share's closes`.

---

### Task 9: The Research pages

**Files:**
- Create: `apps/web/src/lib/components/research/ResearchPage.svelte`, `CompanyPage.svelte`, `StockSummary.svelte`, `RangeRuler.svelte`, `StatementTable.svelte`, `FigurePanel.svelte`
- Create: `apps/web/src/routes/terminal/research/company/+page.svelte`
- Modify: `apps/web/src/routes/terminal/research/+page.svelte`
- Modify: `apps/web/src/lib/terminal/pages.ts` (Research works), `apps/web/src/lib/terminal/pages.test.ts`
- Modify: `apps/web/src/lib/content/terminal.ts` (remove `comingSoon.pages.research`; watchlist `needs`)
- Delete: `apps/web/src/lib/components/terminal/sketches/CabinetSketch.svelte`
- Modify: `apps/web/src/lib/components/documents/Slip.svelte`, `apps/web/src/lib/content/documents.ts` ("See the figures")

**Interfaces:** Consumes Tasks 6–8. Load `svelte-code-writer` and `svelte-core-bestpractices` first.

- [ ] **Step 1: Make Research a working page in the rail (test first).** In `pages.test.ts` change the test to:

```ts
	it('marks every page as coming soon until it works; Market mood, Research, Documents and Settings work', () => {
		expect(terminalPages.filter((page) => !page.soon).map((page) => page.key)).toEqual([
			'market-mood', 'research', 'documents', 'settings'
		]);
	});
```

Run `pnpm --dir apps/web test -- pages` (FAIL), then in `pages.ts` set Research's `soon: false`, change `ComingSoonKey` to `Exclude<TerminalPageKey, 'documents' | 'market-mood' | 'research' | 'settings'>`, and update the header comment ("Market mood, Research, Documents and Settings work."). Remove `comingSoon.pages.research` from `content/terminal.ts`; change the watchlist `needs` to `'It starts once you can follow a company from Research.'`. Delete `CabinetSketch.svelte`. Run the test again: PASS.

- [ ] **Step 2: Write `RangeRuler.svelte`** (drawing only; the figure's words carry the values):

```svelte
<!--
	Where the last close sits in the year's range: a 2px rule from low to high, ticks at both ends,
	and a 6 by 18px block at the close. Drawing only: the figure and its note say the values.
-->
<script lang="ts">
	interface Props {
		/** 0 at the low, 100 at the high. */
		pct: number;
	}
	let { pct }: Props = $props();
	let at = $derived(Math.max(0, Math.min(100, pct)));
</script>

<div class="ruler" aria-hidden="true">
	<span class="rule"></span>
	<span class="tick start"></span>
	<span class="tick end"></span>
	<span class="block" style:left="calc({at}% - 3px)"></span>
</div>

<style>
	.ruler {
		position: relative;
		height: 22px;
	}
	.rule {
		position: absolute;
		inset: 10px 0 auto;
		height: var(--rule);
		background: var(--ink);
	}
	.tick {
		position: absolute;
		top: 4px;
		width: var(--rule);
		height: 14px;
		background: var(--ink);
	}
	.start {
		left: 0;
	}
	.end {
		right: 0;
	}
	.block {
		position: absolute;
		top: 2px;
		width: 6px;
		height: 18px;
		background: var(--ink);
	}
</style>
```

- [ ] **Step 3: Write `StockSummary.svelte`.** Props: `{ summary: Summary; stock: CompanyStock | null; name: string; failed: boolean; onretry: () => void }`. Markup, in order:
  1. `<section aria-labelledby="{id}-summary">` with `<h2 id="{id}-summary">{copy.summary.heading}</h2>`.
  2. `{#if summary.sentence}<p class="sentence">{summary.sentence}</p>{/if}` (19px from 1024px, 17px below; max-width 68ch).
  3. `{#if failed}<SectionIssue title={copy.company.stockFailed.title} detail={copy.company.stockFailed.detail} retryLabel={copy.company.stockFailed.retry} {onretry} />{/if}`.
  4. The figure strip: `<dl class="figures">` with one `.cell` per figure: `<dt class="muted">{f.label}</dt>`, `<dd>`: the value in `.figure.num` (or `<span aria-hidden="true">—</span><span class="visually-hidden">{f.reason}</span>` when `f.value === null`), then `.change.num` (bold), then `<RangeRuler pct={f.rulerPct} />` when `f.rulerPct !== null`, then `<span class="muted note">{f.note ?? f.reason}</span>`; when `f.settingsLink`, the note renders as `Connect Dhan in <a href={resolve('/terminal/settings')}>{copy.summary.settings}</a> to see prices.`. Layout as DESIGN's figure strip: a spec list on phones, 2 by 2 from 768px, 4 in a row from 1024px, 1px `--ink-muted` rules between cells, 2px rules above and below; the range figure at `var(--text-lg)` so it stays on one line.
  5. When `stock?.state === 'ok' && stock.series.length > 1`: `<h3>{copy.summary.chart.heading}</h3>`, `<p class="muted">{copy.summary.chart.source}</p>`, and

```svelte
<MoodChart
	points={stock.series}
	domain={niceDomain(stock.series.map((p) => p.value))}
	label={copy.summary.chart.label(name, price(stock.low!.value), price(stock.high!.value), price(stock.last!.value))}
	format={price}
	axisFormat={(v) => inr(v)}
	gutter={72}
	todayLabel={copy.summary.chart.today(price(stock.last!.value))}
	lowLabel={(v, day) => copy.summary.chart.low(price(v), day)}
	highLabel={(v, day) => copy.summary.chart.high(price(v), day)}
	withYear
	valueHeader={copy.summary.chart.value}
/>
```

  Imports: `niceDomain` from `$lib/market-mood/chart`, `inr`, `price` from `$lib/terminal/format`, `resolve` from `$app/paths`.

- [ ] **Step 4: Write `StatementTable.svelte`.** Props: `{ table: StatementTable; filings: CompanyFiling[]; selected: Pos | null; onselect: (pos: Pos) => void; label: string; idPrefix: string }`. Button ids are `${idPrefix}-${r}-${c}`, so the page can return focus to a figure. Behaviour:
  - Wrap in `<div class="scroll-x" role="region" aria-label={label} tabindex="0">`.
  - `<table>` with `<caption class="visually-hidden">{label}</caption>`; header row: `<th scope="col">{copy.statements.line}</th>` then, per column, `<th scope="col" class="figure"><span class="year">{fyLabel(col.periodEnd)}</span><span class="muted from">{filingShort(col.filingPeriodEnd)}</span></th>`.
  - Body: walk `table.rows`; when a row's `section` differs from the previous row's, emit `<tr class="section"><th scope="rowgroup" colspan={columns.length + 1}>{row.section}</th></tr>`. Each data row: `<th scope="row" class:subtotal={row.isSubtotal}>{row.label}{#if row.perShare}<span class="muted unit"> ({copy.statements.perShareUnit})</span>{/if}` plus, for each column whose cell has `restated`, `<span class="muted note">{copy.statements.restated(fyLabel(col.periodEnd))}</span>`, then `</th>`.
  - Each cell: `<td class="figure num"><button type="button" id="{idPrefix}-{r}-{c}" class="cell" aria-pressed={isSelected} tabindex={isActive ? 0 : -1} onclick={() => onselect({ r, c })} onkeydown={(e) => key(e, r, c)}>{cellText(cell)}{#if reason}<span class="visually-hidden"> {reason}</span>{/if}</button></td>` where `reason = cellReason(cell, filingShort(col.filingPeriodEnd))`.
  - `active` is `$state<Pos>({ r: 0, c: lastColumn })`; on `selected` change, `active = selected`. `key()` calls `move()`; on a new position, set `active`, `e.preventDefault()`, and focus `document.getElementById(\`${idPrefix}-${r}-${c}\`)`.
  - Styles: as `HoldingsTable` (2px box, 2px header rule, 1px `--ink-muted` hairlines, figures right-aligned and tabular), plus: the first column `position: sticky; left: 0; background: var(--paper)` with a 2px right rule; `.cell` is a full-cell button with no border, `min-height: 44px`, text right-aligned; `[aria-pressed='true']` is an ink block (`background: var(--ink); color: var(--paper)`); `.cell:focus-visible` gets the 3px ink outline at 2px offset; `.section th` is 14px bold `--ink-muted`; `.subtotal` bold. Below 768px, labels wrap at 9rem.

- [ ] **Step 5: Write `FigurePanel.svelte`.** Props: `{ table: StatementTable; pos: Pos | null; filings: CompanyFiling[]; pageHref: (documentId: string, pageIndex: number) => string; usedInPe: boolean; headingId: string; onback: () => void }`. Markup:
  - `<aside class="panel" aria-labelledby={headingId}>`; `<p class="muted">{copy.panel.eyebrow}</p>`.
  - With no `pos`: `<h3 id={headingId} tabindex="-1">{copy.panel.none}</h3>`.
  - With a `pos`: `row = table.rows[pos.r]`, `col = table.columns[pos.c]`, `cell = row.cells[pos.c]`. `<h3 id={headingId} tabindex="-1">{row.label}</h3>`, the context line `copy.panel.context(kind, basis, col.periodLabel)`, the figure (`cellText(cell)` at 40px, width 110%, bold) with the unit (`row.perShare ? '₹ a share' : unitWords(table.unit)`), then a spec list `<dl>`:
    - From: `copy.panel.from(filingLong(col.filingPeriodEnd), pageWords(cell))`, or the cell's reason when it has no source.
    - Restated (only when `cell.restated`): `copy.panel.restated(filingLong(cell.restated.filingPeriodEnd), cell.restated.printed, cell.restated.pageIndex + 1)`.
    - On the page: `onPage(cell)` (bold `strong` first when present).
    - Adds up: `addsUp(cell)` (bold `strong` first when present).
    - Used in (only when `usedInPe`): `copy.panel.usedIn`.
    - Reviewed: `copy.panel.reviewed`.
  - When `cell.source`: the PDF link, with the eslint comment from Global constraints on the line before:

```svelte
<a class="button outline" href={pageHref(cell.source.documentId, cell.source.pageIndex)} target="_blank" rel="noopener">
	{copy.panel.open(cell.source.pageIndex + 1)}
</a>
<p class="muted">{copy.panel.openNote(cell.source.pageIndex + 1)}</p>
```

  and `<button type="button" class="button outline back" onclick={onback}>{copy.panel.back}</button>`, hidden from 1024px (`@media (min-width: 1024px) { .back { display: none; } }`).
  - From 1024px the panel has a 2px ink left rule and 24px left padding; below it, a 2px top rule.

- [ ] **Step 6: Write `CompanyPage.svelte`.**

```svelte
<!--
	A company's page under Research: the stock and the business on top, then its statements year by
	year from every read annual report, and the selected figure's evidence beside them. The company
	comes from "?id=": the route is prerendered once, and this component only renders in the browser
	(SignedInPage draws its children after the session check), so reading the query is safe here.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { researchContent as copy } from '$lib/content/research';
	import { ApiError, readMe, type Fetcher } from '$lib/documents/client';
	import { researchApi, type ResearchApi } from '$lib/research/client';
	import { summarize } from '$lib/research/summary';
	import type { Pos } from '$lib/research/grid';
	import type { CompanyFinancials, CompanyStock, StatementTable as Table } from '$lib/research/types';
	import { filingLong, fyLabel, unitWords } from '$lib/research/view';
	import type { ReportingBasis, StatementKind } from '$lib/documents/types';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import StockSummary from './StockSummary.svelte';
	import StatementTable from './StatementTable.svelte';
	import FigurePanel from './FigurePanel.svelte';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);
	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	let companyId = $derived(page.url.searchParams.get('id'));
	let load = $state<'loading' | 'not-found' | 'failed' | 'ready'>('loading');
	let api = $state.raw<ResearchApi | null>(null);
	let financials = $state.raw<CompanyFinancials | null>(null);
	let stock = $state.raw<CompanyStock | null>(null);
	let stockFailed = $state(false);
	let statement = $state<StatementKind>('income_statement');
	let basis = $state<ReportingBasis>('consolidated');
	let selected = $state<Pos | null>(null);

	async function start(target: string | null) {
		load = 'loading';
		financials = null;
		stock = null;
		selected = null;
		if (!target || !UUID.test(target)) {
			load = 'not-found';
			return;
		}
		try {
			const me = await readMe(fetcher);
			const ws = me.workspaces[0];
			if (!ws) {
				load = 'not-found';
				return;
			}
			const client = researchApi(fetcher, ws.id);
			api = client;
			const [f, s] = await Promise.allSettled([client.financials(target), client.stock(target)]);
			if (f.status === 'rejected') {
				load = f.reason instanceof ApiError && f.reason.status === 404 ? 'not-found' : 'failed';
				return;
			}
			financials = f.value;
			stock = s.status === 'fulfilled' ? s.value : null;
			stockFailed = s.status === 'rejected';
			const bases = f.value.tables.filter((t) => t.statement === 'income_statement').map((t) => t.basis);
			basis = bases.includes('consolidated') ? 'consolidated' : (bases[0] ?? 'consolidated');
			load = 'ready';
		} catch {
			load = 'failed';
		}
	}

	async function retryStock() {
		if (!api || !companyId) return;
		try {
			stock = await api.stock(companyId);
			stockFailed = false;
		} catch {
			stockFailed = true;
		}
	}

	$effect(() => {
		const target = companyId;
		untrack(() => start(target));
	});

	let summary = $derived(summarize({ financials, stock, stockFailed }));
	let table = $derived<Table | null>(financials?.tables.find((t) => t.statement === statement && t.basis === basis) ?? null);
	let bases = $derived([...new Set(financials?.tables.map((t) => t.basis) ?? [])]);
	let counted = $derived(financials?.filings.filter((f) => f.counted) ?? []);
	let results = $derived(financials?.filings.filter((f) => f.kind === 'financial_results') ?? []);
	let usedInPe = $derived(
		!!(selected && summary.epsCell && table && financials?.tables.indexOf(table) === summary.epsCell.tableIndex &&
			selected.r === summary.epsCell.row && selected.c === summary.epsCell.col)
	);

	async function select(pos: Pos) {
		selected = pos;
		if (!matchMedia('(min-width: 1024px)').matches) {
			await tick();
			document.getElementById(`${id}-panel`)?.focus();
		}
	}
	function back() {
		if (selected) document.getElementById(`${id}-table-${selected.r}-${selected.c}`)?.focus();
	}
	function choose(next: { statement?: StatementKind; basis?: ReportingBasis }) {
		statement = next.statement ?? statement;
		basis = next.basis ?? basis;
		selected = null;
	}
</script>
```

  Markup:
  - `load === 'loading'`: `<div aria-busy="true">` with a Hatch the size of the heading (`height="2.5rem" width="60%"`), a Hatch strip (`height="8rem"`), a Hatch table (`height="24rem"`), and `<p role="status">{copy.company.loading(null)}</p>`.
  - `load === 'not-found'`: `<h1>{copy.company.notFound.title}</h1>` and `<a href={resolve('/terminal/research')}>{copy.company.notFound.back}</a>`.
  - `load === 'failed'`: `<SectionIssue title={copy.company.financialsFailed.title} detail={copy.company.financialsFailed.detail} retryLabel={copy.company.financialsFailed.retry} onretry={() => start(companyId)} />`.
  - `load === 'ready'`:
    1. `<a class="back" href={resolve('/terminal/research')}>← {copy.company.back}</a>`; `<h1>{financials.company.displayName}</h1>` (the overview `h1` size from DESIGN §10); the identity line joining `NSE {nseSymbol}`, `BSE {bseCode}` and `CIN {cin}` where set, with " · "; then, when `counted.length`, `{copy.company.readFrom(counted.length)} {counted.map((f) => fyLabel(f.periodEnd ?? '')).join(', ')}.` (skip filings with no period).
    2. `<StockSummary {summary} {stock} name={financials.company.displayName} failed={stockFailed} onretry={retryStock} />`.
    3. `<section aria-labelledby="{id}-statements">` with `<h2 id="{id}-statements">{copy.statements.heading}</h2>`. When `counted.length === 0`: `<p>{copy.company.nothingRead(name)}</p>` and a link to `resolve('/terminal/documents')` with `copy.company.addInDocuments`. Otherwise: two toggle groups (`role="group"` with `aria-label`), buttons with `aria-pressed`, the pressed one an ink block: statements `income_statement`, `balance_sheet`, `cash_flow`; bases from `bases` in the order consolidated, standalone, unknown. Then a two-column layout (`.figures-layout`: one column below 1024px; `minmax(0, 1fr) 22.5rem` from 1024px, gap 24px):
       - Left: a line `{copy.statements.caption(bases label, kind label)}` with `{copy.statements.unit(unitWords(table.unit))}` on the right; `<StatementTable {table} filings={financials.filings} {selected} onselect={select} label={copy.statements.region(kind label)} />` (with `idPrefix="{id}-table"`); then the notes: `copy.statements.newestWins`, `copy.statements.unplaced(n)` when `table.unplaced > 0`, each `leftOut` entry with `copy.statements.leftOut[reason]` called with `filingLong(...)`, and `copy.company.notInTable(results names)` when `results.length`.
       - When `!table`: `<p>{copy.statements.notRead(basis label, kind label)}</p>`.
       - Right: `<FigurePanel {table} pos={selected} filings={financials.filings} pageHref={api!.pageHref} {usedInPe} headingId="{id}-panel" onback={back} />`.
  - Styles: the page column gap 32px (24px on phones); the sentence 19px; toggle buttons are `.button.outline` at 44px with `[aria-pressed='true']` as an ink block and `margin-left: -2px` between neighbours; nothing centred.

- [ ] **Step 7: Write `ResearchPage.svelte`.** Same loading pattern as `DocumentsPage` (`readMe` → first workspace → `researchApi(...).companies()`), states `loading` (three Hatch rows `height="2.75rem"` and `<p role="status">{copy.loading}</p>`), `failed` (SectionIssue with retry), `no-workspace` (SectionIssue without retry), `ready`. Ready markup: `<h1>{copy.heading}</h1>`, `<p>{copy.lede}</p>`; when no items, `<p>{copy.empty}</p>` and the Documents link; otherwise `<p class="muted">{copy.count(items.length)}</p>` and a `<table>` (in `.scroll-x` with `role="region"`, `aria-label`, `tabindex="0"`) with columns Company (the company link via `companyHref(item.company.id)` from `$lib/research/links`, with the eslint comment), Read from (`readFrom(item.annualReportsRead)`), Latest year (`item.latestPeriodEnd ? fyLabel(item.latestPeriodEnd) : '—'` with a visually hidden "no annual report read yet"), Where it stands (`standing(item)`). Under it: `{copy.missingCompany}` and a link to Documents with `copy.addFiling`. Table styles as `HoldingsTable`; four columns stack into rows below 640px container width, as the Earlier list does.

- [ ] **Step 8: The routes.** Replace `routes/terminal/research/+page.svelte` with:

```svelte
<script lang="ts">
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ResearchPage from '$lib/components/research/ResearchPage.svelte';
</script>

<SignedInPage page="research">
	<ResearchPage />
</SignedInPage>
```

Create `routes/terminal/research/company/+page.svelte` the same way with `CompanyPage`.

- [ ] **Step 9: "See the figures" on the slip.** Add `seeFigures: 'See the figures'` to `documentsContent.slip`. In `Slip.svelte`, inside the state chain before its closing `{/if}`, add:

```svelte
{:else if doc.intakeState === 'read' && !jobRunning && companyId}
	<p class="figures-link">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the id is known only at runtime; the path is resolve()d -->
		<a href={companyHref(companyId)}>{copy.slip.seeFigures}</a>
	</p>
```

Import `companyHref` from `$lib/research/links`.

- [ ] **Step 10: Run the whole web check.** `pnpm --dir apps/web verify`. Expected: PASS (svelte-check with no warnings, prettier, eslint, all tests including the design guard, the static build with `build/terminal/research/company.html`).

- [ ] **Step 11: Check it in a browser against a stub.** The real pages need a session and read data, which only the user has. Build a scratch stub in the session scratchpad (not the repo): a small Node server on port 8798 that answers `/api/auth/get-session` with a user, `/v1/me` with one workspace, `/v1/workspaces/:ws/research/companies`, `/companies/:id/financials`, `/companies/:id/stock` with the canvas figures (Synthetic Cements: three annual reports, the freight restatement, earnings per share; Harbour Cements with `not_tracked`), and `/documents/:id/file` with a 302 to any PDF. Run `API_PROXY_TARGET=http://localhost:8798 pnpm --dir apps/web dev --port 5175 --strictPort`. Compare with the canvas at 1440, 768 and 360: F1 (summary, chart, table, panel with earnings per share selected), F2 (phone, the panel under the table and focus moving to it), F3 (no price). Check: no page-wide sideways scroll at 360; arrow keys move between figures; "Open the PDF at page 213" opens a new tab; the Research rail item is current on both pages with no "Soon". Fix what differs. Stop the stub and Vite (both the pnpm wrapper and its child) and confirm with `ps -axo pid,command | grep -E "vite|8798"`.

- [ ] **Step 12: Commit.** `feat(web): working Research pages with a company's years and its stock`.

---

### Task 10: Docs, design record and the canvas kit

**Files:**
- Modify: `docs/DESIGN.md` (§5 components, §7 note, §10 Research), `docs/UI_SPECIFICATION.md` (§2 table, §7 note), `CONTRIBUTING.md` ("What exists today"), `docs/systems/api.md`, `docs/systems/web.md`, `docs/systems/packages.md`, `docs/EXTRACTION.md`, `apps/api/README.md` (routes, if listed there)
- Add: `.claude/skills/design-directions/assets/kit/financials.mjs`, `financials-notes.json`, `financials-heights.json`, and the README section (already written in the working tree)

- [ ] **Step 1: DESIGN.md §5.** Add these component entries after "Earlier list":
  - **Company list** (`ResearchPage`): the workspace's companies in a ledger, name first as an underlined link to the company page, then how many annual reports were read, the latest year and where it stands in words. Empty, it says how a company gets there.
  - **Stock summary** (`StockSummary`): "The stock and the business": one sentence filled in by rule from the figures, never by a model; a figure strip of last close (with the day's change as a sign), 52-week range (with a range ruler), price to earnings (the close ÷ the printed basic earnings per share, with its page) and profit for the latest year (with revenue and the change); then the last year's closes as a mood chart with low and high marked and "Show as a table". A price it doesn't have is "—" with the reason; with no price there is no chart.
  - **Range ruler** (`RangeRuler`): a 2px rule from the year's low to its high, ticks at the ends and a 6 by 18px block at the close. Drawing only.
  - **Statement table** (`StatementTable`): a ledger with the line names in a sticky first column and one column per financial year, oldest first, each headed by its year and the filing it comes from ("AR 2025–26"). Sections are row headers; subtotals bold. Each figure is a button: one tab stop, arrow keys move between figures, Home and End go to the ends of a row; the selected figure is an ink block. A dash printed on the page shows as "–"; a figure not printed or not readable is "—" with its reason. A restated year is named under its line in words.
  - **Figure panel** (`FigurePanel`): the selected figure: its line, statement, basis and period, the figure and its unit, then a spec list: From (filing and "Page 213 of 286"), Restated, On the page, Adds up, Used in, Reviewed ("Not yet"); and "Open the PDF at page 213", which opens the stored PDF in a new tab at that page. Beside the table from 1024px; below it on smaller screens, where choosing a figure moves focus to the panel and "Back to the table" returns it.
  - In **Mood chart**, add: "It also draws a share's year of closes on the Research summary, with a wider left gutter for rupee labels and the year's high marked too."
  - In **Coming-soon sketches**, remove the Research sketch ("Research: a filing-cabinet drawer holding one note, 'being sorted'.") and `CabinetSketch`, and change "Documents, Market mood and Settings work" to "Research, Documents, Market mood and Settings work".

- [ ] **Step 2: DESIGN.md §10.** In the rail paragraph, "A page that does not work yet (every page but Market mood, Research, Documents and Settings, for now)". In the routes sentence, list `/terminal/research` (and its company page) among the working pages and remove it from the coming-soon list. Add a paragraph:

  **Research.** `/terminal/research` lists the investor's companies; `/terminal/research/company?id=` is a company's page (the route is prerendered once, so the company travels in the query). It shows real figures under a real session, with no synthetic tag. One `h1`, the company's name, with its NSE, BSE and CIN, and the annual reports it was read from. Below it, in order: the stock summary; "Statements" with the statement and basis toggles; the statement table beside the figure panel from 1024px, stacked below that. Each year comes whole from the newest filing that prints it, so every column adds up; lines match across filings by printed name; a renamed line is two rows. Prices are the closes Maester keeps for Nifty 500 shares from the investor's Dhan data. The copy lives in `lib/content/research.ts` and the logic, tested and free of Svelte, in `lib/research/`.

- [ ] **Step 3: The rest of the docs.**
  - `UI_SPECIFICATION.md` §2 table, Research row: "R1 (built 13 Oct 2026 as `/terminal/research` and `/terminal/research/company?id=`)"; §7: add "Built so far: the Financials subview (years from annual reports, the figure panel) and a stock summary; Overview, Documents and Notes tabs are not built."
  - `CONTRIBUTING.md` "What exists today": add "See a company's statements year by year from its read annual reports, each figure with the page it came from and a link that opens the PDF there, with a summary of the stock from the investor's Dhan data." Add the Market mood and Settings line if missing. Remove "web screens for documents, facts" and "market data" from "Not yet implemented".
  - `docs/systems/api.md`: the four routes in the Routes table; a "Research" subsection under Operation (the stitching rule in three sentences, the stock states); `listCompanyFilings`, `listFactsWithSourcesForRevisions`, `listChecksForRevisions` in Tables/Data.
  - `docs/systems/packages.md`: the new db queries row and `research.ts` in contracts.
  - `docs/systems/web.md`: a "Research pages" subsection like "Market mood page".
  - `docs/EXTRACTION.md`: one line that the extract prompt asks for earnings per share lines (basic and diluted), and that the extractor gives a whole statement one unit, so readers of a per-share line use its printed value.
  - Run the STE checker the last docs task used, if present (`writing-ste` skill), on the changed system docs.

- [ ] **Step 4: Commit the docs and the kit.** `git add docs CONTRIBUTING.md apps/api/README.md .claude/skills/design-directions/assets/kit/financials.mjs .claude/skills/design-directions/assets/kit/financials-notes.json .claude/skills/design-directions/assets/kit/financials-heights.json .claude/skills/design-directions/assets/kit/README.md` then `git commit -s -m "docs: research pages, company financials and the financial tables canvas kit"`. Check `git status` shows nothing else staged.

---

### Task 11: Final check and push

- [ ] **Step 1: Every suite.** `pnpm lint && pnpm typecheck && pnpm test && pnpm --dir apps/web verify && uv run --locked python -m unittest discover -s tests -v`. Expected: all PASS. Record the counts.

- [ ] **Step 2: Whole-branch review.** Dispatch a final reviewer over the commits of this plan against the spec and the canvas; fix what it confirms, each fix with a test that failed first.

- [ ] **Step 3: Push.** `git push origin staging`.

- [ ] **Step 4: What the user still owes for a live run.** Report, without faking any of it:
  - Sign in and open Research. A company's statements appear once at least one annual report for it is read (Documents, with Vertex AI set up). Filings read before Task 1 have no earnings per share until "Read it again".
  - Prices need `CONNECTIONS_KEY`, the Dhan token in Settings, `apps/worker/data/nifty500.csv` and one `market:refresh` (still owed from Market mood). Until then the summary says why each price is missing.
