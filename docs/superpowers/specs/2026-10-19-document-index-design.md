# Document index: design

Status: draft for review, 19 October 2026. The decision it rests on is [ADR 0007](../../decisions/0007-document-index.md). It amends the out-of-scope list of the [financial data layer](2026-10-15-financial-data-layer-design.md) (§14) for OCR, and only for search.

## 1. Goal

Every filing that comes into Maester becomes searchable text, passage by passage, with the page each passage came from. Whether the investor uploads a PDF or Maester adds one, Maester:

1. reads each page's text, from the text layer where there is one and by OCR where the page is a scan;
2. splits the text into chunks that follow the filing's own sections and keep their page;
3. embeds each chunk and stores it in Postgres with pgvector, next to the document it came from.

This is the first of three projects, in the order the investor set:

| # | Project | What it gives |
| --- | --- | --- |
| 1 | **Document index** (this document) | Page text, OCR, chunks and vectors for every stored filing. |
| 2 | Claude as a reader | Claude beside Gemini for classification and statement extraction, the default chosen by an evaluation run (§12). |
| 3 | XBRL | MCA and exchange XBRL instances as a third reader that checks the PDF (§13). |

Search and chat over the index are the next consumer. This project gives them a tested search function and one API route, and no screen.

## 2. Goals, non-goals and anti-goals

**Goals**

- Every stored, non-duplicate document has a current index: its pages, its chunks and one embedding per chunk.
- A search result names the document, the page (counted from 1) and whether the text came from the text layer or OCR.
- The index can be rebuilt for a new chunker or embedding model without a schema change.
- Indexing never holds up or changes classification, extraction or any figure.

**Non-goals**

- A search or chat screen, an Analyst page, or MCP tools over the index (the next project).
- Claude as a statement reader or classifier (project 2).
- XBRL ingestion (project 3).
- OCR text as input to any figure, check or classification.

**Anti-goals** (a failure even if everything else works)

- A number read from a chunk shown to the investor, or handed to an agent, as a figure. A figure is a fact or a calculation (`CLAUDE.md`, "Financial figures"). A chunk may point to a fact; it never stands in for one.
- OCR text treated as the text layer. A model's transcription must never confirm a model's reading.
- Filing text in logs, traces or error messages.
- A chunk or vector visible outside its workspace.

## 3. Today

- Upload: `document.verify` hashes and stores the PDF, marks a second copy as `duplicate`, and chains `document.classify`, which leads to `document.extract` for annual reports and financial results ([`document-verify.ts`](../../../apps/worker/src/jobs/document-verify.ts), [`intake.ts`](../../../packages/jobs/src/intake.ts)).
- The extractor ([`apps/extractor`](../../../apps/extractor)) is a stateless Python service. The worker streams it the PDF; it never touches the database or the blobs.
- [`PdfDocument`](../../../packages/financial-engine/src/pdf_financial_qa/workflow/pdf.py) reads each page's text layer with pypdf and treats a page with no text as a scan. Nothing reads a scan's text.
- Postgres is the stock `postgres:16` image in `docker-compose.yml`, with no extensions. There is no vector store and no embedding model.
- The data-layer spec plans `pdfplumber` positioned words for reader B (its phase 3). This project does not depend on that.

## 4. Decisions

