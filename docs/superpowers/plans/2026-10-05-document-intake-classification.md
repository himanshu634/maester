# Document intake classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work out what an uploaded PDF is (annual report, financial results, another company document, or not sure), for which company and period, with the page and words behind every answer; then read it, hold it or keep it, and let the investor confirm or change any answer.

**Architecture:** A deterministic rules engine plus a narrow model fallback live in `packages/financial-engine` (`pdf_financial_qa.classify`) and are served by a new `POST /v1/classify` on `apps/extractor`. `apps/worker` runs a new `document.classify` job between `document.verify` and `document.extract`; a shared `decideIntake` in `@maester/jobs` turns a classification into the next step. `apps/api` exposes the classification, a change endpoint and a re-run endpoint. Classifications are immutable rows with evidence rows; the newest is current.

**Tech Stack:** Python 3.11+ (pypdf, Pydantic 2, FastAPI, LangChain Gemini, unittest), TypeScript (Hono, Drizzle ORM + drizzle-kit, Zod 4, Vitest), Postgres, pnpm + turbo, uv.

**Spec:** `docs/superpowers/specs/2026-10-05-document-intake-classification-design.md` (read it first; this plan argues from it).

## Global Constraints

- Work lands on `staging` in the main checkout. No feature branch, no worktree, no pull request.
- Do not commit unless the user asks. Each task ends with its checks passing; the "Checkpoint" step replaces the usual commit step. Review each task by the diff of the files it lists, not the whole working tree.
- Tasks run one at a time: every TypeScript suite truncates the shared Postgres on port 5433.
- Commands use pnpm and uv, never Make. TypeScript tests need Postgres on `localhost:5433` (`pnpm db:up`). Python tests: `uv run --locked python -m unittest discover -s tests -v` from the repo root.
- Every new table carries `workspace_id`; every query filters on it.
- Decimals and quotes travel as strings; no document text is ever logged.
- Never accept an answer on a confidence score: an answer has a page and a quote that appears in that page's text layer (or the page has no text layer, then `textLayerMatch` is null), or it is "not sure".
- Size limit: `EXTRACT_MAX_BYTES` defaults to 52428800 (50 MiB) in the extractor and the worker, matching `MAX_UPLOAD_BYTES`. The services do not run on Cloud Run.
- Synthetic fixtures only; never commit a real filing.
- Rule ids, enum values and field names are exactly as written in this plan (they cross Python, Zod, Drizzle and SQL).

## Review Focus

1. **A document that is several things at once** (an annual report with the AGM notice bound in; a board-meeting outcome letter with results attached): expected to be read as the report or the results, never kept as "other". Pinned in Task 2 (`test_annual_report_with_bound_agm_notice`, `test_outcome_letter_with_results_attached`).
2. **A board-meeting intimation that only mentions the results it will consider**: expected to be kept as a board-meeting document, never sent to be read. Pinned in Task 2 (`test_intimation_letter_without_results_is_kept`).
3. **Exchange letterheads** ("BSE Limited", "National Stock Exchange of India Limited") on cover letters: never taken as the company's name. Pinned in Task 2 (`test_exchange_names_are_not_the_company`).
4. **Two tabs changing the same document** at once: the second must get `409`, not silently overwrite. Pinned in Task 9 (`rejects a stale basedOn with 409`).
5. **A change that only fixes the period**: must not read the document again and must not lose its current figures. Pinned in Task 9 (`changing only the period keeps the read and its figures`).
6. **A read that finishes after the investor changed the company**: its figures must not become current and must not flip the intake state. Pinned in Task 8 (`a superseded read does not mark the document read`).

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/financial-engine/src/pdf_financial_qa/classify/__init__.py` | Public API: `run_classification`, `RULES_VERSION`, `ClassificationModel`. |
| `…/classify/contracts.py` | Pydantic wire models for `/v1/classify`, mirroring Zod. |
| `…/classify/rules.py` | Deterministic rules over page texts → `RuleAnswers`. |
| `…/classify/model.py` | `ClassificationModel` protocol, questions/answers, Gemini implementation. |
| `…/classify/prompts.py` | The classify prompt and `PROMPT_VERSION`. |
| `…/classify/runner.py` | Rules → open questions → model → checks → `ClassificationResult`. |
| `apps/extractor/src/maester_extractor/app.py`, `settings.py` | `POST /v1/classify`, shared Vertex factory, 50 MiB default. |
| `packages/contracts/src/classification.ts` | Zod: wire format, API shapes, change request. |
| `packages/contracts/fixtures/classification/*.json` | Golden fixtures validated by Zod and Pydantic. |
| `packages/db/src/schema/classification.ts` | `document_classification`, `classification_evidence`, enums. |
| `packages/db/src/schema/platform.ts`, `extraction.ts` | Company identifiers, document intake columns, revision link. |
| `packages/db/src/queries/classification.ts` | Current classification, evidence, current revision, company matching, duplicates. |
| `packages/jobs/src/intake.ts` | `decideIntake`, read-job key helpers. |
| `apps/worker/src/extractor.ts` | `classify()` on the extractor client. |
| `apps/worker/src/jobs/document-classify.ts` | The `document.classify` handler and its failure hook. |
| `apps/worker/src/jobs/document-verify.ts`, `document-extract.ts`, `types.ts`, `run.ts` | Chain to classify, duplicates, revision link, final-failure hooks. |
| `apps/api/src/routes/classification.ts` | GET/POST classification, POST classify. |
| `apps/api/src/routes/documents.ts`, `serialize.ts`, `errors.ts` | Optional company on upload, intake fields, current revision. |

---

### Task 1: Classification wire contract and golden fixtures

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/classify/__init__.py` (empty for now: `"""Working out what a filing is (document intake)."""`)
- Create: `packages/financial-engine/src/pdf_financial_qa/classify/contracts.py`
- Create: `packages/contracts/src/classification.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/job.ts`, `packages/contracts/src/payloads.ts`
- Create: `packages/contracts/fixtures/classification/result-annual-report.json`, `result-not-sure.json`, `error-unreadable.json`
- Test: `packages/contracts/test/classification-fixtures.test.ts`, `tests/test_classification_contracts.py`

**Interfaces:**
- Produces (Python): `ClassificationResult`, `Evidence`, `StatementFound`, `ClassifyResult`, `ClassifyError`, `CLASSIFY_RESPONSE`, literals `Kind`, `OtherType`, `ResultsSpan`, `EvidenceField`.
- Produces (TS): `ClassificationKind`, `OtherType`, `ResultsSpan`, `EvidenceField`, `IntakeState`, `Cin`, `ClassifierEvidence`, `StatementFound`, `ClassificationResult`, `ClassifyResponse`, `Evidence`, `Classification`, `ClassificationSummary`, `DocumentClassification`, `ChangeClassificationRequest`, `ClassifyJobResponse`, `JobTypes.DOCUMENT_CLASSIFY = "document.classify"`, `DocumentClassifyResult`.

- [ ] **Step 1: Write the fixtures**

`packages/contracts/fixtures/classification/result-annual-report.json`:

```json
{
  "type": "result",
  "result": {
    "rulesVersion": "classify-rules-1",
    "model": null,
    "promptVersion": null,
    "pageCount": 3,
    "kind": "annual_report",
    "otherType": null,
    "resultsSpan": null,
    "periodEnd": "2026-03-31",
    "periodLabel": "Year ended 31 March 2026",
    "companyNameAsPrinted": "Synthetic Cements Limited",
    "cin": "L26940MH2001PLC123456",
    "bseCode": "532123",
    "nseSymbol": "SYNCEM",
    "statementsFound": [{ "statement": "balance_sheet", "basis": "standalone", "pages": [2] }],
    "evidence": [
      { "field": "kind", "source": "rule", "ruleId": "title.annual_report", "pageIndex": 0, "quote": "Integrated Annual Report 2025-26", "textLayerMatch": true },
      { "field": "company", "source": "rule", "ruleId": "company.cover_line", "pageIndex": 0, "quote": "Synthetic Cements Limited", "textLayerMatch": true },
      { "field": "identifier", "source": "rule", "ruleId": "identifier.cin", "pageIndex": 0, "quote": "CIN: L26940MH2001PLC123456", "textLayerMatch": true },
      { "field": "period", "source": "rule", "ruleId": "period.span", "pageIndex": 2, "quote": "Statement of Profit and Loss for the year ended 31 March 2026", "textLayerMatch": true },
      { "field": "statements", "source": "rule", "ruleId": "statement.balance_sheet", "pageIndex": 2, "quote": "Standalone Balance Sheet as at 31 March 2026", "textLayerMatch": true }
    ],
    "warnings": []
  }
}
```

`result-not-sure.json`:

```json
{
  "type": "result",
  "result": {
    "rulesVersion": "classify-rules-1",
    "model": "scripted-model",
    "promptVersion": "classify-000000000000",
    "pageCount": 1,
    "kind": "not_sure",
    "otherType": null,
    "resultsSpan": null,
    "periodEnd": null,
    "periodLabel": null,
    "companyNameAsPrinted": null,
    "cin": null,
    "bseCode": null,
    "nseSymbol": null,
    "statementsFound": [],
    "evidence": [],
    "warnings": [{ "code": "MODEL_ANSWER_DROPPED", "message": "1 answer(s) could not be checked against the document and were left open" }]
  }
}
```

`error-unreadable.json`:

```json
{ "type": "error", "code": "UNREADABLE_PDF", "retryable": false, "message": "the PDF could not be read: PdfReadError" }
```

- [ ] **Step 2: Write the failing tests**

`packages/contracts/test/classification-fixtures.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChangeClassificationRequest, ClassifyResponse } from "../src/index.js";

// tests/test_classification_contracts.py validates the same files with Pydantic.
const dir = new URL("../fixtures/classification/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("classifier fixtures", () => {
  it("exist", () => expect(files.length).toBe(3));
  for (const file of files) {
    it(`${file} is a ClassifyResponse`, () => {
      expect(ClassifyResponse.safeParse(JSON.parse(readFileSync(new URL(file, dir), "utf8"))).success).toBe(true);
    });
  }
  it("rejects a quote over 300 characters", () => {
    const body = JSON.parse(readFileSync(new URL("result-annual-report.json", dir), "utf8"));
    body.result.evidence[0].quote = "x".repeat(301);
    expect(ClassifyResponse.safeParse(body).success).toBe(false);
  });
});

describe("ChangeClassificationRequest", () => {
  const basedOn = "00000000-0000-4000-8000-000000000000";
  it("needs at least one change", () => {
    expect(ChangeClassificationRequest.safeParse({ basedOn }).success).toBe(false);
  });
  it("refuses not_sure as an investor answer", () => {
    expect(ChangeClassificationRequest.safeParse({ basedOn, kind: "not_sure" }).success).toBe(false);
  });
  it("accepts a new company with identifiers", () => {
    const r = ChangeClassificationRequest.safeParse({
      basedOn,
      company: { new: { displayName: "Synthetic Cements Limited", country: "IN", cin: "L26940MH2001PLC123456", bseCode: "532123", nseSymbol: "SYNCEM" } },
    });
    expect(r.success).toBe(true);
  });
  it("rejects a malformed CIN", () => {
    const r = ChangeClassificationRequest.safeParse({ basedOn, company: { new: { displayName: "X Ltd", country: "IN", cin: "123" } } });
    expect(r.success).toBe(false);
  });
});
```

`tests/test_classification_contracts.py`:

```python
"""The classifier's Pydantic wire models accept the same golden fixtures as the Zod schemas.

packages/contracts/test/classification-fixtures.test.ts validates these files with Zod.
"""

import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from pdf_financial_qa.classify.contracts import CLASSIFY_RESPONSE

FIXTURES = Path(__file__).resolve().parents[1] / "packages" / "contracts" / "fixtures" / "classification"


class ClassificationFixtureTests(unittest.TestCase):
    def test_every_fixture_parses_and_round_trips(self):
        paths = sorted(FIXTURES.glob("*.json"))
        self.assertEqual(len(paths), 3)
        for path in paths:
            raw = json.loads(path.read_text())
            with self.subTest(file=path.name):
                self.assertEqual(CLASSIFY_RESPONSE.validate_python(raw).to_wire(), raw)

    def test_unknown_fields_and_bad_values_are_rejected(self):
        raw = json.loads((FIXTURES / "result-annual-report.json").read_text())
        raw["result"]["kind"] = "brochure"
        with self.assertRaises(ValidationError):
            CLASSIFY_RESPONSE.validate_python(raw)
        raw = json.loads((FIXTURES / "error-unreadable.json").read_text())
        raw["extra"] = 1
        with self.assertRaises(ValidationError):
            CLASSIFY_RESPONSE.validate_python(raw)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @maester/contracts test` → FAIL (`ClassifyResponse` is not exported).
Run: `uv run --locked python -m unittest tests.test_classification_contracts -v` → FAIL (`ModuleNotFoundError: pdf_financial_qa.classify.contracts`).

- [ ] **Step 4: Write the Python contract**

`packages/financial-engine/src/pdf_financial_qa/classify/contracts.py`:

```python
"""Classifier wire format. Mirrors ``packages/contracts/src/classification.ts``.

Both definitions validate the golden fixtures in
``packages/contracts/fixtures/classification``, so they cannot drift apart.
"""

from datetime import date
from typing import Annotated, Literal, Union

from pydantic import Field, TypeAdapter

from pdf_financial_qa.workflow.contracts import ExtractionWarning, ReportingBasis, StatementKind, WireModel

Kind = Literal["annual_report", "financial_results", "other", "not_sure"]
OtherType = Literal[
    "shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
    "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type",
]
ResultsSpan = Literal["quarter", "half_year", "nine_months", "full_year"]
EvidenceField = Literal["kind", "other_type", "company", "identifier", "period", "results_span", "statements"]


class Evidence(WireModel):
    field: EvidenceField
    source: Literal["rule", "model"]
    rule_id: str | None
    page_index: Annotated[int, Field(ge=0)]
    quote: Annotated[str, Field(min_length=1, max_length=300)]
    text_layer_match: bool | None


class StatementFound(WireModel):
    statement: StatementKind
    basis: ReportingBasis
    pages: list[Annotated[int, Field(ge=0)]]


class ClassificationResult(WireModel):
    rules_version: str
    model: str | None
    prompt_version: str | None
    page_count: Annotated[int, Field(ge=1)]
    kind: Kind
    other_type: OtherType | None
    results_span: ResultsSpan | None
    period_end: date | None
    period_label: str | None
    company_name_as_printed: str | None
    cin: str | None
    bse_code: str | None
    nse_symbol: str | None
    statements_found: list[StatementFound]
    evidence: list[Evidence]
    warnings: list[ExtractionWarning]


class ClassifyResult(WireModel):
    type: Literal["result"] = "result"
    result: ClassificationResult


class ClassifyError(WireModel):
    type: Literal["error"] = "error"
    code: str
    retryable: bool
    message: str


CLASSIFY_RESPONSE = TypeAdapter(Annotated[Union[ClassifyResult, ClassifyError], Field(discriminator="type")])
```

- [ ] **Step 5: Write the Zod contract**

`packages/contracts/src/classification.ts`:

```ts
import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";
import { CountryCode } from "./company.js";
import { ExtractionWarning, IsoDate, ReportingBasis, StatementKind } from "./extraction.js";
import { Job } from "./job.js";

export const ClassificationKind = z.enum(["annual_report", "financial_results", "other", "not_sure"]);
export type ClassificationKind = z.infer<typeof ClassificationKind>;
export const OtherType = z.enum([
  "shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
  "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type",
]);
export type OtherType = z.infer<typeof OtherType>;
export const ResultsSpan = z.enum(["quarter", "half_year", "nine_months", "full_year"]);
export type ResultsSpan = z.infer<typeof ResultsSpan>;
export const EvidenceField = z.enum(["kind", "other_type", "company", "identifier", "period", "results_span", "statements"]);
export type EvidenceField = z.infer<typeof EvidenceField>;
export const IntakeState = z.enum([
  "identifying", "duplicate", "needs_company", "needs_kind", "kept", "reading", "read", "identify_failed", "read_failed",
]);
export type IntakeState = z.infer<typeof IntakeState>;
/** A company's corporate identity number as printed on Indian filings. */
export const Cin = z.string().regex(/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, "a 21-character CIN");
export const BseCode = z.string().regex(/^\d{6}$/, "a six-digit BSE code");
export const NseSymbol = z.string().regex(/^[A-Z][A-Z0-9&-]{0,19}$/, "an NSE symbol");

