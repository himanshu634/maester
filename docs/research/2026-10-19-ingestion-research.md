# Ingestion pipeline: research

19 October 2026. Five research tracks behind the [ingestion pipeline design](../superpowers/specs/2026-10-19-ingestion-pipeline-design.md): the database, PDF reading and OCR, embeddings, XBRL, and the job queue. Every figure below comes from the source cited; "unconfirmed" marks what could not be checked against a primary source; nothing was benchmarked on the investor's machine.

The machine everything must run on: an Apple M5 (4 performance and 6 efficiency cores, 16 GB), Docker 29.4.3, whose Linux VM has **10 vCPU, 7.75 GiB of memory, `aarch64`**. Docker on macOS passes no GPU or Metal through.

## 1. Database

**Stay on one Postgres.** At 1–16 million facts (about 0.5–6 GB with indexes) and about 2.5 million daily closes over 20 years, no table approaches the size where the Postgres documentation advises partitioning (bigger than the server's memory). Composite B-tree indexes serve the three query patterns: one concept across periods for a company, one period across companies, and the four quarters a TTM figure needs (the sum itself is an engine function, not SQL).

- **Time-series databases are not needed.** TimescaleDB pays off on continuous high-rate ingest. Its Apache-licensed core is hypertables; compression, continuous aggregates and retention are under the Timescale License, free when self-hosted. It is the step to take if intraday prices ever arrive, and it can live in the same database as pgvector (the `timescaledb-ha` image ships pgvectorscale; pgvector there is unconfirmed).
- **Analytics engines are not needed.** DuckDB or ClickHouse (or `pg_duckdb` inside Postgres) when cross-company scans pass about 100 million rows or indexed queries stay over a second after tuning. Neither happens at 16 million rows.
- **pgvector at 0.5–5 million 1024-dimension chunks** is in the comfortable band. Measured on 1 million 1536-dimension vectors (PG 16.2, pgvector 0.7, 64 vCPU): an HNSW index on `halfvec` was half the size of `vector` (3.9 GB against 7.7 GB), built in 163 s against 377 s, with the same recall (96.8% at `ef_search` 40, 99.6% at 200). Scaled to 1024 dimensions, `halfvec` is about 2.6 KB a vector: 1.3 GB at 0.5 million, 13 GB at 5 million. Binary quantization only with re-ranking.
- **Index builds in Docker** need `shm_size` at least `maintenance_work_mem`, or parallel builds fail; a build slows sharply once the graph outgrows `maintenance_work_mem`.
- **Filtering.** HNSW filters after the scan. A workspace filter loses little (one or a few workspaces). Company or document filters are selective enough for an exact scan through a B-tree. pgvector 0.8 iterative scans (`hnsw.iterative_scan = relaxed_order`) cover the middle.
- **Hybrid search.** A full-text branch and a vector branch, each ranked, fused by reciprocal rank (k = 60), never by adding raw scores. Built-in `ts_rank` has no corpus IDF but is fine as a recall branch. Use the `simple` text configuration: English stemming mangles company names, CINs and Ind AS terms. ParadeDB's BM25 (`pg_search`, AGPL) only if the retrieval test shows keyword misses. Lexical search matters here: on NanoRTEB, BM25 beats dense retrieval on FinQA (0.733 against 0.605), while dense wins on FinanceBench (0.769 against 0.427).
- **As reported and restated.** Facts append-only per filing; the current figure picks the newest filing per company, statement, basis and period and takes the whole column from it (SEC's frames API is the per-fact precedent; Maester's column rule needs per-filing); point-in-time is the same view with `filed_at <= as_of`; reviews and overrides in an append-only event log. Postgres 18's `WITHOUT OVERLAPS` keys are not needed: filing periods are discrete keys.

Sources: postgresql.org/docs/16/ddl-partitioning.html; github.com/pgvector/pgvector; jkatz05.com/post/postgres/pgvector-scalar-binary-quantization; supabase.com/blog/pgvector-0-7-0; crunchydata.com/blog/hybrid-vector-search; paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual; tigerdata.com/docs/about/latest/timescaledb-editions; github.com/timescale/pgvectorscale; sec.gov/search-filings/edgar-application-programming-interfaces; aiven.io/blog/two-dimensional-time-with-bitemporal-data. Vendor benchmarks (Timescale against Qdrant and Pinecone, MotherDuck on pg_duckdb) were read but not relied on.

## 2. Reading PDFs and OCR

**Docling (MIT; layout model Apache-2.0, TableFormer CDLA-Permissive-2.0 / Apache-2.0), version pinned, with RapidOCR on onnxruntime set explicitly.** It is the only full reader confirmed to run natively on arm64 CPU (`docling-serve-cpu`, 4.4 GB, amd64 and arm64), every element carries its page (1-based), box and character span, and it keeps text-layer characters exactly as printed.

- **OCR is per region, not per page.** Docling's default mode OCRs a layout region only when it overlaps a bitmap, has no programmatic text, or has filled shapes the text layer does not explain. It prefers visible text, then OCR, then an invisible text layer (what a scanner's own OCR usually is), so a scanned page is OCR'd afresh. A page can therefore mix text-layer and OCR text.
- **The engine must be pinned.** Docling picks an OCR engine automatically (ocrmac, never present in Docker; then RapidOCR; then EasyOCR). Automatic choice would break reproducibility and the OCR cache key.
- **Speed** (Docling's report, early 2025, 8 threads): on x86 EPYC a median 0.79 s and a mean 3.1 s a page with OCR on; each OCR'd page about 13 s more; OCR off saves about 60%. M3 Max, native macOS: a mean 1.27 s a page. Estimate for a 300-page annual report: 4 to 15 minutes, plus 13 s per scanned page. Docling's suggested `document_timeout` of 90–120 s is far too short for this; it must be set to the document or the work done in page ranges.
- **Memory** is not published. One report of an out-of-memory crash on a table-heavy PDF. The levers are `page_batch_size`, OCR only where needed, and page ranges. Measure on a 300-page report.
- **Tables.** TableFormer (accurate mode) scores TEDS 93.6 on its own card, 84.5 on an independent invoice benchmark; Docling is not on OmniDocBench. Its `do_cell_matching` can break tables whose cells merge across columns, which tightly packed right-aligned numbers do: test both settings. pdfplumber (MIT) word positions are the cross-check for digital tables.
- **Rejected for this machine:** native PaddleOCR (no linux-aarch64 wheel for paddlepaddle 3.3.1), olmOCR (needs a 12 GB GPU), every vision-language-model backend (GPU or far too slow on CPU), PyMuPDF (AGPL), Marker and Surya (weights under a modified OpenRAIL-M; Surya's layout tagged CC-BY-NC-SA), MinerU's VLM (AGPL weights; its CPU tier unverified on arm64), EasyOCR (last release September 2024).
- **No tool parses Indian numbers.** Every tool passes `1,23,456.78` and `(4,567)` through as strings. Nothing published measures OCR on scanned Indian financial tables.

**Chunking.** Element-based chunks beat fixed-size ones on financial filings: on FinanceBench (80 documents, 141 questions), 53.19% against 48.23% answered, with half the chunks. Rules: every title starts a chunk, every table starts a chunk and stays whole, small elements merge up to about 2,048 characters. Docling's HybridChunker does this (it merges neighbours under one heading and splits a large table by rows with the header repeated), and `contextualize()` puts the heading path before the text for embedding. Carry basis, period and unit with each chunk, and never mix the consolidated and standalone sections in one chunk.

Sources: arxiv.org/html/2501.17887 (Docling report); github.com/docling-project/docling (`pipeline_options.py`, `base_ocr_model.py`, `auto_ocr_model.py` read); docling-project.github.io/docling/concepts/chunking; github.com/docling-project/docling-serve; huggingface.co/ds4sd/docling-models; github.com/opendatalab/OmniDocBench; github.com/applied-artificial-intelligence/pdf-parser-benchmark; arxiv.org/html/2402.05131v3 (financial report chunking); github.com/RapidAI/RapidOCR; pypi.org/project/paddlepaddle; github.com/datalab-to/marker; github.com/opendatalab/MinerU.

## 3. Embeddings

**Default: `Snowflake/snowflake-arctic-embed-l-v2.0`** (Apache-2.0, 568M parameters, 1024 dimensions, 8,192-token context, no remote code, a `query: ` prefix on queries only). Among the open candidates it has the best measured finance retrieval: FinanceBench nDCG@10 75.6, FinQA 56.6, RTEB finance 61.4 (MTEB results repository).

| Model | Licence | Dimensions | Context | Finance retrieval (FiQA / FinanceBench / FinQA / RTEB-finance) | Note |
| --- | --- | --- | --- | --- | --- |
| snowflake-arctic-embed-l-v2.0 | Apache-2.0 | 1024 | 8k | 45.3 / 75.6 / 56.6 / 61.4 | Default |
| Qwen3-Embedding-0.6B | Apache-2.0 | 1024 | 32k | 46.6 / – / – / 60.6 | Test candidate; takes a finance instruction; about 1.5× arctic's compute |
| voyage-4-nano | Apache-2.0 | 2048 (1024 by Matryoshka) | 32k | no public scores | Test candidate; cheapest; needs remote code; 2048 exceeds pgvector's HNSW limit for `vector`, so 1024 |
| bge-m3 | MIT | 1024 | 8k | – / 66.5 / 55.7 / 59.8 | |
| granite-embedding-english-r2 | Apache-2.0 | 768 | 8k | 46.3 / 70.7 / 48.9 / 58.4 | The fast option if CPU time decides |

Ruled out: mxbai-embed-large and nomic-embed-text-v2 (512-token context truncates table chunks), jina-embeddings-v3 (CC BY-NC), EmbeddingGemma-300m (custom gated licence, 2k context). Unchecked newcomer: microsoft/harrier-oss-v1-0.6b (MIT), RTEB finance 63.2.

- **Serving:** Hugging Face text-embeddings-inference, `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9`, as its own container with an HTTP `/embed`. It supports arctic (XLM-R), Qwen3 and granite; voyage-4-nano's remote-code head must be checked against sentence-transformers first. Ollama inside Docker on macOS is CPU only and adds no query or document prefixes.
- **CPU time (estimate, not measured):** a 300-page annual report is about 1,500 chunks of 500 tokens. arctic: about 28 to 80 minutes; Qwen3-0.6B: 40 minutes to 2 hours; voyage-4-nano: 16 to 50 minutes; granite-r2: 10 to 30 minutes. A backfill of about 100 annual reports and 400 results filings is therefore days of CPU. Measure on a sample before a backfill.
- **Rerankers** run on every query and are expensive on CPU (bge-reranker-v2-m3: an estimated 24–70 s a query over the top 20). Add one only if the retrieval test shows ranking, not recall, is the weakness, then a small one (gte-reranker-modernbert-base) over the top 8–10.

Sources: the model cards on huggingface.co (Snowflake/snowflake-arctic-embed-l-v2.0, Qwen/Qwen3-Embedding-0.6B, voyageai/voyage-4-nano, BAAI/bge-m3, ibm-granite/granite-embedding-english-r2, google/embeddinggemma-300m, mixedbread-ai/mxbai-embed-large-v1, nomic-ai/nomic-embed-text-v2-moe, jinaai/jina-embeddings-v3, microsoft/harrier-oss-v1-0.6b); github.com/embeddings-benchmark/results; huggingface.co/blog/rteb; hakari-bench-leaderboard.hf.space (NanoRTEB); github.com/huggingface/text-embeddings-inference; sbert.net/docs/sentence_transformer/usage/efficiency.html; ollama.readthedocs.io/en/faq.

## 4. XBRL

All 807 instances in the investor's `maester-filings/xbrl/` were read (stdlib XML, 2.5 s for all, 47 ms the slowest); nothing was downloaded.

- **Formats and entry points.** The `schemaRef` is a bare file name and does not identify the format: one name covers several taxonomies with one namespace.

| `schemaRef` | Files | Formats inside |
| --- | --- | --- |
| `in-capmkt-ent-2025-01-31.xsd` | 412 | Ind AS 370, banking 32, NBFC 8, other than Ind AS 2 |
| `in-capmkt-ent-2026-01-31.xsd` | 201 | Ind AS 180, banking 17, NBFC 4 |
| `Ind-AS_entry_point_2020-03-31.xsd` | 174 | BSE "Main" Ind AS (`in-bse-fin`) |
| `banking_entry_point_2019-09-30.xsd` | 16 | Banking |
| `in-bse-fin-2020-03-31.xsd` | 4 | NBFC |

  The format is told from the elements (`InterestEarned`, `CapitalAndLiabilities` mean banking) or the BSE file name's format token.
- **What an instance holds.** Everything for values: facts, contexts, units, `decimals`, entity, dates, basis and rounding. Lost without the taxonomy: standard labels, presentation order and statement grouping, calculation relationships, datatypes. Dimensional lines carry their own printed label (`DescriptionOfOtherExpenses` in the same context).
- **Periods.** Context ids are the filing tool's names; spans must come from the dates. `OneD` is the quarter (the half year in BSE "Main" half-year files), `FourD` the year to date (6, 9 or 12 months, absent in Q1), `OneI` the closing balance sheet, `PY_I` the prior year end (opening cash only). **The comparative columns printed in the PDF are not in the instance.** The balance sheet and cash flow appear only in half-year and Q4 or annual files.
- **Identity** comes from the `ScripCode`, `Symbol` and `ISIN` facts; the entity scheme has five variants, one malformed.
- **Basis** is `NatureOfReportStandaloneConsolidated`; no file mixes bases. Audit status `WhetherResultsAreAuditedOrUnaudited`; period type `ReportingQuarter` and, in `in-capmkt`, `TypeOfReportingPeriod`.
- **Rounding.** `LevelOfRounding` in all 613 `in-capmkt` files, `LevelOfRoundingUsedInFinancialStatements` in the 194 `in-bse-fin` files; only Crores (441), Millions (205) and Lakhs (161). Values are full rupees. In 807 of 807 files the coarsest `decimals` equals the declared rounding (−7, −6, −5), a free consistency check. On individual facts `decimals` follows trailing zeros about 94% of the time, so it is not the unit.
- **Never seen in the corpus:** DOCTYPE or ENTITY declarations, `xsi:nil`, tuples, `precision`, duplicate facts, footnotes, a currency other than INR.
- **Size.** Median 267 facts; 95th percentile 4,331; the largest (Bharti Airtel's annual standalone) 26,198 facts in 6,472 contexts, 7.9 MB, mostly related-party dimensions.
- **Key elements** (Ind AS and NBFC; banking in brackets): `RevenueFromOperations` (`InterestEarned`), `ProfitBeforeTax` (`ProfitLossFromOrdinaryActivitiesBeforeTax`), `ProfitLossForPeriod` (`ProfitLossForThePeriod`), `BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations` (`BasicEarningsPerShareAfterExtraordinaryItems`), `Assets`, `EquityAndLiabilities` (`CapitalAndLiabilities`), `CashFlowsFromUsedInOperatingActivities` and its investing and financing siblings.
- **Taxonomy packages.** BSE's XBRL page returned 403 and NSE's timed out, so the official package URLs and their licence are unconfirmed. A third-party copy of SEBI's 2025-01-31 Ind AS package is a standard taxonomy package (`META-INF/taxonomyPackage.xml`, a catalog rewriting `http://www.sebi.gov.in/xbrl/2025-01-31/`), importing xbrl.org base schemas by absolute URL.
- **Arelle** (`arelle-release` 2.46.1, Apache-2.0) works offline with packages, but is not thread-safe (one session per process), would need the format detected first to pick among same-named packages, lifts libxml2's size limits and recovers malformed XML. py-xbrl is GPLv3; python-xbrl last released 2016.

**Decision taken from this:** our own parser over the instance (DOCTYPE refused, caps on bytes, facts and time), with a reviewed element map per format giving statement, order, label and the sums to check. Arelle or generated maps from the vendored linkbases later, once the packages and their terms are confirmed, compared in `apps/eval`.

Sources: arelle.readthedocs.io (command line, Python API, plugin hooks); github.com/Arelle/Arelle (`ModelObjectFactory.py`); pypi.org (arelle-release, py-xbrl, python-xbrl, defusedxml); github.com/dhananjaym182/india-xbrl-filings (third-party package copy); in.xbrl.org/about-us/xbrl-taxonomies; NSE circular NSE/CML/2018/13; BSE circular of 2 April 2025 (Integrated Filing). Unreachable: bseindia.com/static/about/xbrl_info.aspx, nseindia.com/static/companies-listing/xbrl-information.

## 5. Job queue

**A runner of our own over the existing `job` table.** The table already has idempotency keys, leases, fencing by lease token, progress and database-clock deadlines; every library would add a second job record to keep in step with the one the screen reads.

What is missing today: retries never run locally (`LocalHttpDispatcher` is fire-and-forget), nothing recovers a job whose worker died, there is no backoff, no concurrency limit, and `EXTRACTOR_TIMEOUT_SECONDS` (900) aborts any read over 15 minutes. Cloud Tasks caps a push at 30 minutes.

The pieces: a `run_after` column with exponential backoff and jitter; a single-statement claim per type (`FOR UPDATE SKIP LOCKED`) with an in-process limit per type; `NOTIFY` once per enqueue, heard on a dedicated connection with a poll as a safety net; an expired-lease sweeper; a timer heartbeat independent of stream events; a longer extractor timeout.

Pitfalls: PgBouncer in transaction mode cannot `LISTEN`; `NOTIFY` takes a commit lock (send it once per enqueue, never per progress write); never hold a transaction open across a long job; keep progress writes throttled; a partial index on claimable rows and a lower fill factor keep the hot table lean.

Runner-up: pg-boss (MIT, 12.38.0), if the runner outgrows a few hundred lines. Rejected: graphile-worker (no heartbeat in the open edition; a crashed worker's jobs stay locked at least 4 hours), BullMQ (needs Redis), Temporal, Hatchet and Inngest (another stateful service to run).

Sources: github.com/timgit/pg-boss; pgboss.io/api; worker.graphile.org/docs; docs.bullmq.io; docs.temporal.io; docs.hatchet.run; github.com/inngest/inngest; pgbouncer.org/features.html; recall.ai/blog/postgres-listen-notify-does-not-scale; brandur.org/postgres-queues; Cloud Tasks REST reference.

## 6. Memory on this machine

The Docker VM has 7.75 GiB for everything: Postgres (an HNSW build wants `maintenance_work_mem` of 1–2 GB at this project's sizes), the embedder (arctic about 2.3 GB in fp32), Docling at peak (unpublished; measure), the extractor, the API, the worker and the web. That is tight. Docker Desktop's memory limit is a setting the investor can raise (the Mac has 16 GB); the design runs one index job at a time so the peak stays within the default.
