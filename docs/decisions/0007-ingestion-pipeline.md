# ADR 0007: XBRL for numbers, a local index for text, and a bounded job runner

## Status

Accepted on 22 October 2026, when [#19](https://github.com/himanshu634/maester/pull/19) built it into staging; proposed on 19 October 2026. Amends [ADR 0006](0006-concepts-calculations-agent-access.md): for a filing with an XBRL version, the reader is XBRL alone, and the two PDF readers apply only to filings without one. Moves XBRL ingestion and OCR (for search only) into scope from the [financial data layer](../superpowers/specs/2026-10-15-financial-data-layer-design.md)'s §14. Keeps [ADR 0004](0004-python-extraction-sidecar.md)'s stateless Python services. The design is [ingestion pipeline](../superpowers/specs/2026-10-19-ingestion-pipeline-design.md); the evidence is the [research](../research/2026-10-19-ingestion-research.md).

## Context

Maester reads figures from PDFs with Gemini, with no limit on how many files it reads at once, and keeps no text for search. Most of the investor's filings are from listed companies, which also file their accounts with MCA and their results with BSE in XBRL: the same figures, already structured, with no model needed. Filings vary widely in format, and nothing yet measures how accurately figures are read. The project has no budget for paid APIs beyond the Gemini reads that already run.

## Decision

- **XBRL is exclusive for numbers when it exists.** An XBRL instance the investor uploads becomes facts through our own parser over the instance (no taxonomy, no network, no model), with a reviewed element map per format giving statement, order, label, concept and sums. Arelle or maps generated from the official linkbases can replace the hand maps once the taxonomy packages and their terms are confirmed. For one company, kind, period, span and basis, an XBRL revision supplies the whole column; a PDF read never tops it up, and Gemini is not called for a PDF whose bases XBRL already covers. Each XBRL value is also looked for on the paired PDF's text layer, as a check that is shown and never overrides.
- **Text goes to a local index.** A new indexer service reads every page with Docling (text layer, layout and tables; RapidOCR, set explicitly, for regions with no text) and chunks by element within pages along the filing's sections. A new embedder service (text-embeddings-inference, CPU) turns chunks and queries into vectors with an open-source model, `snowflake-arctic-embed-l-v2.0` by default. Vectors live in Postgres with pgvector, indexed as `halfvec`; search is hybrid with `simple` full-text. OCR text is for search only and never confirms a figure.
- **Jobs are pulled, not pushed.** The worker claims jobs from the existing `job` table with `FOR UPDATE SKIP LOCKED`, with a concurrency limit per job type, woken by `NOTIFY`, with retry backoff, an expired-lease sweeper and timer heartbeats, so many files process in parallel without exhausting the machine.
- **Accuracy is measured** by source and by format, against the gold set and, at scale, Gemini against XBRL on every filing that has both.

## Alternatives considered

XBRL as a checker only, with the PDF as the record (rejected by the investor: it pays for a Gemini read the XBRL makes unnecessary). Fetching XBRL from BSE, NSE or MCA (scraping; MCA also needs a login and a fee). A paid embedding API such as Voyage (no budget; its open-weight model is a candidate instead). Claude OCR by default (paid; kept as an option). A hosted vector database or a second Postgres now (no measured need). Keeping push dispatch and adding a semaphore in the handler (a pushed job still holds a connection and a lease while it waits; pulling is simpler and survives restarts).

## Consequences

Postgres moves to the `pgvector/pgvector:pg16` image. Two services join the compose file: the indexer (Docling) and the embedder (text-embeddings-inference). The extractor gains an XBRL parser and element maps. Indexing a long annual report on this CPU takes an estimated 35 to 95 minutes, so index jobs write as they go and run one at a time. Uploads accept XML. A figure from XBRL has no page, so the figure panel and the Documents screen change, through a design round first. The evaluation gains source and format strata and an XBRL comparison. The worker's dispatch changes from HTTP push to a database queue.
