# ADR 0006: Concepts, two readers, calculations in TypeScript, and a read-only MCP server

## Status

Accepted on 15 October 2026. Extends [ADR 0004](0004-python-extraction-sidecar.md): extraction stays in Python; the figures it produces get a meaning layer, a second reader, a calculation service and an agent interface. The design is [financial data layer](../superpowers/specs/2026-10-15-financial-data-layer-design.md). Amended by [ADR 0007](0007-ingestion-pipeline.md): for a filing with XBRL, the reader is XBRL alone. Since 23 October 2026 reader A is Claude, not Gemini (see ADR 0004's amendment). As of 30 October the read-only MCP server is built; the concept mapping and overrides, reader B and the calculation registry are not.

## Context

The pipeline stores every figure as printed with its page, but nothing says what a figure means: consumers find revenue and profit by regular expressions over labels, arithmetic happens in the browser with floats and in the CLI inside a prompt, a period is a single date, and only one reader (Gemini) ever sees a page. An agent cannot be given these figures without second-guessing them, and nothing measures whether a change to the reading helps. The investor's scope is annual statements, quarterly results and five note families, read first by an agent through MCP.

## Decision

- **Meaning is a layer over as-printed facts.** `financial_fact` stays immutable and as printed. A `concept_mapping` per fact records a taxonomy concept and its source (a deterministic rule, or the model for lines no rule placed). A per-company `concept_override` records the investor's correction by label, so it applies to every filing and re-read. The taxonomy is one JSON document in `packages/contracts`, loaded by both runtimes and kept in step by a test.
- **Two independent readers.** Gemini remains reader A. A deterministic text-layer table parser (`pdfplumber`) is reader B. Their agreement is recorded per fact (`confirmed`, `unverified`, `disputed`), a disagreement is shown and routed to the correction step, never resolved silently. Checks that the model cannot influence (concept sums from the taxonomy, cross-statement identities, period identities) are added beside the existing ones.
- **Calculations live in TypeScript**, in `packages/financial-engine-ts` (`@maester/financial-engine`), with exact decimals (`decimal.js`), a registry of named, versioned metrics, and results that carry every input's fact id. The web formats results and computes nothing. No prompt asks a model to compute, convert, round, rank or compare.
- **Agents read through `apps/mcp`**, a read-only stdio MCP server over the same functions the API mounts, scoped to one workspace on the investor's machine. Reviews and overrides happen in the terminal UI only.
- **Nothing changes without measurement.** `apps/eval` runs the pipeline over the investor's own filings against a hand-checked gold set; a baseline is taken before any change, and every change ships with a report.

## Alternatives considered

Storing the model's concept on the fact (meaning baked into an immutable row with no deterministic first pass; rejected). A concept-keyed warehouse table the worker upserts (loses printed structure, restatements and per-cell provenance; rejected). Model-only reading with more self-correction (the same model is not an independent check on itself; rejected). Parser-first reading with the model only for scans (a long tail of layouts; the parser is kept as the second reader instead). Calculations in Python behind HTTP (a network hop per figure and domain semantics in two runtimes; rejected). MCP over HTTP with personal access tokens (needed only for remote use; deferred).

## Consequences

`packages/financial-engine-ts` stops being a placeholder but still does not port extraction. The extractor gains a dependency (`pdfplumber`), a mapping step with a flash model call, new check kinds and a `/v1/map` endpoint; its wire format and golden fixtures grow. Migration 0006 adds columns to `financial_fact` and three tables. The CLI's `ask` is deprecated once the MCP server answers the same questions with lineage. A gold set of the investor's filings must exist before the pipeline changes.