// ---- Extractor wire format (POST /v1/classify). Mirrors pdf_financial_qa.classify.contracts. ----
export const ClassifierEvidence = z.object({
  field: EvidenceField,
  source: z.enum(["rule", "model"]),
  ruleId: z.string().nullable(),
  pageIndex: z.number().int().min(0),
  quote: z.string().min(1).max(300),
  textLayerMatch: z.boolean().nullable(),
});
export const StatementFound = z.object({ statement: StatementKind, basis: ReportingBasis, pages: z.array(z.number().int().min(0)) });
export type StatementFound = z.infer<typeof StatementFound>;
export const ClassificationResult = z.object({
  rulesVersion: z.string(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  pageCount: z.number().int().min(1),
  kind: ClassificationKind,
  otherType: OtherType.nullable(),
  resultsSpan: ResultsSpan.nullable(),
  periodEnd: IsoDate.nullable(),
  periodLabel: z.string().nullable(),
  companyNameAsPrinted: z.string().nullable(),
  cin: z.string().nullable(),
  bseCode: z.string().nullable(),
  nseSymbol: z.string().nullable(),
  statementsFound: z.array(StatementFound),
  evidence: z.array(ClassifierEvidence),
  warnings: z.array(ExtractionWarning),
});
export type ClassificationResult = z.infer<typeof ClassificationResult>;
export const ClassifyResponse = z.discriminatedUnion("type", [
  z.object({ type: z.literal("result"), result: ClassificationResult }),
  z.object({ type: z.literal("error"), code: z.string(), retryable: z.boolean(), message: z.string() }),
]);
export type ClassifyResponse = z.infer<typeof ClassifyResponse>;

// ---- API shapes ----
export const Evidence = z.object({
  field: EvidenceField,
  source: z.enum(["rule", "model", "investor"]),
  ruleId: z.string().nullable(),
  pageIndex: z.number().int().min(0).nullable(),
  quote: z.string().nullable(),
  textLayerMatch: z.boolean().nullable(),
});
export type Evidence = z.infer<typeof Evidence>;
export const Classification = z.object({
  id: Uuid,
  documentId: Uuid,
  kind: ClassificationKind,
  otherType: OtherType.nullable(),
  resultsSpan: ResultsSpan.nullable(),
  periodEnd: IsoDate.nullable(),
  periodLabel: z.string().nullable(),
  companyId: Uuid.nullable(),
  companyNameAsPrinted: z.string().nullable(),
  cin: z.string().nullable(),
  bseCode: z.string().nullable(),
  nseSymbol: z.string().nullable(),
  statementsFound: z.array(StatementFound),
  setBy: z.enum(["maester", "investor"]),
  readsUnderId: Uuid.nullable(),
  warnings: z.array(ExtractionWarning),
  createdAt: IsoTimestamp,
});
export type Classification = z.infer<typeof Classification>;
export const ClassificationSummary = Classification.pick({
  id: true, kind: true, otherType: true, resultsSpan: true, periodLabel: true, companyId: true, companyNameAsPrinted: true, setBy: true,
});
export type ClassificationSummary = z.infer<typeof ClassificationSummary>;
export const DocumentClassification = z.object({ classification: Classification, evidence: z.array(Evidence) });
export type DocumentClassification = z.infer<typeof DocumentClassification>;

export const ChangeClassificationRequest = z
  .object({
    basedOn: Uuid,
    kind: z.enum(["annual_report", "financial_results", "other"]).optional(),
    otherType: OtherType.nullable().optional(),
    resultsSpan: ResultsSpan.nullable().optional(),
    periodEnd: IsoDate.nullable().optional(),
    periodLabel: z.string().trim().min(1).max(200).nullable().optional(),
    company: z
      .union([
        z.object({ id: Uuid }),
        z.object({
          new: z.object({
            displayName: z.string().trim().min(1).max(200),
            country: CountryCode,
            cin: Cin.optional(),
            bseCode: BseCode.optional(),
            nseSymbol: NseSymbol.optional(),
          }),
        }),
      ])
      .optional(),
  })
  .refine(
    (r) => [r.kind, r.otherType, r.resultsSpan, r.periodEnd, r.periodLabel, r.company].some((v) => v !== undefined),
    { message: "change at least one answer" },
  );
export type ChangeClassificationRequest = z.infer<typeof ChangeClassificationRequest>;

export const ClassifyJobResponse = z.object({ job: Job });
export type ClassifyJobResponse = z.infer<typeof ClassifyJobResponse>;
```

In `packages/contracts/src/job.ts` change `JobTypes` to:

```ts
export const JobTypes = {
  DOCUMENT_VERIFY: "document.verify",
  DOCUMENT_CLASSIFY: "document.classify",
  DOCUMENT_EXTRACT: "document.extract",
} as const;
```

Append to `packages/contracts/src/payloads.ts`:

```ts
import { ClassificationKind, IntakeState } from "./classification.js";

export const DocumentClassifyResult = z.object({
  outcome: z.literal("classified"),
  classificationId: Uuid,
  kind: ClassificationKind,
  intakeState: IntakeState.nullable(),
});
export type DocumentClassifyResult = z.infer<typeof DocumentClassifyResult>;
```

(put the new import with the file's other imports at the top). In `packages/contracts/src/index.ts` add `export * from "./classification.js";` after the `extraction.js` line.

- [ ] **Step 6: Run both to verify they pass**

Run: `pnpm --filter @maester/contracts test && pnpm --filter @maester/contracts typecheck` → PASS.
Run: `uv run --locked python -m unittest tests.test_classification_contracts -v` → PASS.

- [ ] **Step 7: Checkpoint** — the diff of this task's listed files is all this task changed; nothing committed.

---

### Task 2: The rules engine

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/classify/rules.py`
- Test: `tests/test_classification_rules.py`

**Interfaces:**
- Consumes: `parse_label_date(label: str) -> date | None` from `pdf_financial_qa.workflow.values`.
- Produces: `RULES_VERSION = "classify-rules-1"`, `TITLE_PAGES = 5`, `QUOTE_MAX = 300`, `READ_KINDS`, `@dataclass Hit(field, value, rule_id, page_index, quote)`, `@dataclass RuleAnswers` (fields below), `classify_text(page_texts: list[str]) -> RuleAnswers`, `normalise(text: str) -> str`.

`RuleAnswers` fields: `kind: str | None`, `kind_conflict: bool`, `other_type: str | None`, `results_span: str | None`, `period_label: str | None`, `period_end: date | None`, `company_name: str | None`, `cin: str | None`, `bse_code: str | None`, `nse_symbol: str | None`, `statements: dict[tuple[str, str], list[int]]`, `evidence: list[Hit]`, and the property `pointed_pages -> list[int]`.

- [ ] **Step 1: Write the failing tests**

`tests/test_classification_rules.py`:

```python
"""Deterministic classification rules over page texts. Offline; synthetic text only."""

import unittest
from datetime import date

from pdf_financial_qa.classify.rules import RULES_VERSION, classify_text, normalise


def evidence_for(answers, field):
    return [h for h in answers.evidence if h.field == field]


class RulesTests(unittest.TestCase):
    def test_annual_report(self):
        pages = [
            "Synthetic Cements Limited\nIntegrated Annual Report 2025-26\nCIN: L26940MH2001PLC123456",
            "Contents",
            "Standalone Balance Sheet as at 31 March 2026\nStatement of Profit and Loss for the year ended 31 March 2026",
        ]
        a = classify_text(pages)
        self.assertEqual(RULES_VERSION, "classify-rules-1")
        self.assertEqual(a.kind, "annual_report")
        self.assertFalse(a.kind_conflict)
        self.assertEqual(a.company_name, "Synthetic Cements Limited")
        self.assertEqual(a.cin, "L26940MH2001PLC123456")
        self.assertEqual(a.period_label, "Year ended 31 March 2026")
        self.assertEqual(a.period_end, date(2026, 3, 31))
        self.assertIsNone(a.results_span)
        self.assertEqual(a.statements[("balance_sheet", "standalone")], [2])
        kind = evidence_for(a, "kind")[0]
        self.assertEqual((kind.rule_id, kind.page_index), ("title.annual_report", 0))
        self.assertIn(normalise(kind.quote), normalise(pages[0]))

    def test_quarterly_results_with_exchange_codes(self):
        pages = ["Synthetic Power Limited\nScrip Code: 532123\nSymbol: SYNPOWER\n"
                 "Statement of Unaudited Standalone Financial Results for the Quarter ended 30 June 2026"]
        a = classify_text(pages)
        self.assertEqual(a.kind, "financial_results")
        self.assertEqual(a.results_span, "quarter")
        self.assertEqual(a.period_end, date(2026, 6, 30))
        self.assertEqual(a.period_label, "Quarter ended 30 June 2026")
        self.assertEqual((a.bse_code, a.nse_symbol), ("532123", "SYNPOWER"))
        self.assertEqual(a.statements[("income_statement", "standalone")], [0])

    def test_quarter_and_year_is_full_year(self):
        a = classify_text(["Statement of Audited Financial Results for the Quarter and Year ended 31 March 2026"])
        self.assertEqual((a.kind, a.results_span, a.period_end), ("financial_results", "full_year", date(2026, 3, 31)))

    def test_shareholding_pattern_is_kept_as_other(self):
        a = classify_text(["Synthetic Foods Limited\nShareholding Pattern under Regulation 31\nQuarter ended 30 June 2026"])
        self.assertEqual((a.kind, a.other_type), ("other", "shareholding_pattern"))
        self.assertIsNone(a.period_label)

    def test_outcome_letter_with_results_attached(self):
        pages = ["Outcome of Board Meeting held on 12 August 2026",
                 "Statement of Unaudited Consolidated Financial Results for the Quarter ended 30 June 2026"]
        a = classify_text(pages)
        self.assertEqual(a.kind, "financial_results")
        self.assertIsNone(a.other_type)

    def test_intimation_letter_without_results_is_kept(self):
        a = classify_text(["Synthetic Foods Limited\nIntimation of Board Meeting\n"
                           "The Board will meet to consider and approve the Unaudited Financial Results "
                           "for the quarter ended 30 June 2026"])
        self.assertEqual((a.kind, a.other_type), ("other", "board_meeting"))
        self.assertEqual(a.statements, {})

    def test_annual_report_with_bound_agm_notice(self):
        pages = ["Synthetic Cements Limited\nAnnual Report 2025-26",
                 "Notice is hereby given that the 25th Annual General Meeting of the members",
                 "Consolidated Balance Sheet as at 31 March 2026"]
        a = classify_text(pages)
        self.assertEqual(a.kind, "annual_report")

    def test_two_titles_on_one_page_are_a_conflict(self):
        a = classify_text(["Investor Presentation\nPress Release"])
        self.assertIsNone(a.kind)
        self.assertTrue(a.kind_conflict)
        self.assertEqual(evidence_for(a, "kind"), [])

    def test_nothing_recognised_leaves_the_kind_open(self):
        a = classify_text(["A page of prose with no title we know."])
        self.assertIsNone(a.kind)
        self.assertFalse(a.kind_conflict)

    def test_statements_without_a_title_are_a_conflict(self):
        a = classify_text(["Standalone Balance Sheet as at 31 March 2026"])
        self.assertIsNone(a.kind)
        self.assertTrue(a.kind_conflict)

    def test_exchange_names_are_not_the_company(self):
        a = classify_text(["To\nBSE Limited\nNational Stock Exchange of India Limited\nSynthetic Foods Limited\nPress Release"])
        self.assertEqual(a.company_name, "Synthetic Foods Limited")

    def test_titles_after_page_five_are_ignored(self):
        pages = ["Cover", "", "", "", "", "Shareholding Pattern"]
        self.assertIsNone(classify_text(pages).kind)

    def test_pointed_pages_are_the_pages_with_evidence(self):
        a = classify_text(["Annual Report 2025-26", "x", "Standalone Balance Sheet as at 31 March 2026"])
        self.assertEqual(a.pointed_pages, [0, 2])

    def test_quotes_are_single_lines_at_most_300_characters(self):
        a = classify_text(["Synthetic Cements Limited " + "word " * 100 + "\nAnnual Report 2025-26"])
        for hit in a.evidence:
            self.assertLessEqual(len(hit.quote), 300)
            self.assertNotIn("\n", hit.quote)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --locked python -m unittest tests.test_classification_rules -v` → FAIL (`No module named 'pdf_financial_qa.classify.rules'`).

- [ ] **Step 3: Write the rules**

`packages/financial-engine/src/pdf_financial_qa/classify/rules.py`:

```python
"""Deterministic rules that work out what a filing is from its text layer.

Every hit records the rule, the page and the line it matched, so each answer can
show where it came from. Rules never guess: rules that disagree about the kind
leave it for the model.
"""

import re
from dataclasses import dataclass, field
from datetime import date

from pdf_financial_qa.workflow.values import parse_label_date

RULES_VERSION = "classify-rules-1"
TITLE_PAGES = 5
QUOTE_MAX = 300
READ_KINDS = ("annual_report", "financial_results")

_I = re.IGNORECASE
DATE = r"(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})"

CIN = re.compile(r"\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b")
BSE = re.compile(r"(?i:scrip\s+code|security\s+code|bse(?:\s+(?:scrip\s+)?code)?)\s*(?:no\.?)?\s*[:\-–]?\s*(\d{6})\b")
NSE = re.compile(r"(?i:nse\s+symbol|symbol|nse)\s*[:\-–]\s*([A-Z][A-Z0-9&\-]{1,19})\b")
COMPANY = re.compile(r"^\s*([A-Z][A-Za-z0-9&.,'()\- ]{1,80}?\s(?:Limited|LIMITED|Ltd\.?|LTD\.?))\s*$", re.MULTILINE)
NOT_A_COMPANY = re.compile(r"stock\s+exchange|\bbse\s+limited\b|depository|registrar|link\s+intime|kfin", _I)

# (value, rule_id, pattern). A value is a kind, or "other:<other_type>".
KIND_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    ("annual_report", "title.annual_report", re.compile(
        r"\b(?:integrated\s+)?annual\s+report(?:\s+and\s+accounts)?\s+(?:20\d{2}\s*[-–/]\s*(?:20)?\d{2}|fy\s*'?\d{2,4})", _I)),
    ("annual_report", "title.integrated_annual_report", re.compile(r"\bintegrated\s+annual\s+report\b", _I)),
    # The heading form only: a board-meeting letter that mentions "the financial results for the
    # quarter" in a sentence is not a results document.
    ("financial_results", "title.financial_results", re.compile(
        r"^\s*statement\s+of\s+(?:audited|unaudited|reviewed)?\s*(?:standalone|consolidated)?\s*"
        r"(?:and\s+(?:standalone|consolidated)\s+)?financial\s+results\s+for\s+the\s+"
        r"(?:quarter|half[\s-]year|six\s+months|nine\s+months|year|period)", _I | re.M)),
    ("financial_results", "title.regulation_33", re.compile(r"\bregulation\s+33\b", _I)),
    ("financial_results", "title.integrated_filing_financial", re.compile(r"\bintegrated\s+filing\s*\(?\s*financial", _I)),
    ("other:shareholding_pattern", "title.shareholding_pattern", re.compile(r"\bshareholding\s+pattern\b|\bregulation\s+31\b", _I)),
    ("other:shareholder_notice", "title.shareholder_notice", re.compile(
        r"\bnotice\s+is\s+hereby\s+given\b.{0,200}?\b(?:annual\s+general\s+meeting|extra[\s-]?ordinary\s+general\s+meeting|postal\s+ballot)",
        _I | re.DOTALL)),
    ("other:board_meeting", "title.board_meeting_intimation", re.compile(
        r"\bintimation\s+of\s+(?:the\s+)?board\s+meeting\b|\bregulation\s+29\b", _I)),
    ("other:board_meeting", "title.board_meeting_outcome", re.compile(r"\boutcome\s+of\s+(?:the\s+)?board\s+meeting\b", _I)),
    ("other:investor_presentation", "title.investor_presentation", re.compile(r"\binvestor\s+presentation\b", _I)),
    ("other:earnings_call", "title.earnings_call", re.compile(
        r"\btranscript\b.{0,80}?\b(?:earnings|conference)\s+call\b|\b(?:earnings|conference)\s+call\s+transcript\b", _I | re.DOTALL)),
    ("other:governance_filing", "title.governance_filing", re.compile(
        r"\bcorporate\s+governance\s+report\b|\bintegrated\s+filing\s*\(?\s*governance|\bregulation\s+27\b", _I)),
    ("other:announcement", "title.press_release", re.compile(r"\bpress\s+release\b", _I)),
    ("other:offer_document", "title.offer_document", re.compile(
        r"\b(?:draft\s+)?red\s+herring\s+prospectus\b|\bletter\s+of\s+offer\b|\bprospectus\b", _I)),
]

STATEMENT_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    ("balance_sheet", "statement.balance_sheet", re.compile(
        r"^\s*(?:(standalone|consolidated)\s+)?(?:balance\s+sheet\s+as\s+at|statement\s+of\s+assets\s+and\s+liabilities)\b", _I | re.M)),
    ("income_statement", "statement.profit_and_loss", re.compile(
        r"^\s*(?:(standalone|consolidated)\s+)?statement\s+of\s+profit\s+and\s+loss\b", _I | re.M)),
    ("cash_flow", "statement.cash_flow", re.compile(
        r"^\s*(?:(standalone|consolidated)\s+)?(?:statement\s+of\s+cash\s+flows?|cash\s+flow\s+statement)\s+for\s+the\b", _I | re.M)),
]
MAX_STATEMENT_PAGES = 6

SPAN = re.compile(
    rf"\b(quarter\s+and\s+(?:financial\s+)?year|quarter|half[\s-]year|six\s+months|nine\s+months|(?:financial\s+)?year)\s+ended\s+(?:on\s+)?({DATE})", _I)
SPAN_VALUES = {"quarter": "quarter", "half year": "half_year", "six months": "half_year",
               "nine months": "nine_months", "year": "full_year", "financial year": "full_year"}
AS_AT = re.compile(rf"\bas\s+at\s+({DATE})", _I)


@dataclass(frozen=True)
class Hit:
    field: str
    value: str
    rule_id: str
    page_index: int
    quote: str


@dataclass
class RuleAnswers:
    kind: str | None = None
    kind_conflict: bool = False
    other_type: str | None = None
    results_span: str | None = None
    period_label: str | None = None
    period_end: date | None = None
    company_name: str | None = None
    cin: str | None = None
    bse_code: str | None = None
    nse_symbol: str | None = None
    statements: dict[tuple[str, str], list[int]] = field(default_factory=dict)
    evidence: list[Hit] = field(default_factory=list)

    @property
    def pointed_pages(self) -> list[int]:
        return sorted({h.page_index for h in self.evidence})


def normalise(text: str) -> str:
    """Whitespace-collapsed, case-folded text, for comparing a quote with its page."""
    return " ".join(text.split()).casefold()


def _quote(text: str, match: re.Match[str]) -> str:
    """The line the match sits on, whitespace collapsed; the match alone if the line is too long."""
    start = text.rfind("\n", 0, match.start()) + 1
    end = text.find("\n", match.end())
    line = " ".join(text[start:end if end != -1 else len(text)].split())
    if len(line) > QUOTE_MAX:
        line = " ".join(match.group(0).split())[:QUOTE_MAX]
    return line


def _basis(match: re.Match[str], page: str) -> str:
    word = (match.group(1) or "").lower() if match.lastindex else ""
    if word:
        return word
    lowered = page.lower()
    has_standalone, has_consolidated = "standalone" in lowered, "consolidated" in lowered
    if has_standalone != has_consolidated:
        return "standalone" if has_standalone else "consolidated"
    return "unknown"


def _span_value(words: str) -> str:
    key = re.sub(r"[\s-]+", " ", words.lower()).strip()
    if key.startswith("quarter and"):
        return "full_year"
    return SPAN_VALUES[key]


def _label(text: str) -> str:
    text = " ".join(text.split())
    return text[:1].upper() + text[1:]


def _identifiers(pages: list[str], a: RuleAnswers) -> None:
    for attr, rule_id, pattern in (("cin", "identifier.cin", CIN), ("bse_code", "identifier.bse", BSE),
                                   ("nse_symbol", "identifier.nse", NSE)):
        for index, page in enumerate(pages):
            match = pattern.search(page)
            if match:
                setattr(a, attr, match.group(1))
                a.evidence.append(Hit("identifier", match.group(1), rule_id, index, _quote(page, match)))
                break


def _company(pages: list[str], a: RuleAnswers) -> None:
    title = pages[:TITLE_PAGES]
    cin_pages = [h.page_index for h in a.evidence if h.rule_id == "identifier.cin" and h.page_index < TITLE_PAGES]
    order = cin_pages + [i for i in range(len(title)) if i not in cin_pages]
    for index in order:
        for match in COMPANY.finditer(title[index]):
            name = " ".join(match.group(1).split())
            if NOT_A_COMPANY.search(name):
                continue
            a.company_name = name
            a.evidence.append(Hit("company", name, "company.cover_line", index, _quote(title[index], match)))
            return


def _statements(pages: list[str], a: RuleAnswers) -> None:
    first_hit: dict[tuple[str, str], Hit] = {}
    for index, page in enumerate(pages):
        for statement, rule_id, pattern in STATEMENT_RULES:
            for match in pattern.finditer(page):
                key = (statement, _basis(match, page))
                found = a.statements.setdefault(key, [])
                if index not in found and len(found) < MAX_STATEMENT_PAGES:
                    found.append(index)
                first_hit.setdefault(key, Hit("statements", f"{key[0]}:{key[1]}", rule_id, index, _quote(page, match)))
    a.evidence.extend(first_hit.values())


def _kind(pages: list[str], a: RuleAnswers) -> list[Hit]:
    hits: list[Hit] = []
    for index, page in enumerate(pages[:TITLE_PAGES]):
        for value, rule_id, pattern in KIND_RULES:
            match = pattern.search(page)
            if match:
                hits.append(Hit("kind", value, rule_id, index, _quote(page, match)))
                if value == "financial_results" and rule_id == "title.financial_results":
                    key = ("income_statement", _basis(match, page))
                    if index not in a.statements.setdefault(key, []):
                        a.statements[key].append(index)
    return hits


def _resolve_kind(hits: list[Hit], a: RuleAnswers) -> None:
    chosen: str | None = None
    if a.statements:
        read = {h.value for h in hits if h.value in READ_KINDS}
        if len(read) == 1:
            chosen = read.pop()
        else:
            a.kind_conflict = True
    elif hits:
        first_page = min(h.page_index for h in hits)
        on_first = {h.value for h in hits if h.page_index == first_page}
        if len(on_first) == 1:
            chosen = on_first.pop()
        else:
            a.kind_conflict = True
    if chosen is None:
        return
    support = next(h for h in hits if h.value == chosen)
    if chosen.startswith("other:"):
        a.kind, a.other_type = "other", chosen.split(":", 1)[1]
        a.evidence.append(Hit("kind", "other", support.rule_id, support.page_index, support.quote))
        a.evidence.append(Hit("other_type", a.other_type, support.rule_id, support.page_index, support.quote))
    else:
        a.kind = chosen
        a.evidence.append(Hit("kind", chosen, support.rule_id, support.page_index, support.quote))


def _period(pages: list[str], a: RuleAnswers) -> None:
    if a.kind not in READ_KINDS:
        return
    scope = pages[:TITLE_PAGES] if a.kind == "financial_results" else pages
    matches = [(index, m) for index, page in enumerate(scope) for m in SPAN.finditer(page)]
    if a.kind == "annual_report":
        matches = [(i, m) for i, m in matches if _span_value(m.group(1)) == "full_year"]
    else:
        full = [(i, m) for i, m in matches if m.group(1).lower().startswith("quarter and")]
        matches = full or matches
    if matches:
        index, match = matches[0]
        label = _label(f"{match.group(1)} ended {match.group(2)}")
        a.period_label, a.period_end = label, parse_label_date(label)
        a.evidence.append(Hit("period", label, "period.span", index, _quote(scope[index], match)))
        if a.kind == "financial_results":
            a.results_span = _span_value(match.group(1))
            a.evidence.append(Hit("results_span", a.results_span, "period.span", index, _quote(scope[index], match)))
        return
    for index, page in enumerate(pages):
        match = AS_AT.search(page)
        if match:
            label = _label(f"as at {match.group(1)}")
            a.period_label, a.period_end = label, parse_label_date(label)
            a.evidence.append(Hit("period", label, "period.as_at", index, _quote(page, match)))
            return


def classify_text(page_texts: list[str]) -> RuleAnswers:
    """Answer what the rules can from the page texts; leave the rest open."""
    a = RuleAnswers()
    _identifiers(page_texts, a)
    _company(page_texts, a)
    _statements(page_texts, a)
    _resolve_kind(_kind(page_texts, a), a)
    _period(page_texts, a)
    return a
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --locked python -m unittest tests.test_classification_rules -v` → PASS. If `parse_label_date` returns `None` for "Year ended 31 March 2026", read `values.py:86` and pass it the date part only (`match.group(2)`) instead of the label.

- [ ] **Step 5: Checkpoint** — run the whole Python suite (`uv run --locked python -m unittest discover -s tests -v`) → PASS.

---

### Task 3: The model and the classification runner

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/classify/prompts.py`, `model.py`, `runner.py`
- Modify: `packages/financial-engine/src/pdf_financial_qa/classify/__init__.py`
- Test: `tests/test_classification_runner.py`

**Interfaces:**
- Consumes: `classify_text`, `RuleAnswers`, `Hit`, `normalise`, `READ_KINDS`, `TITLE_PAGES`, `QUOTE_MAX`, `RULES_VERSION` (Task 2); `ClassificationResult`, `Evidence`, `StatementFound` (Task 1); `PdfDocument` (`page_texts`, `page_count`, `subset(indexes) -> bytes`), `ExtractionError`, `is_transient`, `pdf_message`, `ExtractionWarning`.
- Produces: `Question(field, allowed)`, `Answer(field, value, page, quote)`, `ClassifyOutput(answers)`, `ClassificationModel` protocol (`name: str`, `classify(pdf: bytes, page_count: int, questions: list[Question]) -> ClassifyOutput`), `GeminiClassificationModel(*, project, location, model, timeout_seconds=60)`, `PROMPT_VERSION`, `ClassifySettings(retry_interval: float = 1.0)`, `run_classification(pdf: bytes, *, model_factory: Callable[[], ClassificationModel] | None, settings: ClassifySettings = ClassifySettings()) -> ClassificationResult`, `MAX_MODEL_PAGES = 10`.

- [ ] **Step 1: Write the failing tests**

`tests/test_classification_runner.py`:

```python
"""Rules first, the model only for open answers, every model answer checked. Offline."""

import unittest

from pdf_fixtures import make_pdf

from pdf_financial_qa.classify import ClassifySettings, run_classification
from pdf_financial_qa.classify.model import Answer, ClassifyOutput
from pdf_financial_qa.workflow import ExtractionError

FAST = ClassifySettings(retry_interval=0.0)
ANNUAL = make_pdf([
    ["Synthetic Cements Limited", "Integrated Annual Report 2025-26", "CIN: L26940MH2001PLC123456"],
    ["Standalone Balance Sheet as at 31 March 2026", "Statement of Profit and Loss for the year ended 31 March 2026"],
])
UNKNOWN = make_pdf([["Synthetic Textiles Limited", "Kind words about the year gone by"]])


class ScriptedClassifier:
    name = "scripted-classifier"

    def __init__(self, answers=(), fail_first=None):
        self.answers = list(answers)
        self.fail_first = fail_first
        self.calls = []

    def classify(self, pdf, page_count, questions):
        self.calls.append([q.field for q in questions])
        if self.fail_first is not None:
            exc, self.fail_first = self.fail_first, None
            raise exc
        return ClassifyOutput(answers=self.answers)


def never():
    raise AssertionError("the model must not be asked")


class RunnerTests(unittest.TestCase):
    def test_rules_settle_everything_without_the_model(self):
        r = run_classification(ANNUAL, model_factory=never, settings=FAST)
        self.assertEqual((r.kind, r.model, r.prompt_version, r.warnings), ("annual_report", None, None, []))
        self.assertEqual(r.company_name_as_printed, "Synthetic Cements Limited")
        self.assertTrue(all(e.source == "rule" and e.text_layer_match for e in r.evidence))

    def test_only_open_answers_are_asked_and_a_checked_answer_is_kept(self):
        model = ScriptedClassifier([Answer(field="kind", value="other", page=1, quote="Kind words about the year gone by"),
                                    Answer(field="other_type", value="announcement", page=1, quote="Kind words about the year gone by")])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(model.calls, [["kind", "other_type", "period", "results_span"]])
        self.assertEqual((r.kind, r.other_type, r.model), ("other", "announcement", "scripted-classifier"))
        self.assertTrue(r.prompt_version.startswith("classify-"))
        kind = next(e for e in r.evidence if e.field == "kind")
        self.assertEqual((kind.source, kind.page_index, kind.text_layer_match), ("model", 0, True))

    def test_a_quote_not_on_the_page_is_dropped(self):
        model = ScriptedClassifier([Answer(field="kind", value="annual_report", page=1, quote="Annual Report 2025-26")])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "not_sure")
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_a_page_outside_the_subset_is_dropped(self):
        model = ScriptedClassifier([Answer(field="kind", value="other", page=9, quote="Kind words")])
        self.assertEqual(run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST).kind, "not_sure")

    def test_a_value_outside_the_allowed_set_is_dropped(self):
        model = ScriptedClassifier([Answer(field="kind", value="brochure", page=1, quote="Kind words about the year gone by")])
        self.assertEqual(run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST).kind, "not_sure")

    def test_a_company_not_in_its_quote_is_dropped(self):
        pdf = make_pdf([["Kind words about the year gone by"]])
        model = ScriptedClassifier([Answer(field="company", value="Invented Industries Limited", page=1,
                                           quote="Kind words about the year gone by")])
        r = run_classification(pdf, model_factory=lambda: model, settings=FAST)
        self.assertIsNone(r.company_name_as_printed)

    def test_a_scanned_page_keeps_the_answer_unchecked(self):
        pdf = make_pdf([[]])
        model = ScriptedClassifier([Answer(field="kind", value="annual_report", page=1, quote="Annual Report 2025-26")])
        r = run_classification(pdf, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "annual_report")
        self.assertIsNone(next(e for e in r.evidence if e.field == "kind").text_layer_match)

    def test_no_model_configured_falls_back_to_rules(self):
        r = run_classification(UNKNOWN, model_factory=None, settings=FAST)
        self.assertEqual(r.kind, "not_sure")
        self.assertEqual([w.code for w in r.warnings], ["MODEL_UNAVAILABLE"])

    def test_a_factory_error_falls_back_to_rules(self):
        def broken():
            raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
        r = run_classification(UNKNOWN, model_factory=broken, settings=FAST)
        self.assertEqual(([w.code for w in r.warnings], r.model), (["MODEL_UNAVAILABLE"], None))

    def test_a_transient_error_is_retried_once(self):
        model = ScriptedClassifier([Answer(field="kind", value="other", page=1, quote="Kind words about the year gone by")],
                                   fail_first=TimeoutError())
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual((len(model.calls), r.kind), (2, "other"))
        self.assertEqual(r.other_type, "unlisted_type")

    def test_an_unreadable_pdf_is_a_permanent_error(self):
        with self.assertRaises(ExtractionError) as caught:
            run_classification(b"%PDF-1.4 not really", model_factory=never, settings=FAST)
        self.assertEqual(caught.exception.code, "UNREADABLE_PDF")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --locked python -m unittest tests.test_classification_runner -v` → FAIL (`cannot import name 'ClassifySettings'`).

- [ ] **Step 3: Write the prompt and model**

`packages/financial-engine/src/pdf_financial_qa/classify/prompts.py`:

```python
"""The classify prompt. PROMPT_VERSION changes whenever its text does."""

