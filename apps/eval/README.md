# Maester evaluation harness

`maester-eval` runs the extraction workflow over real filings and scores it against a gold set a person has checked against the PDFs. It is how a change to a prompt, a rule, a check, the taxonomy or the text-layer reader is shown to help or hurt before it lands. The design is [financial data layer](../../docs/superpowers/specs/2026-10-15-financial-data-layer-design.md), §9.

## Commands

| Command | What it does |
| --- | --- |
| `maester-eval live --set dev` | Reads every filing of the set with the real model, exactly as the extractor would, and writes one artefact per filing under `data/eval/runs/<timestamp>/`. Costs model calls. |
| `maester-eval export --run latest` | Writes a labelling sheet per filing to `data/eval/sheets/`, pre-filled with what the pipeline read. Never overwrites a sheet without `--force`. |
| `maester-eval freeze <filing-id>` | Turns a checked sheet into `data/eval/gold/<filing-id>.json`. Only rows marked `verified` with a concept from the taxonomy are kept. |
| `maester-eval report --run latest` | Scores the run against the gold set and writes `report.md` and `report.json` into the run folder; `--to docs/eval/<date>-<label>.md` publishes the Markdown; `--against <run>` adds the delta. |

A filing id is its path under the corpus without `.pdf`: `synthetic-cements/ar-2025-26`.

## Layout

```
data/eval/manifest.json   which filings exist, whose they are, annual report or results, dev or held-out (committed)
data/eval/corpus/         the PDFs (git-ignored)
data/eval/sheets/         labelling sheets (yours to commit or not)
data/eval/gold/           the gold set (committed)
data/eval/runs/           artefacts and reports per run (git-ignored)
docs/eval/                published reports (committed)
packages/contracts/concepts.json   the concepts the gold set is labelled with
```

A filing may also carry `stratum` (`large`, `mid`, `small`, `financials`: the size band the split was stratified by), `out_of_scope` (why a baseline leaves it out; `live` and `report` skip it unless named with `--only`) and `printed_pages_per_page` (`2` when each PDF page is a spread of two printed pages).

## Rules

- Public filings only. Never put a private document in the corpus.
- A company is in one set only, `dev` or `heldout`. Tune on `dev`; run `heldout` only to decide whether a change lands.
- The console never shows a label or a figure; the files do.
- Figures are compared as exact decimals. A match means value, sign, scale, basis and period all agree.

## Configuration

The same variables as the extractor: `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` (default `us-central1`), `GEMINI_MODEL` (default `gemini-2.5-pro`), `EXTRACT_DEADLINE_SECONDS` (default `840`), read from `.env`.