| Axis | Decision | Why | Rejected |
| --- | --- | --- | --- |
| Vector store | **pgvector in the existing Postgres.** | One database, one backup, workspace scoping in the same transaction as the document. A personal corpus is thousands of filings at most. | A second database instance now (§11 says when); a hosted vector service (another vendor holding filing text). |
| Embeddings | **Voyage** (the investor's choice), through its official TypeScript SDK (`voyageai` on npm). The model is chosen between `voyage-finance-2` and `voyage-4-large` by the retrieval test in §10. Both give 1024 dimensions. | Anthropic offers no embedding model and recommends Voyage. `voyage-finance-2` is tuned for financial text but is older than the 4 series; the test decides. | Gemini embeddings on Vertex. |
| OCR | **Claude reads a scanned page**, given as a one-page PDF, and returns its text as printed. Stored with its source, model and prompt version. Used for search only. | The investor has an Anthropic Console account and wants Claude in the pipeline. Claude reads page images well, including tables. | Tesseract (weak on tables and Indian number layouts); Gemini (keeps one vendor reading every page). |
| Where work runs | **The extractor reads pages, runs OCR and chunks** (Python, where the PDF code is). **The worker embeds and writes** (TypeScript, the runtime the API searches from, so documents and queries go through one Voyage client). | Keeps the extractor stateless and gives one embedding client for both sides. | Embedding in the extractor (a second Voyage client in a second runtime, and query embedding would still need TypeScript). |
| Search | **Hybrid**: vector similarity plus Postgres full-text, merged by reciprocal rank. | Filing questions name exact things ("Note 25", "CSR", a subsidiary's name) that keyword search finds and vectors blur. | Vectors alone. |

## 5. Data model

One migration (the next free number when it is built; the data layer's phase 1 has planned 0006) enables the extension and adds five tables. Every table carries `workspace_id`, and every query filters on it.

```sql
create extension if not exists vector;
```

### 5.1 `document_index_revision`

One row per index run, immutable once complete, in the same pattern as `extraction_revision`.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | uuid | |
| `workspace_id`, `document_id` | uuid | |
| `job_id` | uuid | The `document.index` job that built it. Unique, so a retried job never writes twice. |
| `state` | enum `complete`, `partial` | `partial`: some pages have no text (§7.4). |
| `index_version` | text | `index-1`; bumped when what a chunk means changes (§9). |
| `chunker_version` | text | |
| `ocr_model`, `ocr_prompt_version` | text, null | The configured `OCR_MODEL` and the prompt hash. Null when no page needed OCR. Pages say which model actually answered (§5.2). |
| `embedding_model` | text | e.g. `voyage-finance-2`. |
| `page_count`, `text_layer_pages`, `ocr_pages`, `empty_pages` | integer | |
| `warnings` | jsonb | Codes only, never text. |
| `created_at` | timestamptz | |

A document has one current index per embedding model: its newest `complete` or `partial` revision for that model. So two models' indexes stand side by side (§10), and search reads only the revisions of the model it embeds the query with (§6.5).

### 5.2 `document_page`

| Column | Type | Meaning |
| --- | --- | --- |
| `revision_id` | uuid | |
| `workspace_id`, `document_id` | uuid | |
| `page_number` | integer | Counted from 1, as the slip and figure panel count. |
| `text_source` | enum `text_layer`, `ocr`, `none` | `none`: a scan with no OCR text. |
| `text` | text | As read. Empty for `none`. |
| `none_reason` | text, null | `OCR_FAILED`, `OCR_REFUSED`, `OCR_BUDGET`, `OCR_NOT_CONFIGURED`. |
| `ocr_served_model` | text, null | For an OCR page, the model that answered: the configured one, or the fallback after a refusal (§7.5). |

Primary key `(revision_id, page_number)`.

### 5.3 `document_chunk`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | uuid | |
| `revision_id`, `workspace_id`, `document_id` | uuid | |
| `ordinal` | integer | Order in the document. |
| `page_number` | integer | A chunk never crosses a page (§6.3). |
| `char_start`, `char_end` | integer | Offsets into that page's `text`. |
| `section_path` | text[] | Headings above the chunk, outermost first, e.g. `{"Notes to the standalone financial statements","25 Borrowings"}`. Empty when none was found. |
| `kind` | enum `prose`, `table` | |
| `text_source` | enum, as `document_page` | Copied from the page, so search can say "OCR". |
| `text` | text | |
| `token_count` | integer | As Voyage counts it. |
| `tsv` | tsvector, generated | `to_tsvector('english', text)`, GIN-indexed. |

### 5.4 `chunk_embedding`

| Column | Type | Meaning |
| --- | --- | --- |
| `chunk_id` | uuid | |
| `workspace_id` | uuid | |
| `model` | text | |
| `embedding` | `vector(1024)` | |

Primary key `(chunk_id, model)`. An HNSW index with `vector_cosine_ops`. Keying by model lets two models' vectors sit side by side for the test in §10 and during a switch. A future model with another dimension gets its own column and index in a new migration; neither candidate needs one.

### 5.5 `page_ocr`

A cache of OCR results, so a page is paid for once per model and prompt version, across attempts and rebuilds.

| Column | Type | Meaning |
| --- | --- | --- |
| `workspace_id` | uuid | Scoped like everything else; never shared across workspaces. |
| `content_sha256` | text | The document's stored hash. |
| `page_number` | integer | |
| `ocr_model`, `ocr_prompt_version` | text | The configured model, so a page answered by the fallback is still found on retry. |
| `ocr_served_model` | text | The model that answered. |
| `text` | text | |
| `created_at` | timestamptz | |

Primary key `(workspace_id, content_sha256, page_number, ocr_model, ocr_prompt_version)`. The worker writes each OCR page as it arrives on the stream, outside the revision's transaction: this is a cache, not the index, and a reader never sees it.

### 5.6 Duplicates and deletion

A document marked `duplicate` gets no index of its own; search reaches the original's. Deleting a document (not built yet) must delete its revisions, pages, chunks and embeddings; the foreign keys cascade.

## 6. Pipeline

```text
document.verify ──► document.classify ──► … (unchanged)
        └─────────► document.index:  extractor /v1/index  →  pages + chunks (NDJSON)
                                     worker: Voyage embed  →  one transaction
```

### 6.1 The job

`document.verify` enqueues `document.index` beside `document.classify` for every stored document that is not a duplicate, of every kind, including `other`. The two jobs are independent: a failed index never changes `intake_state`, and a failed classification never stops the index.

- **Invisible to the Documents page.** The job's `subjectType` is `document_index` (its `subjectId` the document's id), so the API's `latestJob` for a document, which the slip reads, never returns an index job. Nothing on any screen changes.
- **Keys.** Automatic runs are keyed `pipelineVersion = index-1/<chunker>/<embedding model>/<ocr model>`, so a retry never enqueues twice and a version bump enqueues a fresh one. A deliberate re-run (the backfill in §9, or a dev route) uses `manual-<uuid>`, as the extract route already does.
- **Time.** An index run has its own extractor deadline (`INDEX_DEADLINE_SECONDS`, default 1800) and worker timeout, separate from extraction's, and heartbeats its lease while pages stream. A long scanned filing may still not finish in one attempt; because OCR pages are cached as they arrive (§5.5), the next attempt resumes where the last stopped instead of paying again.

### 6.2 `/v1/index` on the extractor

The worker streams the PDF, as it does to `/v1/extract`, behind the same `EXTRACTOR_SECRET`, together with the cached OCR text for this document's pages under the current OCR model and prompt version. The extractor uses a cached page's text instead of calling Claude, and stays stateless. The extractor answers NDJSON: `started` (versions), `page` (number, source, text, reason), `chunk` (page, offsets, section path, kind, text), `progress`, then `result` or `error`. Wire types live in `packages/contracts` with golden fixtures in both runtimes, as the extraction wire does.

For each page:

1. **Text layer.** pypdf's text, as `PdfDocument` reads it today. A page is a scan when the text layer is empty or, by a rule the builder writes and tests, unusable (for example nearly all replacement characters from a font with no Unicode map). The "unusable" rule lives in the index code only. `PdfDocument` and everything that reads it (extraction, the correction guard, the classifier's quote check) stay as they are; moving the rule there would change the text-layer reader and need its own evaluation run. So a page can count as text layer on the slip and as OCR in search, and that is accepted.
2. **OCR** for a scan. The page alone, as a one-page PDF (`PdfDocument.subset`), goes to Claude with a prompt that asks for the text exactly as printed: reading order, headings on their own lines, tables as Markdown tables, numbers and signs untouched, nothing added, summarised or corrected. The answer is plain text, kept as returned.

### 6.3 Chunking

Deterministic and versioned (`chunker_version`), in `packages/financial-engine/src/pdf_financial_qa/index/`.

- **Within a page.** A chunk never crosses a page boundary, so every citation is one page. A paragraph that runs over a page break is two chunks.
- **Sections.** Headings are found by rule (numbered notes such as "25. Borrowings", the statement titles, report headings such as "Management discussion and analysis"). The path carries forward across pages until the next heading at its level.
- **Size.** Target about 500 tokens, at most 1,000, with about 60 tokens of overlap between neighbouring prose chunks on the same page. A table is one chunk when it fits and splits by rows with its header row repeated when it does not.
- **Empty and boilerplate.** A page with no text has no chunks. Repeated running headers and footers (the same line on most pages) are dropped from chunks but kept in `document_page.text`.

### 6.4 Embedding and the write

The worker batches chunks to Voyage with `input_type: "document"`, inside Voyage's per-request limits, and retries a transient failure through the job's retry policy. When every chunk has its vector, it writes the revision, pages, chunks and embeddings in one transaction. Nothing is written for a run that fails part-way, so a reader never sees half an index.

### 6.5 Search

`searchChunks(db, { workspaceId, query, limit, documentIds?, companyId? })` in a shared package, used by one API route:

`GET /v1/workspaces/:workspaceId/search?q=…&limit=…&company=…` (session required, member of the workspace).

1. Embed the query with `input_type: "query"` on the embedding model named by `EMBEDDING_MODEL`, one setting read by both the worker and the API (the retrieval test passes a model explicitly instead). Only revisions for that model are searched.
2. Top 50 by cosine distance among that workspace's current chunks for that model; top 50 by `ts_rank` on `websearch_to_tsquery`.
3. Merge by reciprocal rank (k = 60) and return the first `limit` (default 10, at most 50): chunk id, document id and name, company, page number, section path, kind, text source, the chunk text and both ranks.

Results carry no figure. A consumer that wants a figure follows the document and page to the facts.

## 7. OCR rules

1. OCR text is stored with `text_source = ocr`, the model and the prompt version, and is shown as such wherever it appears.
2. It is never read by the extraction workflow, the `correct` step's text-layer guard, the classifier's quote check ("Page 3 (scanned)" stays as it is), reader B or any check. Those keep using the text layer, and a scan still has none.
3. Feeding OCR text to reader B or to the correction guard later is a change to reader B. It needs its own design and an evaluation run.
4. **Failures.** A refusal (`stop_reason: "refusal"`), a failed call after retries, or no `ANTHROPIC_API_KEY` on the extractor (`OCR_NOT_CONFIGURED`) leaves the page `none` with its reason, and the revision `partial` with the warning code. A filing with more scanned pages than the OCR page budget (a setting, default 400) OCRs the first that many and marks the rest `OCR_BUDGET`.
5. **Client.** The official `anthropic` Python SDK with `ANTHROPIC_API_KEY` from the Console account; not LangChain. The model is a setting (`OCR_MODEL`), default `claude-sonnet-5-5` (the investor's choice, on cost: an estimated $0.02 a scanned page against $0.04 on Opus 5.5). Effort is `low`; no `temperature` (a 400 on current models). Server-side refusal fallback is on: `client.beta.messages.create` with the beta `server-side-fallback-2026-07-01` and `fallbacks: "default"`, so a page Sonnet declines is read by the model the API routes it to, which may cost more. The page records that model (`response.model`) as `ocr_served_model`; the revision and the cache keep the configured model. A refusal that survives the fallback is checked before reading the text; pages run with bounded concurrency (a setting, default 4) inside the job's deadline.

## 8. Privacy and secrets

- Filing text goes to Anthropic (scanned pages) and to Voyage (every chunk). Both keys are server environment variables (`ANTHROPIC_API_KEY` on the extractor; `VOYAGE_API_KEY` on the worker and the API), like the Vertex credentials today, not per-workspace settings. The investor should turn off training on their data in the Voyage dashboard.
- No page text, chunk text or query text in logs, traces, job progress or errors. Log counts, codes and ids.

## 9. Versions and rebuilds

- `index_version`, `chunker_version`, `ocr_prompt_version` (a hash of the prompt, as `PROMPT_VERSION` is) and the two model names are on every revision.
- A bump in any of them makes stored documents stale. A command (`pnpm --filter @maester/worker index:backfill`, or a dev route like the existing ones) enqueues `document.index`, keyed `manual-<uuid>`, for every stored, non-duplicate document that has no current revision for `EMBEDDING_MODEL`, whose current revision is stale, or whose current revision is `partial` with a page that may succeed on a second try (`OCR_FAILED`, `OCR_NOT_CONFIGURED`; not `OCR_REFUSED`, and `OCR_BUDGET` only when the budget was raised). It also builds the first index for documents already stored when this ships, and recovers documents whose jobs failed for good, such as a deploy before `VOYAGE_API_KEY` was set.
- A rebuild that changes only the embedding model reuses the current revision's pages and chunks when they are unchanged, and adds embeddings; the builder may defer this optimisation.

## 10. Measurement

Indexing changes no figure, so the figures evaluation in `apps/eval` is not required for it. Choosing the embedding model and changing the chunker do need evidence:

- **Retrieval set.** 40 or more questions over the development set's filings, each with the page or pages that answer it (narrative questions such as "what does the company say about its order book", and locating questions such as "the borrowings note"). The builder drafts them from the filings; the investor reads and corrects them before they count. Only development-set filings are used, so the set waits for the data layer's phase 0 to seal its split; phases A to C do not wait. Stored under `data/eval/retrieval/`, git-ignored with the corpus. If the development set has fewer than ten scanned pages, the investor adds scanned filings to the corpus before the OCR rows of the report mean anything.
- **Report.** Recall at 5 and 10 and mean reciprocal rank, by text source (text layer, OCR), for vectors alone, keyword alone and hybrid. Committed under `docs/eval/` like the figures reports.
- **The choice.** Index the set with both `voyage-finance-2` and `voyage-4-large`; the better hybrid recall at 10 becomes the default, recorded in the report. A later chunker or model change shows no fall in recall at 10.
- **OCR spot check.** For ten scanned pages, the OCR text is compared with the page by hand, and the report says how many numbers and headings were wrong.

## 11. Infrastructure

- `docker-compose.yml` moves from `postgres:16` to `pgvector/pgvector:pg16` (same major version, so the volume stays). CI and the test database use the same image.
- Hosting is undecided. The chosen managed Postgres must offer pgvector; most do.
- **When to split the vector store out.** Not before one of these: chunk count over about 5 million, search p95 over 500 ms with the HNSW index warm, or index builds slowing the transactional workload. Then a second Postgres with pgvector, the same tables, written by the worker. The search function is the only reader, so the change stays behind it.

## 12. Project 2: Claude as a reader (roadmap)

Its own design after this one lands and the phase 0 evaluation baseline is committed. In outline: `ClaudeExtractionModel` and `ClaudeClassificationModel` behind the existing `ExtractionModel` and `ClassificationModel` protocols, on the official SDK with structured outputs (`messages.parse`; forced tool choice returns a 400 on current models). Sub-PDFs keep under Claude's 32 MB and 600-page request limit through `PdfDocument.subset`. A setting chooses the provider per step. `maester-eval live` runs both on the development set; Claude becomes the default for a step only with no regression on the held-out set. Claude reading the same pages as Gemini is a second model, not reader B: the data-layer spec's agreement states stay as they are unless that design says otherwise.

## 13. Project 3: XBRL (roadmap)

Its own design. What the research found (19 October 2026, from MCA's Ind AS filing manual, NSE and BSE circulars and the XBRL registries):

- Listed companies, companies with paid-up capital of ₹5 crore or more or turnover of ₹100 crore or more, and Ind AS companies file their accounts with MCA in XBRL (AOC-4 XBRL) for years from 1 April 2014; banks, insurers and NBFCs are exempt. Standalone and consolidated are separate instances, each with the current and previous year, labelled by `NatureOfReportStandaloneConsolidated` and keyed by CIN.
- Listed companies also file quarterly results in XBRL with BSE and NSE, since 2025 through SEBI's Integrated Filing.
- Values are in full rupees with no scale; `decimals` gives the printed precision; `xsi:nil` is distinct from zero. MCA allows no extension elements, so filers use "next best fit" and "Others" elements.
- MCA accepts that its XBRL may differ from the signed accounts, and in 2026 NSE queried companies over XBRL results that did not match the PDF.

So: the signed PDF stays the record and XBRL is a third reader that checks it. A difference is a finding, never an override. The investor uploads the `.xml` themselves (Maester fetches nothing from MCA, NSE or BSE); the drop strip and `document.verify` accept PDF only today. The instance is untrusted XML: Arelle (Apache-2.0) in offline mode with vendored, pinned taxonomies, and no network or external entities. Taxonomy elements map to `concepts.json` through recorded mapping rules, with an evaluation run. Narrative text blocks (notes, accounting policies) can feed this index as chunks with `text_source = xbrl`.

## 14. Errors and states

| Code | Where | Meaning |
| --- | --- | --- |
| `INDEXER_NOT_CONFIGURED` | `document.index` | No extractor URL or no Voyage key. Not retried; the backfill recovers it once configured. |
| `UNREADABLE_PDF` | `document.index` | As the extractor reports it today. Not retried. |
| `EMBEDDING_FAILED` | `document.index` | Voyage failed after retries. Retried by the job policy. |
| `OCR_FAILED`, `OCR_REFUSED`, `OCR_BUDGET`, `OCR_NOT_CONFIGURED` | `document_page.none_reason`, revision `warnings` | A scanned page has no text. The revision is `partial`. |
| `SEARCH_UNAVAILABLE` | search route | No current embedding model or Voyage failed; 503. |

## 15. Testing

- **Python, offline.** The scan rule on synthetic pages; cached OCR pages used instead of a call; the chunker on fixture page texts (sections, page boundaries, tables split with the header repeated, running headers dropped, offsets that slice back to the chunk text); OCR with a scripted client, including refusal, failure and budget; `/v1/index` end to end with a scripted model; the wire fixtures.
- **TypeScript.** Wire fixtures through Zod; the job's write with a fake Voyage client, including a failure mid-batch writing nothing; idempotency on retry; OCR pages cached as they stream and reused on the next attempt; the job's subject type kept out of `latestJob`; the backfill's selection; duplicates skipped; `searchChunks` on seeded rows (hybrid merge order, current revision only, the model filter); the route's workspace isolation; the migration on the pgvector image.
- **Live, manual.** The retrieval report (§10), never in CI.

## 16. Phases

| Phase | Builds | Done when |
| --- | --- | --- |
| A · Store | pgvector image; migration; schema in `packages/db`; wire contracts and fixtures. | The migration runs on the new image in CI. |
| B · Read and chunk | `/v1/index`; scan rule; Claude OCR; chunker. | Offline tests pass; a real annual report streams pages and chunks. |
| C · Embed and write | `document.index`; Voyage client; chained from verify; backfill command. | Every stored document in the investor's workspace has a current index. |
| D · Search and measure | `searchChunks`; the route; the retrieval set (after phase 0's split) and report; the embedding model chosen. | The report is committed under `docs/eval/` and names the default model. |

Each phase updates `DATA_MODEL.md`, `docs/systems/extractor.md`, `worker.md`, `api.md` and `packages.md`, and `.env.example` for the two keys.

## 17. Left to the builder

The exact scan rule; heading patterns beyond those named; tokenisation for chunk sizing (Voyage's tokenizer or a close approximation, recorded); Voyage batch sizes; HNSW parameters; the OCR prompt wording within §6.2; whether the backfill is a script or a dev route; whether an embedding-only rebuild reuses chunks (§9).