import hashlib

CLASSIFY = """You are reading the first pages of a document published by an Indian listed company.
Answer only the questions listed below. For each answer give the 1-based page number in this PDF
and copy the exact words from that page that show it (at most 300 characters).
If the pages do not show an answer, leave that question out. Never give a company name that is not printed.

Meanings:
- kind: annual_report (a full year's annual report), financial_results (quarterly, half-year,
  nine-month or year-end results), other (any other company document).
- other_type: the type of an "other" document.
- company: the company's name exactly as printed.
- period: the period the document covers, as printed, for example "Quarter ended 30 June 2026".
- results_span: quarter, half_year, nine_months or full_year. Results for "the quarter and year ended
  31 March" are full_year.

Questions (field: allowed values):
{questions}
"""

PROMPT_VERSION = "classify-" + hashlib.sha256(CLASSIFY.encode()).hexdigest()[:12]
```

`packages/financial-engine/src/pdf_financial_qa/classify/model.py`:

```python
"""The model behind classification, behind a protocol so tests run offline."""

from typing import Literal, Protocol

from pydantic import BaseModel, Field

from pdf_financial_qa.classify import prompts
from pdf_financial_qa.workflow.errors import ModelOutputError
from pdf_financial_qa.workflow.model import pdf_message

QuestionField = Literal["kind", "other_type", "company", "period", "results_span"]


class Question(BaseModel):
    field: QuestionField
    allowed: list[str] | None = None  # None: free text, as printed


class Answer(BaseModel):
    field: QuestionField
    value: str
    page: int = Field(description="1-based page number within the PDF you were given")
    quote: str = Field(description="The exact words on that page that show the answer, at most 300 characters")


class ClassifyOutput(BaseModel):
    answers: list[Answer]


class ClassificationModel(Protocol):
    name: str

    def classify(self, pdf: bytes, page_count: int, questions: list[Question]) -> ClassifyOutput: ...


def render_questions(questions: list[Question]) -> str:
    return "\n".join(f"- {q.field}: {', '.join(q.allowed) if q.allowed else 'as printed'}" for q in questions)


class GeminiClassificationModel:
    """Gemini on Vertex AI. One attempt per call; the runner retries a transient failure once."""

    def __init__(self, *, project: str, location: str, model: str, timeout_seconds: float = 60) -> None:
        from langchain_google_genai import ChatGoogleGenerativeAI

        self.name = model
        self._llm = ChatGoogleGenerativeAI(model=model, vertexai=True, project=project, location=location,
                                           temperature=0, max_retries=1, timeout=timeout_seconds)

    def classify(self, pdf: bytes, page_count: int, questions: list[Question]) -> ClassifyOutput:
        text = prompts.CLASSIFY.format(questions=render_questions(questions)) + f"\nThe PDF has {page_count} pages."
        result = self._llm.with_structured_output(ClassifyOutput).invoke(pdf_message(text, pdf))
        if not isinstance(result, ClassifyOutput):
            raise ModelOutputError("model returned no ClassifyOutput")
        return result
```

- [ ] **Step 4: Write the runner**

`packages/financial-engine/src/pdf_financial_qa/classify/runner.py`:

```python
"""Work out what a filing is: rules first, the model only for what they leave open.

A model answer is kept only when its value is allowed, its page is one it was
shown and its quote appears in that page's text layer (or the page has none).
"""

import time
from collections.abc import Callable
from dataclasses import dataclass

from pdf_financial_qa.classify import rules
from pdf_financial_qa.classify.contracts import ClassificationResult, Evidence, StatementFound
from pdf_financial_qa.classify.model import Answer, ClassificationModel, ClassifyOutput, Question
from pdf_financial_qa.classify.prompts import PROMPT_VERSION
from pdf_financial_qa.workflow.contracts import ExtractionWarning
from pdf_financial_qa.workflow.errors import ExtractionError, is_transient
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.values import parse_label_date

MAX_MODEL_PAGES = 10
KINDS = ["annual_report", "financial_results", "other"]
OTHER_TYPES = ["shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
               "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type"]
