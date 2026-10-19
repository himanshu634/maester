# ADR 0007: A document index in pgvector, Claude for OCR, Voyage for embeddings

## Status

Proposed on 19 October 2026. Amends the out-of-scope list of the [financial data layer](../superpowers/specs/2026-10-15-financial-data-layer-design.md) (§14) for OCR, for search only, and keeps [ADR 0004](0004-python-extraction-sidecar.md)'s stateless extractor. The design is [document index](../superpowers/specs/2026-10-19-document-index-design.md).

## Context

Maester stores every filing and reads figures from annual reports and results, but nothing can find a passage in a filing: the narrative (management discussion, notes, policies, risks) is never stored, and a scanned page has no text at all. The next consumers, search and then an agent that answers questions about the investor's companies, need every filing's text in passages that keep their page, and a way to find them by meaning and by exact words. The investor has an Anthropic Console account and wants Claude in the pipeline beside Gemini.

## Decision

- **An index per document, separate from the figures.** A `document.index` job, chained from `document.verify` beside classification, builds an immutable revision of each document's pages, chunks and embeddings. It runs for every kind of document and never changes intake or extraction.
- **pgvector in the existing Postgres.** Chunks and their vectors live next to the documents, scoped by workspace. A separate vector database waits for measured need.
- **Claude for OCR, for search only.** A scanned page goes to Claude as a one-page PDF and comes back as text as printed, stored with its source, model and prompt version. OCR text is never read by the extraction workflow, any check, the classifier's quote check or reader B; using it there would let a model's transcription confirm a model's reading.
- **Voyage for embeddings**, the model chosen between `voyage-finance-2` and `voyage-4-large` by a retrieval test on the investor's filings. Embeddings are keyed by model, so a change of model is a rebuild, not a migration.
- **Hybrid search**: vectors and Postgres full-text, merged by reciprocal rank. A search result carries a document and a page, never a figure.

## Alternatives considered

A hosted vector database (another vendor holding filing text, and workspace scoping outside the database). A second Postgres instance now (no measured need). Gemini embeddings on Vertex (the investor chose Voyage). Tesseract for OCR (weak on tables and Indian number layouts). Using OCR text as a second reader for scanned statements (a change to reader B; deferred to its own design and evaluation). Chunking across page breaks (citations would lose their single page).

## Consequences

Postgres moves to the `pgvector/pgvector:pg16` image and the eventual host must offer pgvector. The extractor gains `/v1/index`, the official `anthropic` SDK and an `ANTHROPIC_API_KEY`. The worker and API gain the Voyage SDK and a `VOYAGE_API_KEY`. Filing text now goes to Anthropic (scanned pages) and Voyage (every chunk). A retrieval set and report join `docs/eval/`. Claude as a statement reader (project 2) and XBRL (project 3) get their own designs; this one does not decide them.
