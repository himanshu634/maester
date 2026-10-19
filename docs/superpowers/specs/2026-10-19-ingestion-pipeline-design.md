# Ingestion pipeline: design

Status: draft for review, 19 October 2026. The decisions it rests on are recorded in [ADR 0007](../../decisions/0007-ingestion-pipeline.md). It amends the [financial data layer](2026-10-15-financial-data-layer-design.md) in two places, named in §14: XBRL ingestion and OCR leave its out-of-scope list, and for a filing with XBRL the reader is XBRL, not the two PDF readers of [ADR 0006](../../decisions/0006-concepts-calculations-agent-access.md).

## 1. Goal

When the investor uploads a filing, Maester turns it into two things, in parallel with the other files it is working on:

1. **Numbers** in Postgres, each a fact with its source, basis, unit and period, so figures can be lined up across filings and companies. When the filing has an XBRL version, the numbers come from XBRL and nothing else. When it does not, Gemini reads the PDF as it does today.
2. **Text** in a vector index: every page's words, by the text layer or by OCR, split into passages that keep their page, embedded and stored with pgvector, so a later search or agent can find what a filing says.

And it measures how accurate the numbers are, because filing formats vary and a wrong figure is the failure that matters.

## 2. What the investor decided

These are the investor's calls, 19 October 2026. Everything else in this document is the designer's and is open to change.

