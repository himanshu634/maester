# Maester evaluation harness

`maester-eval` runs the extraction workflow over real filings and scores it against a gold set a person has checked against the PDFs. It is how a change to a prompt, a rule, a check, the taxonomy or the text-layer reader is shown to help or hurt before it lands. The design is [financial data layer](../../docs/superpowers/specs/2026-10-15-financial-data-layer-design.md), §9.

## Commands

| Command | What it does |
| --- | --- |
| `maester-eval live --set dev` | Reads every filing of the set with the real model, exactly as the extractor would, and writes one artefact per filing under `data/eval/runs/<timestamp>[-label]/`. `--label` takes letters, digits, dot, dash or underscore. Costs model calls. |
| `maester-eval export --run latest` | Writes a labelling sheet per filing to `data/eval/sheets/`, pre-filled with what the pipeline read. Never overwrites a sheet without `--force`. |
| `maester-eval freeze <filing-id> --run latest` | Turns a checked sheet into `data/eval/gold/<filing-id>.json`, reading the machine columns back from the run's artefact. Only rows marked `verified` are kept, and each needs a concept from the taxonomy or the freeze stops. Never overwrites gold without `--force`. |
| `maester-eval report --run latest` | Scores the run against the gold set and writes `report.md` and `report.json` into the run folder; `--to docs/eval/<date>-<label>.md` publishes the Markdown; `--against <run>` adds the delta. |

The same tool measures the document index (ingestion phase 3). These commands call no model:

| Command | What it does |
| --- | --- |
| `maester-eval ocr request --out <file>` | Writes the request the worker reads: the `dev` filings that are in the corpus, and no questions. |
| `maester-eval ocr report --run latest` | Scores the `scores.csv` that `maester-indexer-ocr-sample` wrote and a person filled in, then chooses the OCR engine and the table cell matching by rules fixed in advance. Writes `report.md` into the run folder; `--to docs/eval/<date>-ocr-spot-check.md` publishes it. |
| `maester-eval retrieval check` | Checks `questions.csv` and `corpus.json` against the manifest and prints counts. It shows no question. At least 40 questions must be `verified`. |
| `maester-eval retrieval request [--label <word>]` | Writes `request.json` (the corpus filings and the verified questions) into a new run folder under `data/eval/retrieval/runs/`. |
| `maester-eval retrieval report --run latest` | Scores the rankings of each embedding model (recall@5, recall@10 and MRR, by method and by text source), applies the model rule and writes `report.md` into the run folder; `--to docs/eval/<date>-retrieval.md` publishes it. Names questions by id only. |

The worker writes the rankings and the timings: `pnpm --filter @maester/worker eval rank|bench` (see [the worker description](../../docs/systems/worker.md)). The indexer writes the OCR sheet: `maester-indexer-ocr-sample` (see [the indexer description](../../docs/systems/indexer.md)). Retrieval pages are PDF pages counted from 1, as `document_page.page_number` counts them; they are not the page numbers a filing prints.

A filing id is its path under the corpus without `.pdf`: `synthetic-cements/ar-2025-26`.

## Layout

```
data/eval/manifest.json   which filings exist, whose they are, annual report or results, dev or held-out (committed)
data/eval/corpus/         the PDFs (git-ignored)
data/eval/sheets/         labelling sheets (yours to commit or not)
data/eval/gold/           the gold set (committed)
data/eval/runs/           artefacts and reports per run (git-ignored)
data/eval/ocr/pages.json  the 10 scanned and 5 digital pages of the OCR spot check (committed)
data/eval/ocr/runs/       one folder per OCR run: scores.csv, a picture and the text of each page, report.md (git-ignored)
data/eval/retrieval/      corpus.json, questions.csv and runs/<run>/ (request.json, run.json and, per model, <slug>.rankings.json, <slug>.bench.json, <slug>.parity.json) (git-ignored: it holds question text)
docs/eval/                published reports (committed)
packages/contracts/concepts.json   the concepts the gold set is labelled with
```

A filing may also carry `stratum` (`large`, `mid`, `small`, `financials`: the size band the split was stratified by), `out_of_scope` (why a baseline leaves it out: `live` skips it unless named with `--only`; `report` lists it under "Out of scope" and does not count it as not run) and `printed_pages_per_page` (`2` when each PDF page is a spread of two printed pages).

## Rules

- Public filings only. Never put a private document in the corpus.
- A company is in one set only, `dev` or `heldout`. Tune on `dev`; run `heldout` only to decide whether a change lands.
- The console never shows a label or a figure; the files do.
- Figures are compared as exact decimals. A match means value, sign and scale together (the normalised figure), basis and period all agree.
- Freeze from the run you exported (`freeze <id> --run latest`): a cell you edit must still agree with the artefact, or put the correction in its `gold_` column.

## Configuration

The same variables as the extractor: `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` (default `us-central1`), `GEMINI_MODEL` (default `gemini-2.5-pro`), `EXTRACT_DEADLINE_SECONDS` (default `840`), read from `.env`.