SPANS = ["quarter", "half_year", "nine_months", "full_year"]

ModelFactory = Callable[[], ClassificationModel]


@dataclass(frozen=True)
class ClassifySettings:
    retry_interval: float = 1.0


def _questions(a: rules.RuleAnswers) -> list[Question]:
    questions = []
    if a.kind is None:
        questions.append(Question(field="kind", allowed=KINDS))
    if a.kind in (None, "other") and a.other_type is None:
        questions.append(Question(field="other_type", allowed=OTHER_TYPES))
    if a.company_name is None:
        questions.append(Question(field="company"))
    if a.kind in (None, *rules.READ_KINDS) and a.period_label is None:
        questions.append(Question(field="period"))
    if a.kind in (None, "financial_results") and a.results_span is None:
        questions.append(Question(field="results_span", allowed=SPANS))
    return questions


def _checked(answer: Answer, pages: list[int], texts: list[str]) -> tuple[int, str, bool | None] | None:
    if not 1 <= answer.page <= len(pages):
        return None
    index = pages[answer.page - 1]
    quote = " ".join(answer.quote.split())[:rules.QUOTE_MAX]
    if not quote:
        return None
    if not texts[index].strip():
        return index, quote, None
    if rules.normalise(quote) not in rules.normalise(texts[index]):
        return None
    return index, quote, True


def _apply(a: rules.RuleAnswers, output: ClassifyOutput, asked: list[Question], pages: list[int],
           texts: list[str]) -> tuple[list[Evidence], int]:
    allowed = {q.field: q.allowed for q in asked}
    kept: list[Evidence] = []
    dropped = 0
    for answer in output.answers:
        if answer.field not in allowed:
            continue
        value = " ".join(answer.value.split())
        checked = _checked(answer, pages, texts)
        options = allowed[answer.field]
        valid = bool(value) and (options is None or value in options)
        if answer.field in ("company", "period") and checked:
            valid = valid and rules.normalise(value) in rules.normalise(checked[1])
        if not (checked and valid):
            dropped += 1
            continue
        index, quote, match = checked
        if answer.field == "kind":
            a.kind = value
        elif answer.field == "other_type":
            a.other_type = value
        elif answer.field == "company":
            a.company_name = value
        elif answer.field == "period":
            a.period_label, a.period_end = value, parse_label_date(value)
        else:
            a.results_span = value
        kept.append(Evidence(field=answer.field, source="model", rule_id=None, page_index=index, quote=quote,
                             text_layer_match=match))
    return kept, dropped


def _call(model: ClassificationModel, pdf: bytes, page_count: int, questions: list[Question],
          settings: ClassifySettings) -> ClassifyOutput:
    try:
        return model.classify(pdf, page_count, questions)
    except Exception as exc:
        if not is_transient(exc):
            raise
        time.sleep(settings.retry_interval)
        return model.classify(pdf, page_count, questions)


def _reason(exc: Exception) -> str:
    return exc.code if isinstance(exc, ExtractionError) else type(exc).__name__


def run_classification(pdf: bytes, *, model_factory: ModelFactory | None,
                       settings: ClassifySettings = ClassifySettings()) -> ClassificationResult:
    doc = PdfDocument.load(pdf)  # UNREADABLE_PDF is a permanent ExtractionError
    a = rules.classify_text(doc.page_texts)
    questions = _questions(a)
    warnings: list[ExtractionWarning] = []
    model_evidence: list[Evidence] = []
    model_name = prompt_version = None
    if questions and model_factory is None:
        warnings.append(ExtractionWarning(code="MODEL_UNAVAILABLE",
                                          message="no model is configured; answers the rules could not settle are left open"))
    elif questions:
        pages = sorted(set(range(min(rules.TITLE_PAGES, doc.page_count))) | set(a.pointed_pages))[:MAX_MODEL_PAGES]
        try:
            model = model_factory()
            output = _call(model, doc.subset(pages), len(pages), questions, settings)
        except Exception as exc:  # a model problem never fails classification
            warnings.append(ExtractionWarning(code="MODEL_UNAVAILABLE", message=f"the model could not be used: {_reason(exc)}"))
        else:
            model_name, prompt_version = model.name, PROMPT_VERSION
            model_evidence, dropped = _apply(a, output, questions, pages, doc.page_texts)
            if dropped:
                warnings.append(ExtractionWarning(
                    code="MODEL_ANSWER_DROPPED",
                    message=f"{dropped} answer(s) could not be checked against the document and were left open"))

    kind = a.kind or "not_sure"
    other_type = (a.other_type or "unlisted_type") if kind == "other" else None
    read = kind in rules.READ_KINDS
    evidence = [Evidence(field=h.field, source="rule", rule_id=h.rule_id, page_index=h.page_index, quote=h.quote,
                         text_layer_match=True) for h in a.evidence] + model_evidence
    if not read:
        evidence = [e for e in evidence if e.field not in ("period", "results_span")]
    return ClassificationResult(
        rules_version=rules.RULES_VERSION, model=model_name, prompt_version=prompt_version, page_count=doc.page_count,
        kind=kind, other_type=other_type,
        results_span=a.results_span if kind == "financial_results" else None,
        period_end=a.period_end if read else None, period_label=a.period_label if read else None,
        company_name_as_printed=a.company_name, cin=a.cin, bse_code=a.bse_code, nse_symbol=a.nse_symbol,
        statements_found=[StatementFound(statement=s, basis=b, pages=p) for (s, b), p in sorted(a.statements.items())],
        evidence=evidence, warnings=warnings,
    )
```

Replace `packages/financial-engine/src/pdf_financial_qa/classify/__init__.py` with:

```python
"""Working out what a filing is (document intake): rules first, the model for what they leave open."""

from pdf_financial_qa.classify.contracts import ClassificationResult
from pdf_financial_qa.classify.model import ClassificationModel
from pdf_financial_qa.classify.rules import RULES_VERSION
from pdf_financial_qa.classify.runner import ClassifySettings, run_classification

__all__ = ["RULES_VERSION", "ClassificationModel", "ClassificationResult", "ClassifySettings", "run_classification"]
```

- [ ] **Step 5: Run to verify it passes**

Run: `uv run --locked python -m unittest tests.test_classification_runner -v` → PASS. Then the whole suite → PASS.

- [ ] **Step 6: Checkpoint** — nothing committed.

---

### Task 4: `POST /v1/classify` on the extractor, and the 50 MiB limit

**Files:**
- Modify: `apps/extractor/src/maester_extractor/settings.py`, `apps/extractor/src/maester_extractor/app.py`, `apps/extractor/README.md`
- Test: `tests/test_extractor_service.py` (new class `ClassifyEndpointTests`)

**Interfaces:**
- Consumes: `run_classification`, `ClassifySettings`, `ClassificationModel` (Task 3); `ClassifyResult`, `ClassifyError` (Task 1).
- Produces: `create_app(settings=None, model_factory=None, workflow=None, classify_model_factory=None, classify_settings=None)`; `vertex_classify_factory(settings)`; settings `classify_model` (env `GEMINI_CLASSIFY_MODEL`, default `gemini-2.5-flash`), `classify_model_seconds` (env `CLASSIFY_MODEL_TIMEOUT_SECONDS`, default 60), `max_bytes` default `50 * 1024 * 1024`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_extractor_service.py`)

```python
from pdf_financial_qa.classify import ClassifySettings
from pdf_financial_qa.classify.contracts import CLASSIFY_RESPONSE, ClassifyError, ClassifyResult
from pdf_financial_qa.classify.model import Answer, ClassifyOutput

CLASSIFY_PDF = make_pdf([["Synthetic Textiles Limited", "Kind words about the year gone by"]])


class FixedClassifier:
    name = "fixed-classifier"

    def classify(self, pdf, page_count, questions):
        return ClassifyOutput(answers=[Answer(field="kind", value="other", page=1, quote="Kind words about the year gone by")])


def classify_client(factory=None, **overrides):
    settings = Settings(secret=SECRET, **overrides)
    return TestClient(create_app(settings, lambda: ScriptedModel(), workflow=FAST,
                                 classify_model_factory=factory or (lambda: FixedClassifier()),
                                 classify_settings=ClassifySettings(retry_interval=0.0)))


def classify_post(c, body=CLASSIFY_PDF, secret=SECRET):
    return c.post("/v1/classify", content=body, headers={"x-extractor-secret": secret, "content-type": "application/pdf",
                                                          "x-document-id": "doc-1"})


class ClassifyEndpointTests(unittest.TestCase):
    def test_answers_one_json_result(self):
        response = classify_post(classify_client())
        self.assertEqual(response.status_code, 200)
        body = CLASSIFY_RESPONSE.validate_python(response.json())
        self.assertIsInstance(body, ClassifyResult)
        self.assertEqual((body.result.kind, body.result.model), ("other", "fixed-classifier"))

    def test_an_unreadable_pdf_is_an_error_body(self):
        body = CLASSIFY_RESPONSE.validate_python(classify_post(classify_client(), body=b"%PDF-1.4 broken").json())
        self.assertIsInstance(body, ClassifyError)
        self.assertEqual((body.code, body.retryable), ("UNREADABLE_PDF", False))

    def test_a_missing_model_still_classifies_with_a_warning(self):
        def missing():
            raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
        body = CLASSIFY_RESPONSE.validate_python(classify_post(classify_client(missing)).json())
        self.assertEqual((body.result.kind, [w.code for w in body.result.warnings]), ("not_sure", ["MODEL_UNAVAILABLE"]))

    def test_wrong_secret_is_401_and_too_large_is_413(self):
        self.assertEqual(classify_post(classify_client(), secret="wrong").status_code, 401)
        self.assertEqual(classify_post(classify_client(max_bytes=10)).status_code, 413)

    def test_default_limit_is_50_mib(self):
        self.assertEqual(Settings().max_bytes, 50 * 1024 * 1024)
        self.assertEqual(Settings.from_env({}).max_bytes, 50 * 1024 * 1024)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --locked python -m unittest tests.test_extractor_service -v` → FAIL (`create_app() got an unexpected keyword argument 'classify_model_factory'`).

- [ ] **Step 3: Settings**

In `settings.py`: change `max_bytes: int = 30 * 1024 * 1024` to `max_bytes: int = 50 * 1024 * 1024`; add fields after `model`:

```python
    classify_model: str = "gemini-2.5-flash"
    classify_model_seconds: float = 60.0
```

In `from_env`, change the `max_bytes` line to `max_bytes=int(env.get("EXTRACT_MAX_BYTES", str(50 * 1024 * 1024))),` and add:

```python
            classify_model=env.get("GEMINI_CLASSIFY_MODEL") or "gemini-2.5-flash",
            classify_model_seconds=float(env.get("CLASSIFY_MODEL_TIMEOUT_SECONDS", "60")),
```

- [ ] **Step 4: The endpoint**

In `app.py`, replace `vertex_model_factory` with a shared factory and two builders:

```python
def _vertex_factory(settings: Settings, build: Callable[[], T]) -> Callable[[], T]:
    """Build a Vertex model on first use and reuse it; report missing configuration
    as a permanent, typed error rather than failing at startup."""
    cached: list[T] = []
    lock = threading.Lock()

    def factory() -> T:
        with lock:
            if cached:
                return cached[0]
            if not settings.project:
                raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
            import google.auth
            from google.auth.exceptions import DefaultCredentialsError

            try:
                google.auth.default()
            except DefaultCredentialsError as exc:
                raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "no Google Cloud credentials are available",
                                      retryable=False) from exc
            cached.append(build())
            return cached[0]

    return factory


def vertex_model_factory(settings: Settings) -> ModelFactory:
    def build() -> ExtractionModel:
        from pdf_financial_qa.workflow.model import GeminiExtractionModel
        return GeminiExtractionModel(project=settings.project, location=settings.location, model=settings.model)
    return _vertex_factory(settings, build)


def vertex_classify_factory(settings: Settings) -> ClassifyModelFactory:
    def build() -> ClassificationModel:
        from pdf_financial_qa.classify.model import GeminiClassificationModel
        return GeminiClassificationModel(project=settings.project, location=settings.location,
                                         model=settings.classify_model, timeout_seconds=settings.classify_model_seconds)
    return _vertex_factory(settings, build)
```

Add to the imports: `from typing import Annotated, TypeVar`, `from fastapi.responses import JSONResponse, StreamingResponse`, `from pdf_financial_qa.classify import ClassificationModel, ClassifySettings, run_classification`, `from pdf_financial_qa.classify.contracts import ClassifyError, ClassifyResult`; and below `ModelFactory`: `ClassifyModelFactory = Callable[[], ClassificationModel]` and `T = TypeVar("T")`.

Change `create_app`'s signature and add the route (after `extract`, before `return app`):

```python
def create_app(settings: Settings | None = None, model_factory: ModelFactory | None = None,
               workflow: WorkflowSettings | None = None, classify_model_factory: ClassifyModelFactory | None = None,
               classify_settings: ClassifySettings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    model_factory = model_factory or vertex_model_factory(settings)
    classify_model_factory = classify_model_factory or vertex_classify_factory(settings)
    classify_settings = classify_settings or ClassifySettings()
    # … unchanged …

    @app.post("/v1/classify", dependencies=[Depends(authenticate)])
    async def classify(pdf: Annotated[bytes, Depends(pdf_body)],
                       x_document_id: Annotated[str | None, Header()] = None) -> JSONResponse:
        started = time.monotonic()
        try:
            result = await asyncio.to_thread(run_classification, pdf, model_factory=classify_model_factory,
                                             settings=classify_settings)
        except ExtractionError as err:
            log.info("classification failed document=%s code=%s", x_document_id, err.code)
            return JSONResponse(ClassifyError(code=err.code, retryable=err.retryable, message=err.message).to_wire())
        except Exception as exc:  # a bug, not a document problem; the job system retries
            log.exception("classification crashed document=%s", x_document_id)
            return JSONResponse(ClassifyError(code="CLASSIFICATION_FAILED", retryable=True,
                                              message=f"unexpected {type(exc).__name__}").to_wire())
        log.info("classification finished document=%s kind=%s evidence=%d warnings=%d seconds=%.1f", x_document_id,
                 result.kind, len(result.evidence), len(result.warnings), time.monotonic() - started)
        return JSONResponse(ClassifyResult(result=result).to_wire())
```

Update the module docstring's first paragraph to mention `POST /v1/classify` (one JSON answer: `{"type":"result",…}` or `{"type":"error",…}`).

In `apps/extractor/README.md` add the endpoint line after `/v1/extract`'s, change the `EXTRACT_MAX_BYTES` row default to "50 MiB", and add rows for `GEMINI_CLASSIFY_MODEL` (default `gemini-2.5-flash`) and `CLASSIFY_MODEL_TIMEOUT_SECONDS` (default 60).

- [ ] **Step 5: Run to verify it passes**

Run: `uv run --locked python -m unittest discover -s tests -v` → PASS (existing extractor tests included).

- [ ] **Step 6: Checkpoint** — nothing committed.

---

### Task 5: Database schema, migration and queries

**Files:**
- Create: `packages/db/src/schema/classification.ts`, `packages/db/src/queries/classification.ts`
- Modify: `packages/db/src/schema/platform.ts`, `packages/db/src/schema/extraction.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Generate: `packages/db/drizzle/0003_document_intake.sql` (+ snapshot, journal)
- Test: `packages/db/test/classification.test.ts`

**Interfaces:**
- Produces (schema): `intakeState` (platform), `classificationKind`, `otherDocumentType`, `resultsSpan`, `classificationSetBy`, `evidenceField`, `evidenceSource`, `documentClassification`, `classificationEvidence`; columns `company.cin|bseCode|nseSymbol`, `document.intakeState|duplicateOfDocumentId`, `extractionRevision.classificationId`.
- Produces (types): `ClassificationRow`, `EvidenceRow`, `StatementsFoundJson`.
- Produces (queries): `getCurrentClassification(db, workspaceId, documentId): Promise<ClassificationRow | null>`, `listEvidence(db, workspaceId, classificationId): Promise<EvidenceRow[]>`, `getCurrentRevision(db, workspaceId, documentId): Promise<ExtractionRevisionRow | null>`, `normalizeCompanyName(name: string): string`, `matchCompanies(db, workspaceId, ids: { cin?: string | null; bseCode?: string | null; nseSymbol?: string | null; name?: string | null }): Promise<CompanyRow[]>`, `findStoredDuplicate(db, workspaceId, documentId, sha256): Promise<DocumentRow | null>`.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/classification.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import {
  findStoredDuplicate, getCurrentClassification, getCurrentRevision, listEvidence, matchCompanies, normalizeCompanyName,
} from "../src/queries/classification.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function seed() {
  await insertUser(db, "u1", "u1@example.com");
  const workspaceId = crypto.randomUUID();
  await db.insert(schema.workspace).values({ id: workspaceId, name: "W", ownerUserId: "u1" });
  const documentId = crypto.randomUUID();
  await db.insert(schema.document).values({
    id: documentId, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${documentId}/original.pdf`, state: "stored", contentSha256: "a".repeat(64),
    createdByUserId: "u1",
  });
  return { workspaceId, documentId };
}

async function classification(workspaceId: string, documentId: string, createdAt: Date, extra: Partial<typeof schema.documentClassification.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(schema.documentClassification).values({ id, workspaceId, documentId, kind: "annual_report", setBy: "maester", createdAt, ...extra });
  return id;
}