- **XBRL is exclusive for numbers.** If a filing has an XBRL version, its figures come only from XBRL. Gemini does not read the statements of that filing.
- **Text goes to an embedder** and into the database as vector indexes.
- **No budget.** OCR and embeddings run free and locally, on open-source software; no paid embedding API. Claude OCR is allowed only as an optional setting.
- **pgvector in Postgres**; a separate instance only if needed.
- **Parallel parsing and processing** of uploaded files.
- **Accuracy is measured.**
- **The Documents screen** shows the new pipeline (designed separately, §12).
- **The XBRL on hand.** The investor downloads BSE results XBRL with their own script (`maester-filings/download-xbrl.mjs`): 806 instances so far, on SEBI's `in-capmkt` taxonomy (2025-01-31 and 2026-01-31 entry points), BSE's `in-bse-fin` (2020-03-31) and the banking taxonomy. No MCA AOC-4 instances: those need an MCA login and a fee.
- **Order**: the text index before XBRL (the investor's first instruction was "focus on chunking and extracting information from the PDFs"); Claude as a statement reader comes after both.

## 3. Goals, non-goals, anti-goals

**Goals**

- Every stored filing is processed without the investor waiting on one file to finish before the next starts, and without a large filing starving the rest.
- Every figure from XBRL is a fact as trustworthy as one read from a page: source, element, period, basis, unit and precision recorded, unknown kept unknown.
- Every stored document has a current text index whose results cite a document and a page (or, for XBRL text, an element).
- Accuracy is a committed report, not a feeling.

**Non-goals**

- Fetching filings or XBRL from BSE, NSE or MCA. The investor downloads and uploads them. (Fetching would be scraping, which this project does not do; MCA also needs a login and a fee.)
- A search or chat screen, MCP tools over the index, Claude as a statement reader.
- Segment, borrowing and other note facts from XBRL beyond the three statements (they follow the data layer's phase 5).

**Anti-goals** (a failure even if everything else works)

- A figure from XBRL silently topped up by a figure Gemini read, or the reverse, in one column.
- A number read from a chunk or OCR text shown or handed to an agent as a figure.
- OCR text treated as a PDF's text layer.
- Filing text in logs, traces or errors; a chunk, vector or fact visible outside its workspace.
- A paid API call on the default path.

## 4. Today

The pipeline as built is drawn in the artifact "Maester filing pipeline" and described in §2.1 of the data-layer spec. In short:

- `document.verify` stores and hashes the file, accepts only PDFs (`%PDF-`), and marks a second copy a duplicate. It chains `document.classify`: rules over the title pages, then Gemini 2.5 Flash on a small sub-PDF. An annual report or results filing with a confirmed company goes to `document.extract`: Gemini 2.5 Pro locates, extracts, checks and corrects the three statements, and the worker writes an immutable revision of facts, each with a page.
- Jobs are pushed to the worker over HTTP (`LocalHttpDispatcher`, or Cloud Tasks) with **no limit on how many run at once**. The extractor runs each request on a thread.
- Nothing reads a scanned page's text, nothing reads XBRL, and nothing is kept for search.
- `maester-eval` (on `feat/eval-baseline`) can run, label and score extraction against a gold set; the gold set is empty. The corpus manifest of 491 BSE filings of 50 companies (99 annual reports, 392 results), split by company, is on `feat/eval-corpus`. Neither branch is on `staging` yet.

## 5. Architecture

```text
upload (PDF or XBRL .xml, several at once)
   │
   ▼
document.verify ── type, hash, duplicate ─┬─► document.classify ─► decide numbers source
   (worker)                               │       ├─ XBRL document ─────────► document.xbrl ─► facts (source xbrl)
                                          │       └─ PDF, no XBRL covers it ─► document.extract ─► facts (source pdf)
                                          │
                                          └─► document.index ─► indexer: read pages, OCR scans, chunk, embed ─► pgvector
```

Four services, as today plus one:

| Service | Runtime | Does | New |
| --- | --- | --- | --- |
| API | TypeScript | Uploads, documents, research, search route. Embeds a search query through the indexer. | Accepts XML; pipeline status per document; search route. |
| Worker | TypeScript | Runs jobs, writes the database. | Pulls jobs from Postgres with per-type limits (§9); `document.xbrl`, `document.index`. |
| Extractor | Python | Classification and Gemini extraction, stateless. | `/v1/xbrl`: reads an XBRL instance into facts. |
| **Indexer** | Python | Reads pages (text layer, Docling layout, local OCR), chunks, embeds. Stateless; holds the embedding model in memory. | All of it. |

The indexer is its own service so a 300-page scan running OCR on the CPU never holds up classification or a Gemini read, and so the embedding model is loaded once. It never touches the database or the blobs; the worker streams it the file and writes what comes back, as with the extractor.

## 6. Intake

### 6.1 Accepting XBRL

- The drop strip and the upload route accept `.xml` (`application/xml`, `text/xml`) beside PDF, up to the same 50 MB. The screen's copy changes with the Documents design (§12).
- `document.verify` keeps its exact check that a PDF starts with `%PDF-`, and adds: a file is XBRL when, after an optional byte-order mark and whitespace, it is XML whose root element is `xbrl` in the XBRL instance namespace (`http://www.xbrl.org/2003/instance`), read with a streaming parser that refuses DTDs. Anything else is refused (`NOT_A_PDF` becomes `UNSUPPORTED_TYPE`, with the copy updated).
- **Many at once.** The 806 instances on hand are uploaded through the same API by a small command (`pnpm --filter @maester/cli import <folder>`, or the existing CLI if it fits), one upload per file, so a folder goes in without dragging; the job limits (§9) pace the work.
- A new column `document.format` (`pdf`, `xbrl`) records which. The storage key's file name follows it (`original.pdf`, `original.xml`).
- Inline XBRL (XHTML) is not accepted in this version; Indian filings are plain XBRL.

### 6.2 Classifying an XBRL document

No model. The extractor's `/v1/xbrl` (§7) is called in classify mode and returns, from the instance alone:

| Answer | From |
| --- | --- |
| Kind | The entry point (`schemaRef`): MCA AOC-4 taxonomies give `annual_report`; the BSE results taxonomy (`in-bse-fin`) and SEBI's Integrated Filing taxonomy (`in-capmkt`) give `financial_results`. An unknown entry point is `not_sure`. |
| Company | The context entity identifier. BSE results instances carry a scrip code or a symbol, never a CIN, under several scheme URIs (at least six, one malformed: `http://www.bseindia.com/in-capmkt:/ScripCode`); the scheme is normalised by a tested table to "BSE code" or "NSE symbol" and matched to `company.bse_code` or `company.nse_symbol`. An MCA instance carries a CIN (`http://www.mca.gov.in/CIN`), matched first. A scheme not in the table leaves the company for the investor. |
| Basis | `NatureOfReportStandaloneConsolidated` (or the results taxonomy's equivalent). An instance with both bases, or none, is `unknown` and is held for the investor. |
| Period | The quarter's end (`DateOfEndOfReportingPeriod` on the `OneD` context). The classification's `results_span` is the quarter's. |
| Periods inside | A results instance holds several periods with one end date: the quarter (`OneD`), the year to date (`FourD`: a half year in Q2, nine months in Q3, the full year in Q4) and balance-sheet instants (`OneI`, and the prior year's). Every fact carries its own span and start (§7.2). |

The answers are written as a classification with evidence source `rule` and, instead of a page and quote, the element and context they came from. `decideIntake` then runs unchanged: a confirmed company goes on, an unknown company is held for the investor, exactly as for a PDF.

### 6.3 Which source the numbers come from

A **slot** is one company, one statement, one basis, one period end and one span. Coverage is per statement: a Q1 results instance with no cash flow covers the P&L slot and not the cash-flow one.

1. **XBRL wins a slot outright.** When a current XBRL revision has facts for a slot, every figure in that slot comes from it. A line XBRL does not carry is absent from that column, never filled from a PDF. A slot XBRL does not cover (a statement it does not tag) is read from the PDF as before.
2. **Skipping Gemini.** When a PDF is classified and XBRL revisions already cover every statement and basis the classifier found, `document.extract` is not enqueued: the PDF goes to `ready` with its numbers "from XBRL" (§11). When XBRL covers some only, Gemini reads the PDF and only the uncovered slots are used.
3. **Dropped together.** Before enqueuing `document.extract`, intake looks for XBRL documents of the same workspace that have not settled (verifying, identifying, or reading) or that are held for the investor and could match this PDF's company and period. If there are any, the PDF waits in a new intake state `waiting_for_xbrl`; when each such XBRL document settles (read, failed, kept, or confirmed for another company), the waiting PDFs of that company are decided again. A PDF never waits on an XBRL document that failed.
4. **XBRL arriving later.** When XBRL lands after Gemini read the PDF, the XBRL revision takes the slots it covers; the Gemini revision stays, unused for those slots, and is still scored by the evaluation (§10).
5. **Unknown taxonomies cover nothing.** A bank, insurer or NBFC instance (their own taxonomies, not vendored in this version) fails with `XBRL_TAXONOMY_UNKNOWN`, covers no slot, and the PDF is read as before.
6. **Removing XBRL.** If an XBRL document is deleted (deletion is not built yet), its slots fall back to the newest PDF revision.

The rule is one TypeScript function in `@maester/financial-engine`, used by the API's stitch and later the series, with a Python twin in `apps/eval`; both are tested against the same fixture file of slot cases, so they cannot drift.

It is the same rule `stitch.ts` already applies between filings ("a column comes whole from the newest filing that prints it"), with source precedence added before recency.

**Open, the investor's call: annual figures from a Q4 instance.** An audited March-quarter (Q4) results instance carries the full year's P&L and cash flow (`FourD`) and the year-end balance sheet (`OneI`). Whether those full-year facts fill the annual slots of the Research table, so Gemini need not read the annual report's statements for that year, is undecided. They are the results format, with fewer lines than the annual report's statements.

## 7. Numbers from XBRL

### 7.1 Reading

`/v1/xbrl` on the extractor, behind `EXTRACTOR_SECRET`, takes the instance and answers NDJSON like `/v1/extract` (`started`, `progress`, `result` or `error`).

- **Parser**: Arelle (Apache-2.0), in-process, offline (`internetConnectivity = offline`), with the taxonomies vendored in the image as pinned packages: SEBI's `in-capmkt` (2025-01-31 and 2026-01-31 entry points) and BSE's `in-bse-fin` (`Ind-AS_entry_point_2020-03-31.xsd`, `in-bse-fin-2020-03-31.xsd`), the ones the investor's files use. MCA's Ind AS and C&I taxonomies are added only when an AOC-4 instance is on hand. The instances' `schemaRef` is a bare file name (`in-capmkt-ent-2026-01-31.xsd`), not a URL, so the extractor resolves it by file name against the vendored packages before Arelle loads it; an XML catalog then maps the packages' own absolute imports. An entry point that is not vendored fails with `XBRL_TAXONOMY_UNKNOWN`, never a network fetch.
- **Untrusted input**: external entities and DTDs off, no network, a size and fact-count limit, a parse deadline. A malformed instance fails `XBRL_UNREADABLE`.
- **What comes back**, per fact: element QName, context (entity, period start and end or instant, dimension members), unit, `decimals`, the value as a decimal string or nil, footnotes; per statement, from the presentation linkbase, the statement, the section, the order and the standard label; and the calculation linkbase's results.

### 7.2 Facts

An XBRL read writes an `extraction_revision` like a PDF read, so the Research table, the figure panel and the evaluation keep one shape.

- `extraction_revision` gains `source` (`pdf`, `xbrl`). For XBRL: `model` is `arelle-<version>`, `prompt_version` is the entry point and taxonomy version, `page_count` is 0.
- One `financial_fact` per numeric fact of the three statements, with no dimension member (dimensional facts, such as segments, wait for the data layer's phase 5):
  - `statement`, `section`, `line_order`, `reported_label` from the presentation linkbase and the standard label;
  - `period_label` from the context, written the way the statement table heads columns, and two new columns pulled forward from the data layer's phase 4 with its names: `span` (`quarter`, `half_year`, `nine_months`, `full_year`, null for an instant) and `period_start`;
  - **unit as the filing states it.** Values in the instance are full rupees. The rounding the filing declares (`LevelOfRoundingUsedInFinancialStatements`: crores, lakhs, millions, thousands, actual) gives `unit_label` (`₹ crore`) and `scale_factor` (10,000,000); `reported_value` is the value divided by it and `normalized_value` the value itself, so the Research table keeps the statement's own unit and an XBRL filing never switches a table into full rupees. `reported_text` is the value as written in the instance. `currency` from the unit (`INR`). `decimals` is not the unit (one Mahindra & Mahindra instance declares crores and mixes −5, −6 and −7 in one statement); it is kept in `xbrl_source` and used only as the tolerance of the taxonomy checks. Restatement compares at the declared rounding.
  - nil (`xsi:nil="true"`) is `value_status = unparsed` with the reason `XBRL_NIL`: unknown, never zero.
- A new `xbrl_source` row per fact takes the place of `source_reference`: the XBRL document, element, context id, `decimals` and footnote ids. Readers of facts change with it: `listFactsWithSourcesForRevisions` inner-joins `source_reference` today and would drop every XBRL fact, so it left-joins both; the research contract's `CellSource` (and `Restated`) gains a source variant `{ kind: "xbrl", documentId, element, context }` beside the page one, which today requires a page. These ship in phase 4 with the figure panel built from the design round (§12).
- **Where results figures show.** The Research table shows annual figures only today (`counts()` and stitch read annual reports). Quarter, half-year and nine-month facts from XBRL are stored now and appear when the data layer's phase 4 builds the quarter view.
- **Concepts.** Each element maps to a concept in `packages/contracts/concepts.json` by an explicit table (`xbrl_element_map`, versioned with the mapping rules). An "Others" or next-best-fit element maps to nothing. Until the data layer's phase 1 builds `concept_mapping`, the map is used by the evaluation only; then it writes mappings with source `xbrl_rule`.

### 7.3 Checks

- **The taxonomy's sums.** Each calculation relationship becomes an `extraction_check` (`subtotal`) with its expected and actual values, rounded per `decimals`; a failure names its cells, as today. A balance identity on total assets.
- **Against the PDF, never instead of XBRL.** When a PDF for the same slot is stored, each XBRL value is looked for on the text layer of the pages the classifier found for that statement and basis, in the units the PDF prints, with `text_layer_match` from `values.py`. The result is a check, `xbrl_in_pdf`: `passed`, `failed` with the value, or `not_checked` (no PDF, a scan, or no statement pages). A failure is shown on the figure ("Not found on the PDF's statement pages") and in the report; it never changes the figure. The investor can turn the check off (`XBRL_PDF_CHECK=false`).

Why the check: MCA accepts that its XBRL rendering can differ from the published accounts, and in 2026 NSE queried several companies over XBRL results that did not match their PDFs. The investor chose XBRL exclusively; the check makes a mismatch visible at no cost.

## 8. Text index

### 8.1 Reading pages

The indexer's `/v1/index` takes the file and answers NDJSON: `started` (versions), `page`, `chunk`, `progress`, then `result` or `error`.

- **PDF**: Docling (MIT), on the CPU, reads layout, reading order, headings and tables per page. A page with a usable text layer takes its words from it. A scan (no text layer, or one the indexer's rule finds unusable) goes through Docling's local OCR engine; which engine (RapidOCR, EasyOCR or Tesseract, all free) is chosen by the OCR spot check (§10.4). Pages are processed with a bounded number in flight (`INDEX_PAGE_CONCURRENCY`, default 2).
- **Claude OCR**, optional (`OCR_ENGINE=claude`): the page as a one-page PDF to `claude-sonnet-5-5` through the official `anthropic` SDK, asked for the text exactly as printed; refusal fallback on, the answering model recorded. Off by default because it is paid.
- **XBRL**: text-block facts (accounting policies, notes, the directors' report where present, as escaped HTML) are converted to plain text and become chunks with `text_source = xbrl` and their element instead of a page.

The "unusable text layer" rule lives in the indexer only. `PdfDocument` and everything that reads it stay as they are; moving the rule there would change the text-layer reader and need its own evaluation run. A page can therefore count as text layer on the slip and as OCR in search.

### 8.2 OCR rules

1. OCR text is stored with `text_source = ocr` and the engine and version, and is labelled so wherever it appears.
2. It is never read by Gemini extraction, the correction guard, the classifier's quote check, reader B, the XBRL check or any other check.
3. Feeding OCR text to any of those later is a change to a reader and needs its own design and evaluation run.

### 8.3 Chunks

From Docling's document structure, deterministic and versioned (`chunker_version`):

- **Within a page.** A chunk never crosses a page, so every citation is one page. Docling's chunker may join across pages; the indexer splits at page breaks.
- **Sections.** Docling's headings give each chunk its section path ("Notes to the standalone financial statements" › "25 Borrowings").
- **Size.** About 500 tokens, at most 1,000, measured with the embedding model's own tokenizer; tables kept whole when they fit, split by rows with the header repeated when not.
- **Boilerplate.** Running headers and footers repeated on most pages are dropped from chunks and kept in the page text.

### 8.4 Embeddings

- An open-source model, run in the indexer with sentence-transformers on the CPU, loaded once. Candidates, all 1024-dimensional and permissively licensed: `voyage-4-nano` (Apache-2.0, 0.3B, 32k context), `Qwen3-Embedding-0.6B` (Apache-2.0), `BGE-M3` (MIT). The retrieval test (§10.3) picks the default; `EMBEDDING_MODEL` names it, read by the indexer, the worker and the API alike.
- `/v1/embed` on the indexer takes a batch of texts and an input type (document or query) and returns vectors. The worker embeds chunks through it in batches (`EMBED_BATCH`, default 32); the API embeds a search query through it.
- Model weights are downloaded once when the image is built, not at run time, and pinned by revision.

### 8.5 Search

`searchChunks(db, { workspaceId, query, limit, companyId?, documentIds? })` in a shared package, behind `GET /v1/workspaces/:workspaceId/search?q=&limit=&company=` (session required, member of the workspace):

1. Embed the query through the indexer, on `EMBEDDING_MODEL`.
2. Top 50 by cosine distance among the workspace's current chunks for that model; top 50 by `ts_rank` on `websearch_to_tsquery`.
3. Merge by reciprocal rank (k = 60); return up to `limit` (default 10, at most 50): document, company, page or element, section path, text source, the text and both ranks.

A result carries no figure. No screen in this project.

## 9. Parallel processing

Today every job is pushed to the worker the moment it is created, with nothing to stop ten large files reading at once and exhausting the machine. The worker becomes a **pull-based runner over the existing `job` table**:

- **Retries with backoff.** `job` gains `run_after` (default now). A failed attempt that will be retried sets it to now plus 30 seconds doubled per attempt, at most 15 minutes, so a Vertex 429 or a down indexer does not burn all five attempts in seconds. The claim query takes only jobs whose `run_after` has passed. `retryJob` in the API, which re-queues by hand, also notifies.
- **Claiming.** Each worker process runs one loop per job type. A loop claims the oldest ready job of its type with `UPDATE … WHERE id = (SELECT id FROM job WHERE type = $1 AND ((state = 'queued' AND run_after <= now()) OR (state = 'running' AND lease_expires_at < now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, using the lease, attempt and progress columns that already exist (`acquireLease`, `renewLease`). Two worker processes never take the same job.
- **Limits per type**, as settings, defaults chosen for one machine:

| Job | Concurrent jobs | Why |
| --- | --- | --- |
| `document.verify` | 4 | I/O only. |
| `document.classify` | 2 | One small Gemini call each. |
| `document.xbrl` | 2 | CPU, Arelle in memory. |
| `document.extract` | 2 | Many Gemini calls; the Vertex quota. |
| `document.index` | 1 | Docling and OCR use every core; inside a job, pages run `INDEX_PAGE_CONCURRENCY` at a time. |

- **Waking.** A created job is picked up by the next poll (every second while a loop is idle, `JOB_POLL_MS`) and, to start at once, by `NOTIFY job_created` from `createJob`, which the loops `LISTEN` for. The `Dispatcher` interface stays for tests; `LocalHttpDispatcher` is replaced by the notifier. The Cloud Tasks dispatcher is kept but unused while hosting is undecided.
- **Fairness.** Within a type, jobs run oldest first. Classification and XBRL reads are short and have their own loops, so a long index job never delays a new upload's "what is it" step.
- **Uploads.** The API already accepts any number of uploads; several files dropped at once each get their own document and jobs. The one-file rule is the screen's, and it changes with the Documents design (§12).
- **Many processes.** The limits are per worker process. Running two worker processes doubles them; the indexer is then the shared bottleneck and gets its own replica count.

## 10. Measuring accuracy

### 10.1 Figures against a gold set

`maester-eval` (phase 0 of the data layer, on `feat/eval-baseline`) is the measure: a run's facts against hand-checked gold, as exact decimals, value, sign, scale, basis and period together, stratified by digital or scanned, annual or results, and basis. This project adds:

- **Source** as a stratum: `xbrl` or `pdf`. XBRL revisions are scored against the same gold, so XBRL's own errors are measured.
- **Format** tags in the manifest, filled from the filings: unit (lakh, crore, thousand, million, rupees), two-page spreads (already `printed_pages_per_page`), negatives in brackets, restated columns, and `financials` (banks and NBFCs). The report shows exact match per tag, which is how "various formats cause issues" becomes a number.

The gold set is the investor's time: sheets exported pre-filled, each cell checked against the PDF and marked verified. A first gold set of 10 to 15 development filings chosen to cover the format tags is enough to start.

### 10.2 Gemini against XBRL, on every filing that has both

A new `maester-eval compare --run <run> --xbrl` scores a Gemini run against the XBRL revisions of the same slots, cell by cell, with no gold needed. The manifest gains an `xbrl` list per filing, pairing each PDF with its instances by BSE code, period and basis (filled from the investor's `xbrl-manifest.csv`), and a matching rule: XBRL facts carry concepts through `xbrl_element_map`, Gemini facts through the gold sheet's concept column, and cells are compared by concept, basis, span and period. The gold set is already keyed by concept (freeze refuses a verified row without one), so the evaluation matches XBRL facts to gold by concept in this project, before the data layer's phase 1 builds concept mapping for Gemini facts in the product. The report gives agreement, disagreement and lines only one side has, by format tag. A disagreement is not proof Gemini is wrong, because XBRL can be wrong too; the report lists disagreements for the investor to settle against the PDF, and settled cells can be frozen into gold. This scales the measure to every corpus filing with an XBRL version.

### 10.3 Retrieval

Forty or more questions over development filings, each with the page or pages that answer it, drafted by the builder from the filings and corrected by the investor; stored under `data/eval/retrieval/`, git-ignored. Recall at 5 and 10 and mean reciprocal rank, by text source, for vectors, keywords and hybrid, per candidate embedding model. The best hybrid recall at 10 becomes `EMBEDDING_MODEL`. The set waits for phase 0's development split; nothing else in this project does.

### 10.4 OCR

Ten scanned pages compared by hand with each free OCR engine's text: how many numbers and headings are wrong, and the seconds per page on the investor's machine. The best engine becomes the default. If the development set has fewer than ten scanned pages, the investor adds scanned filings to the corpus first.

All reports are committed under `docs/eval/`.

## 11. Status for the screen

The Documents screen will be redesigned (§12). The API gives it one object per document so the design is not limited by what the backend exposes:

```ts
pipeline: {
  stored:  "done" | "now" | "failed",
  identified: "done" | "now" | "needs_you" | "failed",
  numbers: { source: "xbrl" | "pdf" | null, state: "done" | "now" | "not_needed" | "failed" | "waiting",
             covered_by_xbrl?: DocumentId },
  text:    { state: "done" | "now" | "partial" | "failed" | "waiting",
             pages: number, pages_read: number, pages_ocr: number, chunks: number },
}
```

It is computed from the jobs and revisions on read, never stored. Index jobs use the subject type `document_index`, so the existing `latestJob` the slip reads today keeps showing intake only until the new screen reads `pipeline`.

## 12. The Documents screen

Not designed here. `CLAUDE.md` sends any page design through the `design-directions` skill: mockups on a canvas first, code only after the investor picks a direction. That round must cover, and `DESIGN.md` §5 must be amended for:

- the drop strip taking several files at once, PDF and XML ("PDF, up to 50 MB" and "One file at a time" change);
- the stage ladder, fixed today at four steps, showing numbers (from XBRL or the PDF) and text (pages read, OCR) as separate tracks;
- many documents in progress at once;
- the figure panel for a figure with no page: its source is an XBRL element, "Open the PDF at page" has nowhere to go, and the `xbrl_in_pdf` check needs words.

## 13. Data model

One migration (the next free number when built; the data layer's phase 1 has 0006 planned), on the `pgvector/pgvector:pg16` image:

| Change | What |
| --- | --- |
| `create extension vector` | |
| `document.format` | `pdf`, `xbrl`. |
| `job.run_after` | Retry backoff (§9). |
| `intake_state` | Gains `waiting_for_xbrl`. |
| `financial_fact.span`, `financial_fact.period_start` | Pulled forward from the data layer's phase 4, with its names; null for PDF facts until that phase fills them. |
| `extraction_revision.source` | `pdf`, `xbrl`; existing rows `pdf`. |
| `xbrl_source` | Per XBRL fact: document, element, context id, `decimals`, footnote ids. |
| `check_type` | Gains `xbrl_in_pdf`. |
| `classification_evidence` | Gains nullable `element` and `context` for XBRL answers. |
| `document_index_revision` | One per index run: job (unique), state (`complete`, `partial`), versions (`index_version`, `chunker_version`, `ocr_engine`, `embedding_model`), page counts, warning codes. A document's current index is its newest revision per embedding model. |
| `document_page` | Revision, page number (from 1), `text_source` (`text_layer`, `ocr`, `none`), text, `none_reason`. |
| `document_chunk` | Revision, ordinal, page number or element, char offsets, section path, kind (`prose`, `table`), `text_source` (`text_layer`, `ocr`, `xbrl`), text, token count, generated `tsvector` with a GIN index. |
| `chunk_embedding` | Chunk, model, `vector(1024)`; primary key (chunk, model); HNSW with cosine ops. |
| `page_ocr` | OCR cache per workspace, content hash, page, engine and version, so a retry or rebuild never runs OCR on a page twice. |

Every table carries `workspace_id` and every query filters on it. A duplicate document gets no index or revision of its own; search and facts reach the original's.

## 14. Rules this changes, and rules it keeps

**Changes**, each to be written into the document named:

- ADR 0006, "two independent readers": for a filing with XBRL, the reader is XBRL alone; the two PDF readers apply to filings without XBRL. Recorded in ADR 0007.
- Data-layer spec §14, out of scope: XBRL ingestion and OCR (for search only) are now in scope, here.
- `DESIGN.md` §5: the drop strip, the stage ladder and the figure panel, through the design round (§12).

**Keeps** (`CLAUDE.md`, "Financial figures"):

- A figure is a fact read from a filing (an XBRL instance is a filing) or a named calculation; nothing else.
- Unknown stays unknown: nil, an unmapped element or a missing line is "—" with its reason, never zero.
- Basis, currency, unit, span and period on every figure; consolidated and standalone never mix.
- A change to a mapping rule (`xbrl_element_map`), a check or a reader ships with an evaluation run and a report; no regression on held-out.
- No document text in logs.

## 15. Errors and states

| Code | Where | Meaning |
| --- | --- | --- |
| `UNSUPPORTED_TYPE` | verify | Neither a PDF nor an XBRL instance. |
| `XBRL_UNREADABLE` | `document.xbrl` | Malformed or over the limits. Not retried. |
| `XBRL_TAXONOMY_UNKNOWN` | `document.xbrl` | An entry point that is not vendored. Not retried until a taxonomy is added. |
| `XBRL_MIXED_BASIS` | classify | One instance with both bases or none; held for the investor. |
| `XBRL_NIL` | fact | A nil value; unknown. |
| `INDEXER_NOT_CONFIGURED` | `document.index`, search | No indexer URL. The backfill recovers documents once configured. |
| `UNREADABLE_PDF` | `document.index` | As the extractor reports it. |
| `OCR_FAILED`, `OCR_BUDGET` | page `none_reason`, revision warnings | A scanned page has no text; the revision is `partial`. `OCR_BUDGET`: over `OCR_PAGE_BUDGET` (default 400) scanned pages. |
| `EMBEDDING_FAILED` | `document.index` | The indexer failed to embed after retries. |
| `SEARCH_UNAVAILABLE` | search route | The indexer is down or has no model; 503. |

## 16. Phases

Each phase is its own implementation plan from this document and lands on `staging`.

| Phase | Builds | Done when |
| --- | --- | --- |
| 1 · Runner | The pull-based job runner with per-type limits, `NOTIFY`, the notifier replacing the HTTP dispatcher; the pgvector image. | Twenty files dropped at once process with no more than the configured jobs per type running, and nothing is lost on a worker restart. |
| 2 · Index | The indexer service (Docling, local OCR, chunker, `/v1/embed`); the index tables; `document.index`; the backfill; the search function and route. | Every stored document in the investor's workspace has a current index; a search returns pages. |
| 3 · Measure the index | The OCR spot check, the retrieval set and report; `EMBEDDING_MODEL` and the OCR engine chosen. | Both reports committed under `docs/eval/`. |
| 4 · XBRL | Accepting XML and the folder import; `/v1/xbrl` with vendored taxonomies; XBRL classification; `document.xbrl`; facts, `span`, `xbrl_source`; the taxonomy checks and `xbrl_in_pdf`; the source rule and the reads that join sources; `waiting_for_xbrl`; skipping Gemini; the figure panel's XBRL source. | The investor's 806 instances import; a corpus company's results PDF dropped with its instance is not read by Gemini. |
| 5 · Measure the numbers | The source and format strata in `maester-eval`; `compare --xbrl`; the element map scored. Needs phase 0's gold set. | A report with exact match by source and format tag, and Gemini-against-XBRL agreement on every corpus filing that has both. |
| 6 · Screen | The build of the Documents screen (several files, two tracks, waiting for XBRL) from the chosen direction. | It is built and `DESIGN.md` §5 is amended. |

The `design-directions` round for the Documents screen and the figure panel runs while phases 1 to 3 are built, so phase 4 ships the panel's XBRL source from a chosen direction and no figure without a page appears before its design exists. Phases 1 to 3 do not wait for the data layer's phase 0, because the index changes no figure. Phase 4 uses `concepts.json`, already on `staging`. Phase 5 needs phase 0's gold set and the `feat/eval-corpus` manifest.

## 17. Testing

- **Python, offline.** The XML sniffing; Arelle on small synthetic instances for each vendored taxonomy (period, basis, nil, decimals, a dimensional fact skipped, an unknown entry point, an entity expansion refused); the presentation-to-statement mapping; the calculation checks; `xbrl_in_pdf` on synthetic text-layer PDFs. Docling on fixture PDFs with and without a text layer; the page split of chunks; table splitting with the header repeated; running headers dropped; `/v1/embed` with a tiny model; the wire fixtures in both runtimes.
- **TypeScript.** The claim query under concurrent loops (two loops never take one job; an expired lease is retaken; the per-type limit holds); `NOTIFY` wake-up; the source rule (XBRL wins a slot, no mixing, later XBRL takes over, partial basis coverage); skipping Gemini; the `pipeline` object; `document.index` writes in one transaction, the OCR cache across attempts; `searchChunks` on seeded rows; workspace isolation on every new route.
- **Live, manual, never in CI.** The reports in §10.

## 18. Left to the builder

The scan rule; Docling's settings; HNSW parameters; tokenizer details; the exact XBRL size and fact limits; how the taxonomy packages are laid out in the image (their sources and versions recorded in the extractor's README); the backfill as a script or a dev route; the poll interval within reason.

## 19. Risks

- **The taxonomy files.** MCA's site refused automated requests during research; the investor may need to download the taxonomy packages by hand once. Phase 4 starts by confirming each package and its licence.
- **CPU time.** Docling and OCR on a laptop CPU in Docker take minutes for a long filing (an estimate, measured in phase 3). The limits keep the machine usable; they do not make it fast.
- **XBRL availability.** BSE may keep results XBRL attachments only for a limited time (not confirmed). Older results may have only a PDF, and Gemini reads those.
- **XBRL quality.** Filers may club values or use "Others" elements; MCA does not check tagging. The taxonomy checks, `xbrl_in_pdf` and the evaluation make this visible; nothing corrects it automatically.