async function revision(workspaceId: string, documentId: string, classificationId: string | null, createdAt: Date) {
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({ id: jobId, workspaceId, type: "document.extract", subjectType: "document", subjectId: documentId, idempotencyKey: `k-${jobId}`, state: "succeeded" });
  const id = crypto.randomUUID();
  await db.insert(schema.extractionRevision).values({
    id, workspaceId, documentId, jobId, classificationId, state: "complete", pipelineVersion: "p", model: "m", promptVersion: "v",
    pageCount: 1, coverage: { statements: [] }, createdAt,
  });
  return id;
}

describe("classification queries", () => {
  it("the newest classification is current, and evidence belongs to it", async () => {
    const { workspaceId, documentId } = await seed();
    await classification(workspaceId, documentId, new Date("2026-10-01T00:00:00Z"));
    const newer = await classification(workspaceId, documentId, new Date("2026-10-02T00:00:00Z"), { kind: "other", otherType: "announcement" });
    await db.insert(schema.classificationEvidence).values({ id: crypto.randomUUID(), workspaceId, classificationId: newer, field: "kind", source: "rule", ruleId: "title.press_release", pageIndex: 0, quote: "Press Release", textLayerMatch: true });
    expect((await getCurrentClassification(db, workspaceId, documentId))!.id).toBe(newer);
    expect((await listEvidence(db, workspaceId, newer)).map((e) => e.quote)).toEqual(["Press Release"]);
    expect(await getCurrentClassification(db, crypto.randomUUID(), documentId)).toBeNull();
  });

  it("current figures follow reads_under_id; no classification falls back to the newest revision", async () => {
    const { workspaceId, documentId } = await seed();
    expect(await getCurrentRevision(db, workspaceId, documentId)).toBeNull();
    const legacy = await revision(workspaceId, documentId, null, new Date("2026-09-01T00:00:00Z"));
    expect((await getCurrentRevision(db, workspaceId, documentId))!.id).toBe(legacy);
    const first = crypto.randomUUID();
    await db.insert(schema.documentClassification).values({ id: first, workspaceId, documentId, kind: "annual_report", setBy: "maester", readsUnderId: first, createdAt: new Date("2026-10-01T00:00:00Z") });
    const read = await revision(workspaceId, documentId, first, new Date("2026-10-01T01:00:00Z"));
    await classification(workspaceId, documentId, new Date("2026-10-02T00:00:00Z"), { readsUnderId: first, periodLabel: "Year ended 31 March 2026" });
    expect((await getCurrentRevision(db, workspaceId, documentId))!.id).toBe(read);
    await classification(workspaceId, documentId, new Date("2026-10-03T00:00:00Z"), { kind: "other", otherType: "announcement" });
    expect(await getCurrentRevision(db, workspaceId, documentId)).toBeNull();
  });

  it("normalizes company names", () => {
    expect(normalizeCompanyName("The Synthetic Cements Ltd.")).toBe("synthetic cements limited");
    expect(normalizeCompanyName("SYNTHETIC CEMENTS LIMITED")).toBe("synthetic cements limited");
    expect(normalizeCompanyName("Synthetic & Sons Pvt. Ltd")).toBe("synthetic and sons limited");
  });

  it("matches by CIN, then exchange code, then name; ambiguity returns every candidate", async () => {
    const { workspaceId } = await seed();
    const add = async (displayName: string, extra: Partial<typeof schema.company.$inferInsert> = {}) => {
      const id = crypto.randomUUID();
      await db.insert(schema.company).values({ id, workspaceId, displayName, country: "IN", createdByUserId: "u1", ...extra });
      return id;
    };
    const cem = await add("Synthetic Cements Ltd", { cin: "L26940MH2001PLC123456" });
    const pow = await add("Synthetic Power Limited", { bseCode: "532123" });
    await add("Twin Foods Ltd");
    await add("Twin Foods Limited");
    expect((await matchCompanies(db, workspaceId, { cin: "L26940MH2001PLC123456", name: "Other" })).map((c) => c.id)).toEqual([cem]);
    expect((await matchCompanies(db, workspaceId, { bseCode: "532123" })).map((c) => c.id)).toEqual([pow]);
    expect((await matchCompanies(db, workspaceId, { name: "SYNTHETIC CEMENTS LIMITED" })).map((c) => c.id)).toEqual([cem]);
    expect(await matchCompanies(db, workspaceId, { name: "Twin Foods Limited" })).toHaveLength(2);
    expect(await matchCompanies(db, workspaceId, { name: "Nobody Limited" })).toEqual([]);
    expect(await matchCompanies(db, crypto.randomUUID(), { cin: "L26940MH2001PLC123456" })).toEqual([]);
  });

  it("finds the oldest stored document with the same content in the workspace", async () => {
    const { workspaceId, documentId } = await seed();
    const second = crypto.randomUUID();
    await db.insert(schema.document).values({
      id: second, workspaceId, originalName: "b.pdf", declaredSize: 10, declaredMime: "application/pdf",
      storageKey: `workspaces/${workspaceId}/documents/${second}/original.pdf`, state: "stored", contentSha256: "a".repeat(64), createdByUserId: "u1",
    });
    expect((await findStoredDuplicate(db, workspaceId, second, "a".repeat(64)))!.id).toBe(documentId);
    expect(await findStoredDuplicate(db, workspaceId, documentId, "b".repeat(64))).toBeNull();
  });

  it("refuses two companies with the same CIN in one workspace", async () => {
    const { workspaceId } = await seed();
    const values = { workspaceId, country: "IN", createdByUserId: "u1", cin: "L26940MH2001PLC123456" };
    await db.insert(schema.company).values({ id: crypto.randomUUID(), displayName: "A Ltd", ...values });
    await expect(db.insert(schema.company).values({ id: crypto.randomUUID(), displayName: "B Ltd", ...values })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm db:up && pnpm --filter @maester/db test` → FAIL (`Cannot find module '../src/queries/classification.js'`).

- [ ] **Step 3: Schema**

`packages/db/src/schema/classification.ts`:

```ts
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { company, document, job, ts, workspace } from "./platform.js";

export const classificationKind = pgEnum("classification_kind", ["annual_report", "financial_results", "other", "not_sure"]);
export const otherDocumentType = pgEnum("other_document_type", [
  "shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
  "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type",
]);
export const resultsSpan = pgEnum("results_span", ["quarter", "half_year", "nine_months", "full_year"]);
export const classificationSetBy = pgEnum("classification_set_by", ["maester", "investor"]);
export const evidenceField = pgEnum("evidence_field", ["kind", "other_type", "company", "identifier", "period", "results_span", "statements"]);
export const evidenceSource = pgEnum("evidence_source", ["rule", "model", "investor"]);

export type StatementsFoundJson = { statement: string; basis: string; pages: number[] }[];
export type ClassificationWarningJson = { code: string; message: string }[];

/** One answer set about what a document is. Immutable; the newest row is current. */
export const documentClassification = pgTable(
  "document_classification",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    documentId: uuid("document_id").notNull().references(() => document.id),
    kind: classificationKind("kind").notNull(),
    otherType: otherDocumentType("other_type"),
    resultsSpan: resultsSpan("results_span"),
    periodEnd: date("period_end"),
    periodLabel: text("period_label"),
    companyId: uuid("company_id").references(() => company.id),
    companyNameAsPrinted: text("company_name_as_printed"),
    cin: text("cin"),
    bseCode: text("bse_code"),
    nseSymbol: text("nse_symbol"),
    statementsFound: jsonb("statements_found").$type<StatementsFoundJson>().notNull().default([]),
    setBy: classificationSetBy("set_by").notNull(),
    setByUserId: text("set_by_user_id").references(() => user.id),
    jobId: uuid("job_id").unique().references(() => job.id),
    /** The classification whose read gives this document its current figures. */
    readsUnderId: uuid("reads_under_id").references((): AnyPgColumn => documentClassification.id),
    rulesVersion: text("rules_version"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    warnings: jsonb("warnings").$type<ClassificationWarningJson>().notNull().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("document_classification_document_created").on(t.workspaceId, t.documentId, t.createdAt)],
);

/** Where an answer came from: a rule, the model or the investor, with its page and words. */
export const classificationEvidence = pgTable(
  "classification_evidence",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    classificationId: uuid("classification_id").notNull().references(() => documentClassification.id),
    field: evidenceField("field").notNull(),
    source: evidenceSource("source").notNull(),
    ruleId: text("rule_id"),
    pageIndex: integer("page_index"),
    quote: text("quote"),
    textLayerMatch: boolean("text_layer_match"),
  },
  (t) => [index("classification_evidence_classification").on(t.classificationId)],
);

export type ClassificationRow = typeof documentClassification.$inferSelect;
export type EvidenceRow = typeof classificationEvidence.$inferSelect;
```

In `platform.ts`: add `type AnyPgColumn` to the `drizzle-orm/pg-core` import; add before `company`:

```ts
export const intakeState = pgEnum("intake_state", [
  "identifying", "duplicate", "needs_company", "needs_kind", "kept", "reading", "read", "identify_failed", "read_failed",
]);
```

add to `company`'s columns (after `country`): `cin: text("cin"), bseCode: text("bse_code"), nseSymbol: text("nse_symbol"),` and to its index list:

```ts
    uniqueIndex("company_workspace_cin").on(t.workspaceId, t.cin).where(sql`${t.cin} is not null`),
    uniqueIndex("company_workspace_bse").on(t.workspaceId, t.bseCode).where(sql`${t.bseCode} is not null`),
    uniqueIndex("company_workspace_nse").on(t.workspaceId, t.nseSymbol).where(sql`${t.nseSymbol} is not null`),
```

add to `document`'s columns (after `rejectionCode`):

```ts
    /** Where the document stands after it is stored; null before. */
    intakeState: intakeState("intake_state"),
    duplicateOfDocumentId: uuid("duplicate_of_document_id").references((): AnyPgColumn => document.id),
```

In `extraction.ts`: import `documentClassification` from `./classification.js` and add to `extractionRevision` after `jobId`:

```ts
    /** The classification this revision was read under; null for revisions made before intake. */
    classificationId: uuid("classification_id").references(() => documentClassification.id),
```

In `schema/index.ts` add `export * from "./classification.js";`. In `packages/db/src/index.ts` add:

```ts
export type { ClassificationRow, EvidenceRow, StatementsFoundJson, ClassificationWarningJson } from "./schema/classification.js";
export {
  getCurrentClassification, listEvidence, getCurrentRevision, normalizeCompanyName, matchCompanies, findStoredDuplicate,
} from "./queries/classification.js";
```

- [ ] **Step 4: Queries**

`packages/db/src/queries/classification.ts`:

```ts
import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { classificationEvidence, documentClassification, type ClassificationRow, type EvidenceRow } from "../schema/classification.js";
import { extractionRevision, type ExtractionRevisionRow } from "../schema/extraction.js";
import { company, document, type CompanyRow, type DocumentRow } from "../schema/platform.js";
import { getLatestRevision } from "./extraction.js";

export async function getCurrentClassification(db: Db, workspaceId: string, documentId: string): Promise<ClassificationRow | null> {
  const rows = await db
    .select()
    .from(documentClassification)
    .where(and(eq(documentClassification.workspaceId, workspaceId), eq(documentClassification.documentId, documentId)))
    .orderBy(desc(documentClassification.createdAt), desc(documentClassification.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listEvidence(db: Db, workspaceId: string, classificationId: string): Promise<EvidenceRow[]> {
  return db
    .select()
    .from(classificationEvidence)
    .where(and(eq(classificationEvidence.workspaceId, workspaceId), eq(classificationEvidence.classificationId, classificationId)))
    .orderBy(asc(classificationEvidence.field), asc(classificationEvidence.pageIndex), asc(classificationEvidence.id));
}

/**
 * A document's current figures: the newest revision read under the current
 * classification's `readsUnderId`. A document never classified (uploaded before
 * intake) keeps its newest revision.
 */
export async function getCurrentRevision(db: Db, workspaceId: string, documentId: string): Promise<ExtractionRevisionRow | null> {
  const current = await getCurrentClassification(db, workspaceId, documentId);
  if (!current) return getLatestRevision(db, workspaceId, documentId);
  if (!current.readsUnderId) return null;
  const rows = await db
    .select()
    .from(extractionRevision)
    .where(and(eq(extractionRevision.workspaceId, workspaceId), eq(extractionRevision.classificationId, current.readsUnderId)))
    .orderBy(desc(extractionRevision.createdAt), desc(extractionRevision.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Case, punctuation, a leading "the" and Ltd/Limited/Pvt Ltd do not tell companies apart. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/ (?:pvt |private )?(?:ltd|limited)$/, " limited");
}

/** Companies a document's identity points at: by CIN, else exchange code, else name. */
export async function matchCompanies(
  db: Db,
  workspaceId: string,
  ids: { cin?: string | null; bseCode?: string | null; nseSymbol?: string | null; name?: string | null },
): Promise<CompanyRow[]> {
  if (ids.cin) {
    const rows = await db.select().from(company).where(and(eq(company.workspaceId, workspaceId), eq(company.cin, ids.cin)));
    if (rows.length) return rows;
  }
  const codes = [
    ids.bseCode ? eq(company.bseCode, ids.bseCode) : undefined,
    ids.nseSymbol ? eq(company.nseSymbol, ids.nseSymbol) : undefined,
  ].filter((c) => c !== undefined);
  if (codes.length) {
    const rows = await db.select().from(company).where(and(eq(company.workspaceId, workspaceId), or(...codes)));
    if (rows.length) return rows;
  }
  if (!ids.name) return [];
  const wanted = normalizeCompanyName(ids.name);
  const rows = await db.select().from(company).where(eq(company.workspaceId, workspaceId)).orderBy(asc(company.createdAt));
  return rows.filter((c) => normalizeCompanyName(c.displayName) === wanted);
}

export async function findStoredDuplicate(db: Db, workspaceId: string, documentId: string, sha256: string): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), eq(document.contentSha256, sha256), eq(document.state, "stored"), ne(document.id, documentId)))
    .orderBy(asc(document.createdAt), asc(document.id))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @maester/db generate --name document_intake`
Expected: `packages/db/drizzle/0003_document_intake.sql` with `CREATE TYPE` for the seven enums, `CREATE TABLE "document_classification"` and `"classification_evidence"`, `ALTER TABLE` for `company`, `document`, `extraction_revision`, and three partial unique indexes ending in `WHERE "company"."cin" is not null` (or similar). Read the file; if drizzle-kit asks an interactive rename question, answer "create column" for every new column.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @maester/db test && pnpm --filter @maester/db typecheck` → PASS (the migrate test also confirms the migration applies cleanly).

- [ ] **Step 7: Checkpoint** — nothing committed.

---

### Task 6: `decideIntake` and the read-job key

**Files:**
- Create: `packages/jobs/src/intake.ts`
- Modify: `packages/jobs/src/index.ts`, `packages/jobs/package.json` (add `"@maester/contracts": "workspace:*"` to dependencies, then `pnpm install`)
- Test: `apps/worker/test/intake.test.ts` (the worker suite has a database)

**Interfaces:**
- Consumes: `createJob` (`@maester/jobs`), `Dispatcher`, `schema.document`, `ClassificationRow` (Task 5), `JobTypes.DOCUMENT_EXTRACT`, `IntakeState` (Task 1).
- Produces: `READ_KINDS: ReadonlySet<string>`, `readVersion(classificationId: string): string` → `"classification-<id>"`, `classificationIdOfReadJob(idempotencyKey: string): string | null`, `decideIntake(db: Db, dispatcher: Dispatcher, c: ClassificationRow, opts: { read: boolean }): Promise<IntakeState | null>` (returns the state it set, or null when it left the state as it was).

- [ ] **Step 1: Write the failing test**

`apps/worker/test/intake.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema, type ClassificationRow } from "@maester/db";
import { classificationIdOfReadJob, decideIntake, readVersion } from "@maester/jobs";
import { createWorkerContext, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext(); });
afterAll(() => ctx.close());

async function seed(c: Partial<typeof schema.documentClassification.$inferInsert>, intakeState: "identifying" | "read" = "identifying") {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyId = crypto.randomUUID();
  await ctx.db.insert(schema.company).values({ id: companyId, workspaceId, displayName: `Co ${companyId}`, country: "IN", createdByUserId: userId });
  const documentId = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id: documentId, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${documentId}/original.pdf`, state: "stored", intakeState, createdByUserId: userId,
  });
  const id = crypto.randomUUID();
  const [row] = await ctx.db.insert(schema.documentClassification).values({
    id, workspaceId, documentId, kind: "annual_report", setBy: "maester", ...c,
    ...(c.companyId === "SET" ? { companyId } : {}),
  }).returning();
  return { row: row as ClassificationRow, documentId, companyId };
}
const doc = async (id: string) => (await ctx.db.select().from(schema.document).where(eq(schema.document.id, id)))[0]!;

describe("decideIntake", () => {
  it("a read kind with a company starts the read, keyed by the classification", async () => {
    const { row, documentId, companyId } = await seed({ companyId: "SET" });
    const before = ctx.dispatcher.enqueued.length;
    expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: true })).toBe("reading");
    const job = ctx.dispatcher.enqueued.at(-1)!;
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);
    expect(job.type).toBe(JobTypes.DOCUMENT_EXTRACT);
    expect(job.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${documentId}:${readVersion(row.id)}`);
    expect(classificationIdOfReadJob(job.idempotencyKey)).toBe(row.id);
    expect(await doc(documentId)).toMatchObject({ intakeState: "reading", companyId });
  });

  it("a read kind without a company holds for the investor", async () => {
    const { row, documentId } = await seed({});
    const before = ctx.dispatcher.enqueued.length;
    expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: true })).toBe("needs_company");
    expect(ctx.dispatcher.enqueued.length).toBe(before);
    expect((await doc(documentId)).intakeState).toBe("needs_company");
  });

  it("other is kept and not_sure waits for the investor", async () => {
    const other = await seed({ kind: "other", otherType: "announcement" });
    expect(await decideIntake(ctx.db, ctx.dispatcher, other.row, { read: true })).toBe("kept");
    const unsure = await seed({ kind: "not_sure" });
    expect(await decideIntake(ctx.db, ctx.dispatcher, unsure.row, { read: true })).toBe("needs_kind");
  });

  it("read: false leaves a read document as it is", async () => {
    const { row, documentId } = await seed({ companyId: "SET" }, "read");
    expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: false })).toBeNull();
    expect((await doc(documentId)).intakeState).toBe("read");
  });

  it("classificationIdOfReadJob ignores other keys", () => {
    expect(classificationIdOfReadJob("document.extract:x:auto")).toBeNull();
    expect(classificationIdOfReadJob("document.extract:x:manual-1")).toBeNull();
  });
});
```

(The `companyId: "SET"` placeholder is replaced by the seeded company's id inside `seed`; it never reaches the database.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @maester/worker test -- intake` → FAIL (`decideIntake` is not exported).

- [ ] **Step 3: Write `intake.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import { JobTypes, type IntakeState } from "@maester/contracts";
import { schema, type ClassificationRow, type Db } from "@maester/db";
import { createJob } from "./create.js";
import type { Dispatcher } from "./dispatch.js";

export const READ_KINDS: ReadonlySet<string> = new Set(["annual_report", "financial_results"]);

/** The read job's version names the classification it reads under, so each answer set reads once. */
export const readVersion = (classificationId: string): string => `classification-${classificationId}`;

export function classificationIdOfReadJob(idempotencyKey: string): string | null {
  const match = /:classification-([0-9a-f-]{36})$/.exec(idempotencyKey);
  return match ? match[1]! : null;
}

/**
 * Turn a classification into the document's next step: read it, hold it for the
 * investor or keep it. The state is written before the read is enqueued, so a
 * fast read can never be overwritten by "reading". With `read: false` a read
 * kind with a company keeps whatever state it had (only the period or span changed).
 */
export async function decideIntake(db: Db, dispatcher: Dispatcher, c: ClassificationRow, opts: { read: boolean }): Promise<IntakeState | null> {
  let state: IntakeState | null;
  if (c.kind === "not_sure") state = "needs_kind";
  else if (c.kind === "other") state = "kept";
  else if (!c.companyId) state = "needs_company";
  else state = opts.read ? "reading" : null;

  await db
    .update(schema.document)
    .set({ companyId: c.companyId, ...(state ? { intakeState: state } : {}), updatedAt: sql`now()` })
    .where(and(eq(schema.document.id, c.documentId), eq(schema.document.workspaceId, c.workspaceId)));

  if (state === "reading") {
    await createJob(db, dispatcher, {
      workspaceId: c.workspaceId,
      type: JobTypes.DOCUMENT_EXTRACT,
      subjectType: "document",
      subjectId: c.documentId,
      pipelineVersion: readVersion(c.id),
    });
  }
  return state;
}
```

Add to `packages/jobs/src/index.ts`: `export { READ_KINDS, readVersion, classificationIdOfReadJob, decideIntake } from "./intake.js";`

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm install && pnpm --filter @maester/worker test -- intake && pnpm --filter @maester/jobs typecheck` → PASS.

- [ ] **Step 5: Checkpoint** — nothing committed.

---

### Task 7: The `document.classify` job

**Files:**
- Modify: `apps/worker/src/extractor.ts` (add `classify`), `apps/worker/src/jobs/types.ts` (`onFinalFailure`), `apps/worker/src/run.ts` (call the hook), `apps/worker/src/jobs/index.ts`, `apps/worker/src/jobs/document-extract.ts` (export `readAll`), `apps/worker/src/env.ts` (`EXTRACT_MAX_BYTES` default 52428800)
- Create: `apps/worker/src/jobs/document-classify.ts`
- Test: `apps/worker/test/document-classify.test.ts`

**Interfaces:**
- Consumes: `decideIntake`, `READ_KINDS` (Task 6); `matchCompanies`, `ClassificationRow` (Task 5); `ClassifyResponse`, `ClassificationResult`, `DocumentClassifyResult` (Task 1).
- Produces: `ExtractorClient.classify(input: { pdf: Uint8Array; documentId: string }): Promise<ClassificationResult>`; `JobHandler.onFinalFailure?: (job: JobRow, db: Db) => Promise<void>`; `documentClassify: JobHandler`; `writeClassification(db, job, doc: { id: string; companyId: string | null }, result: ClassificationResult, companyId: string | null): Promise<ClassificationRow>`.

- [ ] **Step 1: Write the failing test**

`apps/worker/test/document-classify.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { readVersion } from "@maester/jobs";
import { HttpExtractorClient } from "../src/extractor.js";
import { documentClassify, writeClassification } from "../src/jobs/document-classify.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

const fixture = (name: string) => readFileSync(new URL(`../../../packages/contracts/fixtures/classification/${name}`, import.meta.url), "utf8");
const ANNUAL = fixture("result-annual-report.json");
const SECRET = "extractor-test-secret";

type Reply = (res: ServerResponse) => void;
let reply: Reply;
let seen: IncomingMessage["headers"][] = [];
let server: Server;
let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
const json = (body: string, status = 200): Reply => (res) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body); };
const withKind = (kind: string, otherType: string | null = null) => {
  const body = JSON.parse(ANNUAL);
  Object.assign(body.result, { kind, otherType, periodEnd: null, periodLabel: null });
  return JSON.stringify(body);
};

beforeAll(async () => {
  server = createServer((req, res) => { req.resume(); req.on("end", () => { seen.push(req.headers); reply(res); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ctx = await createWorkerContext({ [JobTypes.DOCUMENT_CLASSIFY]: documentClassify }, { extractor: new HttpExtractorClient(url, { kind: "secret", secret: SECRET }, 10_000) });
});
afterAll(async () => { await ctx.close(); await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => { seen = []; reply = json(ANNUAL); });

async function seedStored(opts: { companies?: string[]; uploadCompany?: boolean } = {}) {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyIds: string[] = [];
  for (const displayName of opts.companies ?? []) {
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.company).values({ id, workspaceId, displayName, country: "IN", createdByUserId: userId });
    companyIds.push(id);
  }
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, companyId: opts.uploadCompany ? companyIds[0]! : null, originalName: "ar.pdf", declaredSize: 10,
    declaredMime: "application/pdf", storageKey, state: "stored", sizeBytes: 10, intakeState: "identifying", createdByUserId: userId,
  });
  await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  return { workspaceId, id, companyIds };
}
async function classify(workspaceId: string, docId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: docId });
  const res = await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, docId));
  const rows = await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.documentId, docId));
  return { res, job: job!, doc: doc!, rows };
}

describe("document.classify", () => {
  it("stores the answers with their evidence, matches the company by name and starts the read", async () => {
    const d = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    const { job, doc, rows } = await classify(d.workspaceId, d.id);
    expect(seen[0]!["x-extractor-secret"]).toBe(SECRET);
    expect(job.state).toBe("succeeded");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ kind: "annual_report", companyId: d.companyIds[0], setBy: "maester", readsUnderId: row.id, periodEnd: "2026-03-31" });
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, row.id));
    expect(evidence.map((e) => e.field).sort()).toEqual(["company", "identifier", "kind", "period", "statements"]);
    expect(doc).toMatchObject({ intakeState: "reading", companyId: d.companyIds[0] });
    const read = ctx.dispatcher.enqueued.find((j) => j.subjectId === d.id && j.type === JobTypes.DOCUMENT_EXTRACT);
    expect(read!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${d.id}:${readVersion(row.id)}`);
  });

  it("holds when the company is new or ambiguous", async () => {
    const none = await seedStored();
    expect((await classify(none.workspaceId, none.id)).doc.intakeState).toBe("needs_company");
    const twins = await seedStored({ companies: ["Synthetic Cements Ltd", "Synthetic Cements Limited"] });
    const r = await classify(twins.workspaceId, twins.id);
    expect(r.doc.intakeState).toBe("needs_company");
    expect(r.rows[0]!.readsUnderId).toBeNull();
  });

  it("uses the company given at upload as the investor's answer", async () => {
    const d = await seedStored({ companies: ["Somebody Else Ltd"], uploadCompany: true });
    const { rows, doc } = await classify(d.workspaceId, d.id);
    expect(rows[0]!.companyId).toBe(d.companyIds[0]);
    expect(doc.intakeState).toBe("reading");
    const investor = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.source, "investor"));
    expect(investor.some((e) => e.classificationId === rows[0]!.id && e.field === "company")).toBe(true);
  });

  it("keeps other documents and holds not_sure", async () => {
    reply = json(withKind("other", "shareholding_pattern"));
    const other = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    expect((await classify(other.workspaceId, other.id)).doc.intakeState).toBe("kept");
    reply = json(withKind("not_sure"));
    const unsure = await seedStored();
    expect((await classify(unsure.workspaceId, unsure.id)).doc.intakeState).toBe("needs_kind");
  });

  it("a permanent error fails the job and marks identify_failed", async () => {
    reply = json(fixture("error-unreadable.json"));
    const d = await seedStored();
    const { job, doc } = await classify(d.workspaceId, d.id);
    expect(job).toMatchObject({ state: "failed", lastErrorCode: "UNREADABLE_PDF" });
    expect(doc.intakeState).toBe("identify_failed");
  });

  it("an unavailable extractor is retried and leaves the document identifying", async () => {
    reply = json("{}", 503);
    const d = await seedStored();
    const { res, job, doc } = await classify(d.workspaceId, d.id);
    expect(res.body.outcome).toBe("retry");
    expect(job.lastErrorCode).toBe("EXTRACTOR_HTTP_503");
    expect(doc.intakeState).toBe("identifying");
  });

  it("an unreadable answer is a permanent INVALID_CLASSIFIER_RESULT", async () => {
    reply = json(JSON.stringify({ type: "result", result: { kind: "brochure" } }));
    const d = await seedStored();
    expect((await classify(d.workspaceId, d.id)).job.lastErrorCode).toBe("INVALID_CLASSIFIER_RESULT");
  });

  it("without an extractor it fails with CLASSIFIER_NOT_CONFIGURED", async () => {
    const bare = await createWorkerContext({ [JobTypes.DOCUMENT_CLASSIFY]: documentClassify });
    try {
      const { workspaceId, userId } = await seedWorkspace(bare.db);
      const id = crypto.randomUUID();
      await bare.db.insert(schema.document).values({
        id, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
        storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState: "identifying", createdByUserId: userId,
      });
      const jobId = await seedJob(bare.db, workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: id });
      await runJob(bare, JobTypes.DOCUMENT_CLASSIFY, jobId);
      const [job] = await bare.db.select().from(schema.job).where(eq(schema.job.id, jobId));
      const [doc] = await bare.db.select().from(schema.document).where(eq(schema.document.id, id));
      expect(job!.lastErrorCode).toBe("CLASSIFIER_NOT_CONFIGURED");
      expect(doc!.intakeState).toBe("identify_failed");
    } finally {
      await bare.close();
    }
  });

  it("writeClassification is idempotent per job", async () => {
    const d = await seedStored();
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    const result = JSON.parse(ANNUAL).result;
    const a = await writeClassification(ctx.db, job!, { id: d.id, companyId: null }, result, null);
    const b = await writeClassification(ctx.db, job!, { id: d.id, companyId: null }, result, null);
    expect(b.id).toBe(a.id);
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, a.id));
    expect(evidence).toHaveLength(5);
  });
});
```

Note: `createWorkerContext` truncates `"job", "document", …` with CASCADE, which also clears `document_classification`, `classification_evidence` and `company` rows of truncated workspaces.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @maester/worker test -- document-classify` → FAIL (module not found).

- [ ] **Step 3: The failure hook**

In `apps/worker/src/jobs/types.ts` replace the `JobHandler` type with:

```ts
export type JobHandler = ((job: JobRow, ctx: JobContext) => Promise<unknown>) & {
  /** Runs once when the job fails for good, to leave its subject in a stated failure. */
  onFinalFailure?: (job: JobRow, db: Db) => Promise<void>;
};
```

(add `Db` to the `@maester/db` type import). In `apps/worker/src/run.ts`, inside `catch`, right after `await failAttempt(...)`:

```ts
    if (final && handler.onFinalFailure) {
      try {
        await handler.onFinalFailure(job, deps.db);
      } catch (hookErr) {
        log.error({ err: (hookErr as Error).message }, "final-failure hook failed");
      }
    }
```

- [ ] **Step 4: The client**

In `apps/worker/src/extractor.ts`: import `ClassifyResponse, type ClassificationResult` from `@maester/contracts`; add to `ExtractorClient`:

```ts
  /** Work out what a PDF is. Resolves with the answers or rejects with a JobFailure. */
  classify(input: ClassifyRequest): Promise<ClassificationResult>;
```

with `export interface ClassifyRequest { pdf: Uint8Array; documentId: string }`. Move the fetch and status handling of `extract` into a private method and reuse it:

```ts
  private async post(path: string, input: { pdf: Uint8Array; documentId: string }, headers: Record<string, string>): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/pdf", "x-document-id": input.documentId, ...headers, ...(await this.authHeaders()) },
        body: input.pdf,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof JobFailure) throw err;
      throw new JobFailure("EXTRACTOR_UNAVAILABLE", `extractor request failed: ${(err as Error).message}`, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new JobFailure("EXTRACTOR_UNAUTHORIZED", `extractor refused the request (${res.status})`, false);
    }
    if (res.status === 413) throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", "the document is too large to extract", false);
    if (!res.ok || !res.body) {
      throw new JobFailure(`EXTRACTOR_HTTP_${res.status}`, `extractor answered ${res.status}`, res.status >= 500);
    }
    return res;
  }

  async classify(input: ClassifyRequest): Promise<ClassificationResult> {
    const res = await this.post("/v1/classify", input, {});
    let parsed: ClassifyResponse;
    try {
      parsed = ClassifyResponse.parse(await res.json());
    } catch (err) {
      throw new JobFailure("INVALID_CLASSIFIER_RESULT", `unreadable classifier answer: ${(err as Error).message.slice(0, 500)}`, false);
    }
    if (parsed.type === "error") throw new JobFailure(parsed.code, parsed.message, parsed.retryable);
    return parsed.result;
  }
```

and make `extract` start with `const res = await this.post("/v1/extract", input, input.companyName ? { "x-company-name": encodeURIComponent(input.companyName) } : {});`, deleting its own fetch and status checks (the NDJSON reading below them stays as it is).

In `apps/worker/src/env.ts` change `EXTRACT_MAX_BYTES`'s default to `52428800`, and in `apps/worker/test/env.test.ts:20` change the expected default from `31457280` to `52428800`. In `document-extract.ts` change `async function readAll` to `export async function readAll`.

- [ ] **Step 5: The handler**

`apps/worker/src/jobs/document-classify.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import type { ClassificationResult, DocumentClassifyResult } from "@maester/contracts";
import { matchCompanies, schema, type ClassificationRow, type Db, type JobRow } from "@maester/db";
import { decideIntake, READ_KINDS } from "@maester/jobs";
import { ObjectNotFoundError } from "@maester/storage";
import { readAll } from "./document-extract.js";
import { JobFailure, type JobContext, type JobHandler } from "./types.js";

/**
 * Store one classifier answer as an immutable classification with its evidence,
 * in one transaction. Unique per job, so a retry after a crash writes nothing new.
 * A company given at upload is the investor's answer and is recorded as such.
 */
export async function writeClassification(
  db: Db,
  job: JobRow,
  doc: { id: string; companyId: string | null },
  result: ClassificationResult,
  companyId: string | null,
): Promise<ClassificationRow> {
  return db.transaction(async (tx) => {
    const id = crypto.randomUUID();
    const reads = READ_KINDS.has(result.kind) && companyId !== null;
    const [row] = await tx
      .insert(schema.documentClassification)
      .values({
        id,
        workspaceId: job.workspaceId,
        documentId: doc.id,
        kind: result.kind,
        otherType: result.otherType,
        resultsSpan: result.resultsSpan,
        periodEnd: result.periodEnd,
        periodLabel: result.periodLabel,
        companyId,
        companyNameAsPrinted: result.companyNameAsPrinted,
        cin: result.cin,
        bseCode: result.bseCode,
        nseSymbol: result.nseSymbol,
        statementsFound: result.statementsFound,
        setBy: "maester",
        jobId: job.id,
        readsUnderId: reads ? id : null,
        rulesVersion: result.rulesVersion,
        model: result.model,
        promptVersion: result.promptVersion,
        warnings: result.warnings,
      })
      .onConflictDoNothing({ target: schema.documentClassification.jobId })
      .returning();
    if (!row) {
      const [existing] = await tx.select().from(schema.documentClassification).where(eq(schema.documentClassification.jobId, job.id));
      return existing!;
    }
    const evidence: (typeof schema.classificationEvidence.$inferInsert)[] = result.evidence.map((e) => ({
      id: crypto.randomUUID(), workspaceId: job.workspaceId, classificationId: row.id, field: e.field, source: e.source,
      ruleId: e.ruleId, pageIndex: e.pageIndex, quote: e.quote, textLayerMatch: e.textLayerMatch,
    }));
    if (doc.companyId) {
      evidence.push({
        id: crypto.randomUUID(), workspaceId: job.workspaceId, classificationId: row.id, field: "company", source: "investor",
        ruleId: null, pageIndex: null, quote: null, textLayerMatch: null,
      });
    }
    if (evidence.length) await tx.insert(schema.classificationEvidence).values(evidence);
    return row;
  });
}

async function uniqueMatch(db: Db, workspaceId: string, r: ClassificationResult): Promise<string | null> {
  const matches = await matchCompanies(db, workspaceId, { cin: r.cin, bseCode: r.bseCode, nseSymbol: r.nseSymbol, name: r.companyNameAsPrinted });
  return matches.length === 1 ? matches[0]!.id : null;
}

async function classify(job: JobRow, ctx: JobContext): Promise<DocumentClassifyResult> {
  if (!ctx.extractor) throw new JobFailure("CLASSIFIER_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);
  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new JobFailure("DOCUMENT_NOT_FOUND", `document ${job.subjectId} not found in workspace ${job.workspaceId}`, false);
  if (doc.state !== "stored") throw new JobFailure("INVALID_STATE", `document is ${doc.state}; only stored documents are classified`, false);

  const [done] = await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.jobId, job.id));
  if (done) return { outcome: "classified", classificationId: done.id, kind: done.kind, intakeState: doc.intakeState };

  if ((doc.sizeBytes ?? 0) > ctx.env.EXTRACT_MAX_BYTES) {
    throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", `documents over ${ctx.env.EXTRACT_MAX_BYTES} bytes are not classified`, false);
  }
  let pdf: Uint8Array;
  try {
    pdf = await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored PDF is missing", false);
    throw err;
  }

  await ctx.progress({ stage: "identifying", percent: 0 });
  const result = await ctx.extractor.classify({ pdf, documentId: doc.id });
  const companyId = doc.companyId ?? (await uniqueMatch(ctx.db, job.workspaceId, result));
  const row = await writeClassification(ctx.db, job, doc, result, companyId);
  const intakeState = await decideIntake(ctx.db, ctx.dispatcher, row, { read: true });
  await ctx.progress({ stage: "identified", percent: 100 });
  ctx.logger.info({ documentId: doc.id, kind: row.kind, intakeState }, "document classified");
  return { outcome: "classified", classificationId: row.id, kind: row.kind, intakeState };
}

export const documentClassify: JobHandler = Object.assign(classify, {
  async onFinalFailure(job: JobRow, db: Db): Promise<void> {
    await db
      .update(schema.document)
      .set({ intakeState: "identify_failed", updatedAt: sql`now()` })
      .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId), eq(schema.document.intakeState, "identifying")));
  },
});
```

Register it in `apps/worker/src/jobs/index.ts`: `[JobTypes.DOCUMENT_CLASSIFY]: documentClassify,` (import from `./document-classify.js`).

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @maester/worker test && pnpm --filter @maester/worker typecheck && pnpm --filter @maester/worker lint` → PASS (existing extract tests included; `extract` behaviour is unchanged).

- [ ] **Step 7: Checkpoint** — nothing committed.

---

### Task 8: Verify chains to classify; duplicates; reads linked to their classification

**Files:**
- Modify: `apps/worker/src/jobs/document-verify.ts`, `apps/worker/src/jobs/document-extract.ts`
- Test: `apps/worker/test/document-verify.test.ts` (replace the "chains extraction" block), `apps/worker/test/document-extract.test.ts` (new cases)

**Interfaces:**
- Consumes: `findStoredDuplicate`, `getCurrentClassification` (Task 5); `classificationIdOfReadJob` (Task 6).
- Produces: `writeRevision(db, job, document, result, classificationId: string | null)` (fifth parameter added); `documentExtract.onFinalFailure`.

- [ ] **Step 1: Write the failing tests**

In `apps/worker/test/document-verify.test.ts`, replace the `describe("document.verify chains extraction", …)` block with:

```ts
describe("document.verify hands over to classification", () => {
  it("enqueues document.classify once, even when the extractor is not configured, and marks identifying", async () => {
    const chained = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify });
    try {
      const { workspaceId, userId } = await seedWorkspace(chained.db);
      const id = crypto.randomUUID();
      const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
      await chained.db.insert(schema.document).values({
        id, workspaceId, originalName: "a.pdf", declaredSize: 8, declaredMime: "application/pdf", storageKey, state: "uploaded", createdByUserId: userId,
      });
      await chained.store.put(storageKey, new TextEncoder().encode("%PDF-1.7"), "application/pdf");
      for (let i = 0; i < 2; i++) {
        const jobId = await seedJob(chained.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: id });
        await runJob(chained, JobTypes.DOCUMENT_VERIFY, jobId);
      }
      const classifyJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_CLASSIFY));
      expect(classifyJobs).toHaveLength(1);
      expect(classifyJobs[0]!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_CLASSIFY}:${id}:auto`);
      expect(await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_EXTRACT))).toHaveLength(0);
      const [doc] = await chained.db.select().from(schema.document).where(eq(schema.document.id, id));
      expect(doc!.intakeState).toBe("identifying");
    } finally {
      await chained.close();
    }
  });

  it("marks a second copy of a stored file as a duplicate and does not classify it", async () => {
    const chained = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify });
    try {
      const { workspaceId, userId } = await seedWorkspace(chained.db);
      const ids: string[] = [];
      for (const name of ["first.pdf", "second.pdf"]) {
        const id = crypto.randomUUID();
        const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
        await chained.db.insert(schema.document).values({
          id, workspaceId, originalName: name, declaredSize: 8, declaredMime: "application/pdf", storageKey, state: "uploaded", createdByUserId: userId,
        });
        await chained.store.put(storageKey, new TextEncoder().encode("%PDF-1.7"), "application/pdf");
        const jobId = await seedJob(chained.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: id });
        await runJob(chained, JobTypes.DOCUMENT_VERIFY, jobId);
        ids.push(id);
      }
      const [second] = await chained.db.select().from(schema.document).where(eq(schema.document.id, ids[1]!));
      expect(second).toMatchObject({ intakeState: "duplicate", duplicateOfDocumentId: ids[0] });
      const classifyJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_CLASSIFY));
      expect(classifyJobs.map((j) => j.subjectId)).toEqual([ids[0]]);
    } finally {
      await chained.close();
    }
  });
});
```

Append to `apps/worker/test/document-extract.test.ts` (inside the top-level `describe`), reusing `seedStoredDocument`, `extract` and `RESULT_STREAM`:

```ts
  it("links the revision to the classification in its job key and marks the document read", async () => {
    const doc = await seedStoredDocument();
    const cid = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: cid, workspaceId: doc.workspaceId, documentId: doc.id, kind: "annual_report", setBy: "maester", companyId: doc.companyId, readsUnderId: cid });
    await ctx.db.update(schema.document).set({ intakeState: "reading" }).where(eq(schema.document.id, doc.id));
    const jobId = await seedJob(ctx.db, doc.workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: doc.id, idempotencyKey: `${JobTypes.DOCUMENT_EXTRACT}:${doc.id}:classification-${cid}` });
    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, jobId);
    const [rev] = await ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.jobId, jobId));
    expect(rev!.classificationId).toBe(cid);
    const [d] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, doc.id));
    expect(d!.intakeState).toBe("read");
  });

  it("a superseded read does not mark the document read", async () => {
    const doc = await seedStoredDocument();
    const old = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: old, workspaceId: doc.workspaceId, documentId: doc.id, kind: "annual_report", setBy: "maester", companyId: doc.companyId, readsUnderId: old, createdAt: new Date(Date.now() - 60_000) });
    const now = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: now, workspaceId: doc.workspaceId, documentId: doc.id, kind: "annual_report", setBy: "investor", companyId: doc.companyId, readsUnderId: now });
    await ctx.db.update(schema.document).set({ intakeState: "reading" }).where(eq(schema.document.id, doc.id));
    const jobId = await seedJob(ctx.db, doc.workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: doc.id, idempotencyKey: `${JobTypes.DOCUMENT_EXTRACT}:${doc.id}:classification-${old}` });
    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, jobId);
    const [d] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, doc.id));
    expect(d!.intakeState).toBe("reading");
  });

  it("a read that fails for good marks read_failed when it is the current read", async () => {
    reply = streamLines(fixture("stream-error.ndjson"));
    const doc = await seedStoredDocument();
    const cid = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: cid, workspaceId: doc.workspaceId, documentId: doc.id, kind: "annual_report", setBy: "maester", companyId: doc.companyId, readsUnderId: cid });
    await ctx.db.update(schema.document).set({ intakeState: "reading" }).where(eq(schema.document.id, doc.id));
    const jobId = await seedJob(ctx.db, doc.workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: doc.id, idempotencyKey: `${JobTypes.DOCUMENT_EXTRACT}:${doc.id}:classification-${cid}` });
    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, jobId);
    const [d] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, doc.id));
    expect(d!.intakeState).toBe("read_failed");
  });
```

(`stream-error.ndjson` ends with a permanent `NO_STATEMENTS_FOUND` error, so the first attempt is final.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @maester/worker test -- document-verify document-extract` → FAIL (no classify job; no `classificationId`; intake not updated).

- [ ] **Step 3: Verify**

In `document-verify.ts` replace `chainExtraction` with:

```ts
/**
 * Hand a stored document to intake: a second copy of a stored file is marked a
 * duplicate; anything else is classified. Keyed "auto", so a verify retry never
 * enqueues twice, and a classify job runs even without an extractor (it then
 * fails with CLASSIFIER_NOT_CONFIGURED, which the investor sees).
 */
async function chainIntake(job: JobRow, ctx: JobContext, sha256: string): Promise<void> {
  const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, job.subjectId)).limit(1);
  if (!doc || doc.intakeState === "duplicate") return;
  if (doc.intakeState === null) {
    const duplicate = await findStoredDuplicate(ctx.db, job.workspaceId, doc.id, sha256);
    if (duplicate) {
      await ctx.db
        .update(schema.document)
        .set({ intakeState: "duplicate", duplicateOfDocumentId: duplicate.id, updatedAt: sql`now()` })
        .where(eq(schema.document.id, doc.id));
      ctx.logger.info({ documentId: doc.id, duplicateOf: duplicate.id }, "duplicate document");
      return;
    }
    await ctx.db.update(schema.document).set({ intakeState: "identifying", updatedAt: sql`now()` }).where(eq(schema.document.id, doc.id));
  }
  if (doc.intakeState !== null && doc.intakeState !== "identifying") return;
  const next = await createJob(ctx.db, ctx.dispatcher, {
    workspaceId: job.workspaceId,
    type: JobTypes.DOCUMENT_CLASSIFY,
    subjectType: "document",
    subjectId: job.subjectId,
    pipelineVersion: "auto",
  });
  ctx.logger.info({ documentId: job.subjectId, classifyJobId: next.id }, "classification enqueued");
}
```

Import `findStoredDuplicate` from `@maester/db`. Replace both `await chainExtraction(job, ctx);` calls: the early `stored` branch becomes `await chainIntake(job, ctx, doc.contentSha256!);`, the end becomes `await chainIntake(job, ctx, sha256);`.

- [ ] **Step 4: Extract**

In `document-extract.ts`:

1. Add the parameter `classificationId: string | null` to `writeRevision` and set `classificationId,` in the `extractionRevision` insert values.
2. Add a helper:

```ts
/** Mark the document only when this read is the one its current answers point at. */
async function setIntakeIfCurrent(db: Db, workspaceId: string, documentId: string, classificationId: string | null, state: "read" | "read_failed"): Promise<void> {
  if (!classificationId) return;
  const current = await getCurrentClassification(db, workspaceId, documentId);
  if (current?.readsUnderId !== classificationId) return;
  await db
    .update(schema.document)
    .set({ intakeState: state, updatedAt: sql`now()` })
    .where(and(eq(schema.document.id, documentId), eq(schema.document.workspaceId, workspaceId)));
}
```

3. In the handler, before `writeRevision`: 

```ts
  const classificationId =
    classificationIdOfReadJob(job.idempotencyKey) ?? (await getCurrentClassification(ctx.db, job.workspaceId, doc.id))?.readsUnderId ?? null;
```

then `const written = await writeRevision(ctx.db, job, doc, result, classificationId);` and after it `await setIntakeIfCurrent(ctx.db, job.workspaceId, doc.id, classificationId, "read");`.

4. Rename the handler body to `async function extract(job: JobRow, ctx: JobContext)` and export:

```ts
export const documentExtract: JobHandler = Object.assign(extract, {
  async onFinalFailure(job: JobRow, db: Db): Promise<void> {
    const classificationId = classificationIdOfReadJob(job.idempotencyKey) ?? (await getCurrentClassification(db, job.workspaceId, job.subjectId))?.readsUnderId ?? null;
    await setIntakeIfCurrent(db, job.workspaceId, job.subjectId, classificationId, "read_failed");
  },
});
```

Imports: `sql` from `drizzle-orm`; `getCurrentClassification` from `@maester/db`; `classificationIdOfReadJob` from `@maester/jobs`; `JobContext` from `./types.js`. In `apps/worker/test/document-extract.test.ts`, update existing direct calls of `writeRevision(…, result)` to pass `null` as the fifth argument.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @maester/worker test && pnpm --filter @maester/worker typecheck && pnpm --filter @maester/worker lint` → PASS.

- [ ] **Step 6: Checkpoint** — nothing committed.

---

### Task 9: API — upload without a company, the classification endpoints, current figures

**Files:**
- Create: `apps/api/src/routes/classification.ts`
- Modify: `packages/contracts/src/document.ts`, `packages/contracts/src/company.ts`, `apps/api/src/routes/documents.ts`, `apps/api/src/routes/companies.ts`, `apps/api/src/serialize.ts`, `apps/api/src/errors.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/classification.test.ts`; update `apps/api/test/documents.test.ts` only where a `Document` shape assertion breaks

**Interfaces:**
- Consumes: everything from Tasks 1, 5, 6.
- Produces: `GET /v1/workspaces/:ws/documents/:id/classification` → `DocumentClassification`; `POST …/classification` → `ClassificationChanged`; `POST …/classify` → `202 ClassifyJobResponse`; `Document` gains `intakeState`, `duplicateOfDocumentId`, `classification`; `Company` gains `cin`, `bseCode`, `nseSymbol`; `toClassification`, `toEvidence`, `toClassificationSummary`; `isUniqueViolation` moved to `errors.ts`.

- [ ] **Step 1: Contracts**

`packages/contracts/src/company.ts` — add to `Company`: `cin: z.string().nullable(), bseCode: z.string().nullable(), nseSymbol: z.string().nullable(),`.

`packages/contracts/src/document.ts` — import `{ Classification, ClassificationSummary, Evidence, IntakeState }` from `./classification.js`; in `Document` add after `rejectionCode`:

```ts
  intakeState: IntakeState.nullable(),
  duplicateOfDocumentId: Uuid.nullable(),
  classification: ClassificationSummary.nullable(),
```

change `CreateUploadRequest.companyId` to `Uuid.optional()`, and append:

```ts
export const ClassificationChanged = z.object({ document: Document, classification: Classification, evidence: z.array(Evidence) });
export type ClassificationChanged = z.infer<typeof ClassificationChanged>;
```

Run `pnpm --filter @maester/contracts test` and fix any fixture in `packages/contracts/test/` that builds a `Document` or `Company` by adding the new nullable fields as `null`.

- [ ] **Step 2: Write the failing tests**

`apps/api/test/classification.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClassificationChanged, ClassifyJobResponse, Document, DocumentClassification, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const send = (method: string, cookie: string, body?: unknown) => ({
  method, headers: { cookie, "content-type": "application/json", origin: "http://localhost" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function seedDocument(workspaceId: string, userId: string, intakeState: "needs_company" | "read" | "kept" = "needs_company") {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState, createdByUserId: userId,
  });
  return id;
}
async function seedClassification(workspaceId: string, documentId: string, values: Partial<typeof schema.documentClassification.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.documentClassification).values({
    id, workspaceId, documentId, kind: "annual_report", setBy: "maester", companyNameAsPrinted: "Synthetic Cements Limited",
    cin: "L26940MH2001PLC123456", periodLabel: "Year ended 31 March 2026", periodEnd: "2026-03-31",
    statementsFound: [{ statement: "balance_sheet", basis: "standalone", pages: [2] }], ...values,
  });
  for (const [field, quote] of [["kind", "Annual Report 2025-26"], ["company", "Synthetic Cements Limited"], ["statements", "Standalone Balance Sheet as at 31 March 2026"]] as const) {
    await ctx.db.insert(schema.classificationEvidence).values({ id: crypto.randomUUID(), workspaceId, classificationId: id, field, source: "rule", ruleId: `r.${field}`, pageIndex: 0, quote, textLayerMatch: true });
  }
  return id;
}
const url = (ws: string, id: string, tail = "classification") => `/v1/workspaces/${ws}/documents/${id}/${tail}`;

describe("upload without a company", () => {
  it("creates a pending document with no company", async () => {
    const { cookie, workspaceId } = await ctx.signUp("nocompany@example.com");
    const res = await ctx.app.request(`/v1/workspaces/${workspaceId}/documents/uploads`, send("POST", cookie, { originalName: "x.pdf", size: 10, mimeType: "application/pdf" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { document: Document };
    expect(body.document).toMatchObject({ companyId: null, intakeState: null, classification: null });
  });
});

describe("classification", () => {
  it("reads the current classification with its evidence, scoped to the workspace", async () => {
    const a = await ctx.signUp("read-a@example.com");
    const b = await ctx.signUp("read-b@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    expect((await ctx.app.request(url(a.workspaceId, doc), { headers: { cookie: a.cookie } })).status).toBe(404);
    const cid = await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    const body = DocumentClassification.parse(await res.json());
    expect(body.classification).toMatchObject({ id: cid, kind: "annual_report", cin: "L26940MH2001PLC123456" });
    expect(body.evidence).toHaveLength(3);
    expect((await ctx.app.request(url(b.workspaceId, doc), { headers: { cookie: b.cookie } })).status).toBe(404);
    const listed = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents`, { headers: { cookie: a.cookie } });
    const items = ((await listed.json()) as { items: Document[] }).items;
    expect(items.find((d) => d.id === doc)!.classification).toMatchObject({ id: cid, kind: "annual_report" });
  });

  it("rejects a stale basedOn with 409", async () => {
    const a = await ctx.signUp("stale@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const old = await seedClassification(a.workspaceId, doc, { createdAt: new Date(Date.now() - 60_000) });
    await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: old, kind: "other" }));
    expect(res.status).toBe(409);
  });

  it("confirming a new company creates it with its identifiers and starts the read", async () => {
    const a = await ctx.signUp("newco@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const cid = await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, {
      basedOn: cid, company: { new: { displayName: "Synthetic Cements Limited", country: "IN", cin: "L26940MH2001PLC123456" } },
    }));
    expect(res.status).toBe(200);
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification).toMatchObject({ setBy: "investor", readsUnderId: body.classification.id });
    expect(body.document.intakeState).toBe("reading");
    const [company] = await ctx.db.select().from(schema.company).where(eq(schema.company.id, body.classification.companyId!));
    expect(company!.cin).toBe("L26940MH2001PLC123456");
    expect(body.evidence.find((e) => e.field === "company")!.source).toBe("investor");
    expect(body.evidence.find((e) => e.field === "statements")!.source).toBe("rule");
    expect(body.evidence.some((e) => e.field === "identifier")).toBe(false);
    const read = ctx.dispatcher.enqueued.find((j) => j.subjectId === doc && j.type === JobTypes.DOCUMENT_EXTRACT);
    expect(read!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${doc}:classification-${body.classification.id}`);
  });

  it("a company name that already exists is a 409", async () => {
    const a = await ctx.signUp("clash@example.com");
    await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const cid = await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, {
      basedOn: cid, company: { new: { displayName: "Synthetic Cements Limited", country: "IN" } },
    }));
    expect(res.status).toBe(409);
  });

  it("changing only the period keeps the read and its figures", async () => {
    const a = await ctx.signUp("period@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Period Co Limited");
    const doc = await seedDocument(a.workspaceId, a.userId, "read");
    const cid = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: cid, workspaceId: a.workspaceId, documentId: doc, kind: "annual_report", setBy: "maester", companyId, readsUnderId: cid });
    const before = ctx.dispatcher.enqueued.length;
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, periodLabel: "Year ended 31 March 2026", periodEnd: "2026-03-31" }));
    expect(res.status).toBe(200);
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification.readsUnderId).toBe(cid);
    expect(body.document.intakeState).toBe("read");
    expect(ctx.dispatcher.enqueued.length).toBe(before);
  });

  it("changing the kind to other keeps the document and its figures stop being current", async () => {
    const a = await ctx.signUp("toother@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Other Co Limited");
    const doc = await seedDocument(a.workspaceId, a.userId, "read");
    const cid = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: cid, workspaceId: a.workspaceId, documentId: doc, kind: "annual_report", setBy: "maester", companyId, readsUnderId: cid });
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, kind: "other", otherType: "investor_presentation" }));
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification).toMatchObject({ kind: "other", otherType: "investor_presentation", readsUnderId: null });
    expect(body.document.intakeState).toBe("kept");
    expect((await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${doc}/facts`, { headers: { cookie: a.cookie } })).status).toBe(404);
  });

  it("refuses not_sure and an empty change", async () => {
    const a = await ctx.signUp("refuse@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const cid = await seedClassification(a.workspaceId, doc);
    expect((await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, kind: "not_sure" }))).status).toBe(400);
    expect((await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid }))).status).toBe(400);
  });

  it("re-running classification enqueues a fresh job and marks identifying", async () => {
    const a = await ctx.signUp("rerun@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId, "kept");
    const res = await ctx.app.request(url(a.workspaceId, doc, "classify"), send("POST", a.cookie, {}));
    expect(res.status).toBe(202);
    const { job } = ClassifyJobResponse.parse(await res.json());
    expect(job.type).toBe(JobTypes.DOCUMENT_CLASSIFY);
    const [d] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, doc));
    expect(d!.intakeState).toBe("identifying");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @maester/api test -- classification` → FAIL.

- [ ] **Step 4: Serializers and errors**

Move `isUniqueViolation` from `companies.ts` into `errors.ts` as an `export function` and import it in `companies.ts`. In `serialize.ts`:

```ts
export function toCompany(row: CompanyRow): Company {
  return {
    id: row.id, workspaceId: row.workspaceId, displayName: row.displayName, country: row.country,
    cin: row.cin, bseCode: row.bseCode, nseSymbol: row.nseSymbol, createdAt: row.createdAt.toISOString(),
  };
}

export function toClassification(row: ClassificationRow): Classification {
  return {
    id: row.id, documentId: row.documentId, kind: row.kind, otherType: row.otherType, resultsSpan: row.resultsSpan,
    periodEnd: row.periodEnd, periodLabel: row.periodLabel, companyId: row.companyId, companyNameAsPrinted: row.companyNameAsPrinted,
    cin: row.cin, bseCode: row.bseCode, nseSymbol: row.nseSymbol,
    statementsFound: row.statementsFound as Classification["statementsFound"], setBy: row.setBy, readsUnderId: row.readsUnderId,
    warnings: row.warnings, createdAt: row.createdAt.toISOString(),
  };
}

export function toClassificationSummary(row: ClassificationRow): ClassificationSummary {
  const c = toClassification(row);
  return { id: c.id, kind: c.kind, otherType: c.otherType, resultsSpan: c.resultsSpan, periodLabel: c.periodLabel, companyId: c.companyId, companyNameAsPrinted: c.companyNameAsPrinted, setBy: c.setBy };
}

export function toEvidence(row: EvidenceRow): Evidence {
  return { field: row.field, source: row.source, ruleId: row.ruleId, pageIndex: row.pageIndex, quote: row.quote, textLayerMatch: row.textLayerMatch };
}
```

and change `toDocument` to `toDocument(row: DocumentRow, latestJob: JobRow | null, classification: ClassificationRow | null = null)`, adding `intakeState: row.intakeState, duplicateOfDocumentId: row.duplicateOfDocumentId, classification: classification ? toClassificationSummary(classification) : null,`.

- [ ] **Step 5: Documents route**

In `documents.ts`:
- Upload: replace the company check with `if (input.companyId && !(await getCompany(deps.db, workspace.id, input.companyId))) { … }` and insert `companyId: input.companyId ?? null`.
- List and detail: pass `await getCurrentClassification(deps.db, workspace.id, d.id)` as the third argument of `toDocument`.
- `/extraction` and `/facts` without `revisionId`: use `getCurrentRevision` instead of `getLatestRevision`.

- [ ] **Step 6: The classification routes**

`apps/api/src/routes/classification.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  ChangeClassificationRequest, JobTypes,
  type ClassificationChanged, type ClassifyJobResponse, type DocumentClassification, type EvidenceField,
} from "@maester/contracts";
import { getCurrentClassification, getDocument, getLatestJobForSubject, listEvidence, schema, type ClassificationRow, type Db } from "@maester/db";
import { createJob, decideIntake, READ_KINDS } from "@maester/jobs";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { uuidParam } from "../middleware/params.js";
import { toClassification, toDocument, toEvidence, toJob } from "../serialize.js";
import { validate } from "../validation.js";

export function classificationRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id/classification", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const current = await getCurrentClassification(deps.db, workspace.id, doc.id);
    if (!current) throw new HttpError("NOT_FOUND", "document has not been identified yet");
    const evidence = await listEvidence(deps.db, workspace.id, current.id);
    const body: DocumentClassification = { classification: toClassification(current), evidence: evidence.map(toEvidence) };
    return c.json(body);
  });

  r.post("/:id/classification", validate("json", ChangeClassificationRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    const userId = c.get("user").id;
    const documentId = uuidParam(c, "id");

    let created: { row: ClassificationRow; read: boolean };
    try {
      created = await deps.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        const [locked] = await tx
          .select()
          .from(schema.document)
          .where(and(eq(schema.document.id, documentId), eq(schema.document.workspaceId, workspace.id)))
          .for("update");
        if (!locked) throw new HttpError("NOT_FOUND", "document not found");
        const prev = await getCurrentClassification(db, workspace.id, documentId);
        if (!prev) throw new HttpError("INVALID_STATE", "document has not been identified yet");
        if (prev.id !== input.basedOn) {
          throw new HttpError("CONFLICT", "the answers changed since you loaded them; reload and try again", [{ path: "basedOn", message: "not current" }]);
        }

        let companyId = prev.companyId;
        if (input.company && "id" in input.company) {
          const [found] = await tx.select().from(schema.company).where(and(eq(schema.company.id, input.company.id), eq(schema.company.workspaceId, workspace.id)));
          if (!found) throw new HttpError("VALIDATION_FAILED", "company not found in this workspace", [{ path: "company.id", message: "unknown company" }]);
          companyId = found.id;
        } else if (input.company) {
          const n = input.company.new;
          const [company] = await tx
            .insert(schema.company)
            .values({ id: crypto.randomUUID(), workspaceId: workspace.id, displayName: n.displayName, country: n.country, cin: n.cin ?? null, bseCode: n.bseCode ?? null, nseSymbol: n.nseSymbol ?? null, createdByUserId: userId })
            .returning();
          companyId = company!.id;
        }

        const kind = input.kind ?? prev.kind;
        const otherType = kind === "other" ? (input.otherType ?? (prev.kind === "other" ? prev.otherType : null) ?? "unlisted_type") : null;
        const resultsSpan = kind === "financial_results" ? (input.resultsSpan !== undefined ? input.resultsSpan : prev.resultsSpan) : null;
        const periodEnd = input.periodEnd !== undefined ? input.periodEnd : prev.periodEnd;
        const periodLabel = input.periodLabel !== undefined ? input.periodLabel : prev.periodLabel;

        const changed = new Set<EvidenceField>();
        if (kind !== prev.kind) changed.add("kind");
        if (otherType !== prev.otherType) changed.add("other_type");
        if (companyId !== prev.companyId) changed.add("company");
        if (periodEnd !== prev.periodEnd || periodLabel !== prev.periodLabel) changed.add("period");
        if (resultsSpan !== prev.resultsSpan) changed.add("results_span");
        if (changed.size === 0) throw new HttpError("VALIDATION_FAILED", "nothing changed");

        const isRead = READ_KINDS.has(kind);
        const read = isRead && companyId !== null && (changed.has("kind") || changed.has("company") || prev.readsUnderId === null);
        const id = crypto.randomUUID();
        const [row] = await tx
          .insert(schema.documentClassification)
          .values({
            id, workspaceId: workspace.id, documentId, kind, otherType, resultsSpan, periodEnd, periodLabel, companyId,
            companyNameAsPrinted: prev.companyNameAsPrinted, cin: prev.cin, bseCode: prev.bseCode, nseSymbol: prev.nseSymbol,
            statementsFound: prev.statementsFound, setBy: "investor", setByUserId: userId,
            readsUnderId: read ? id : isRead ? prev.readsUnderId : null,
            rulesVersion: prev.rulesVersion, model: prev.model, promptVersion: prev.promptVersion, warnings: prev.warnings,
          })
          .returning();

        const dropped = new Set<string>(changed);
        if (changed.has("company")) dropped.add("identifier");
        const carried = (await listEvidence(db, workspace.id, prev.id)).filter((e) => !dropped.has(e.field));
        const rows = [
          ...carried.map((e) => ({ ...e, id: crypto.randomUUID(), classificationId: id })),
          ...[...changed].map((field) => ({
            id: crypto.randomUUID(), workspaceId: workspace.id, classificationId: id, field, source: "investor" as const,
            ruleId: null, pageIndex: null, quote: null, textLayerMatch: null,
          })),
        ];
        if (rows.length) await tx.insert(schema.classificationEvidence).values(rows);
        return { row: row!, read };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError("CONFLICT", "a company with this name or identifier already exists", [{ path: "company.new", message: "already exists" }]);
      }
      throw err;
    }

    await decideIntake(deps.db, deps.dispatcher, created.row, { read: created.read });
    const doc = (await getDocument(deps.db, workspace.id, documentId))!;
    const job = await getLatestJobForSubject(deps.db, workspace.id, "document", documentId);
    const evidence = await listEvidence(deps.db, workspace.id, created.row.id);
    const body: ClassificationChanged = { document: toDocument(doc, job, created.row), classification: toClassification(created.row), evidence: evidence.map(toEvidence) };
    return c.json(body);
  });

  r.post("/:id/classify", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}; only stored documents can be classified`);
    await deps.db.update(schema.document).set({ intakeState: "identifying", updatedAt: sql`now()` }).where(eq(schema.document.id, doc.id));
    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id, type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: doc.id,
      pipelineVersion: `manual-${crypto.randomUUID()}`,
    });
    const body: ClassifyJobResponse = { job: toJob(job) };
    return c.json(body, 202);
  });

  return r;
}
```

In `app.ts`, import `classificationRoutes` and add `ws.route("/documents", classificationRoutes(deps));` right after the `documentRoutes` line. If `deps.dispatcher`'s type is the API's own `RecordingDispatcher`/dispatch interface, confirm it is assignable to `@maester/jobs`' `Dispatcher` (both are `{ enqueue(job: JobRow): Promise<void> }`); `apps/api/src/jobs/create.ts` already uses the same shape.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @maester/api test && pnpm --filter @maester/api typecheck && pnpm --filter @maester/api lint` → PASS. Existing `documents.test.ts` and `extraction.test.ts` must still pass; documents seeded without a classification keep their newest revision as current.

- [ ] **Step 8: Checkpoint** — nothing committed.

---

### Task 10: Documentation and configuration

**Files:**
- Modify: `docs/EXTRACTION.md`, `docs/ARCHITECTURE.md` (only the pipeline line, if it describes verify → extract), `apps/worker/README.md` (if it lists job types or env), `apps/api/README.md` (endpoints), `.env.example` and `docker-compose.yml` (only where `EXTRACT_MAX_BYTES` or the extractor's model env appear), `CONTRIBUTING.md` ("What exists today")

- [ ] **Step 1: Update the docs**

- `docs/EXTRACTION.md`: under "Changes during implementation" add "Document intake (5 October 2026): verify now hands over to `document.classify`, which works out what the PDF is before anything is read; see the [intake spec](superpowers/specs/2026-10-05-document-intake-classification-design.md). `EXTRACT_MAX_BYTES` defaults to 50 MiB." Update the §2 diagram's first line to `upload (company optional) → document.verify ─stored─► document.classify ─decide─► document.extract`. In §7, replace the sentence that ties the 30 MiB default to Cloud Run with "`EXTRACT_MAX_BYTES` defaults to 50 MiB, matching `MAX_UPLOAD_BYTES`." Do not add or remove any other Cloud Run statement.
- `apps/api/README.md`: list `GET/POST /documents/:id/classification` and `POST /documents/:id/classify`; note `companyId` is optional on upload.
- `CONTRIBUTING.md` "What exists today": add "Upload a PDF without choosing a company; Maester works out whether it is an annual report, financial results or another company document, for which company and period, with the page each answer came from, then reads it, holds it for you or keeps it."
- Wherever `.env.example` or `docker-compose.yml` set `EXTRACT_MAX_BYTES=31457280`, change to `52428800`; add `GEMINI_CLASSIFY_MODEL` next to `GEMINI_MODEL` if that variable is listed there.

- [ ] **Step 2: Full verification**

Run, from the repo root:

```bash
pnpm db:up
pnpm typecheck && pnpm lint && pnpm test
uv run --locked python -m unittest discover -s tests -v
```

Expected: all PASS. Then `pnpm --dir apps/web verify` → PASS (the web app imports `@maester/contracts` types only through its own copies; if it imports `Document`, fix the new nullable fields there).

- [ ] **Step 3: Checkpoint** — report the full list of changed files to the user and ask whether to commit.

---

## Self-review notes

- Spec §1 kinds → Tasks 1–3; §2 architecture → Tasks 4, 6, 7, 8; §3 data model → Task 5 (+ `reads_under_id`, nullable quote); §4 rules and model → Tasks 2–3; §5 API → Task 9; §6 errors → Tasks 3 (model fallbacks), 4 (endpoint errors), 7 (job failures, `identify_failed`), 8 (duplicate, `read_failed`); §7 testing → every task; §8 out of scope respected (no UI, no cancel).
- Names used across tasks: `READ_KINDS`, `readVersion`, `classificationIdOfReadJob`, `decideIntake`, `writeClassification`, `writeRevision(…, classificationId)`, `getCurrentClassification`, `getCurrentRevision`, `matchCompanies`, `findStoredDuplicate`, `ClassificationChanged`, `ClassifyJobResponse`.
