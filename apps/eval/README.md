# Maester evaluation harness

`maester-eval` runs the extraction workflow over real filings and scores it against a gold set a person has checked against the PDFs. It is how a change to a prompt, a rule, a check, the taxonomy or the text-layer reader is shown to help or hurt before it lands. The design is [financial data layer](../../docs/superpowers/specs/2026-10-15-financial-data-layer-design.md), §9.

## Commands

| Command | What it does |
| --- | --- |
| `maester-eval live --set dev` | Reads every filing of the set with the real model, exactly as the extractor would, and writes one artefact per filing under `data/eval/runs/<timestamp>[-label]/`. `--label` takes letters, digits, dot, dash or underscore. `--paired` keeps only the filings that have XBRL instances paired with them, and prints `paired: <n> of <m>` first. Costs model calls. |
| `maester-eval xbrl-pair --xbrl-manifest <csv> --from <folder>` | Pairs each results filing with the XBRL instances BSE filed for it (by BSE code, period and basis), copies them into the corpus and writes the pairs into the manifest. `--dry-run` checks and counts only. |
| `maester-eval xbrl-read --set dev` | Reads the paired instances in-process with the engine's XBRL reader into an XBRL run (`data/eval/runs/<timestamp>-xbrl/`). No model, no cost. `--set heldout` and `--set all` need `--gate`. |
| `maester-eval xbrl-elements --instances <folder> --out <folder>` | Lists the numeric elements each XBRL format holds, as names and counts only, to `elements-<format>.csv`. |
| `maester-eval tags propose \| set \| pick \| coverage` | The format tags. `propose` sets each results filing's unit from the rounding its instances declare. `set <filing-id>` records the investor's `--unit`, `--brackets` and `--restated`. `pick --set dev` proposes the first 10 to 15 gold filings so that every tag value has one. `coverage --set dev` counts the gold filings and facts by tag value and checks each unit tag against the gold's scales (`--set heldout` is allowed; `all` is not). |
| `maester-eval export --run latest` | Writes a labelling sheet per filing to `data/eval/sheets/`, pre-filled with what the pipeline read. Never overwrites a sheet without `--force`. Refuses an XBRL run. |
| `maester-eval freeze <filing-id> --run latest` | Turns a checked sheet into `data/eval/gold/<filing-id>.json`, reading the machine columns back from the run's artefact. Only rows marked `verified` are kept, and each needs a concept from the taxonomy or the freeze stops. Never overwrites gold without `--force`, which keeps the facts the investor settled. |
| `maester-eval compare --run <pdf run> --xbrl <xbrl run>` | Sets Gemini against XBRL, cell by cell (a slot and a concept), on every selected results filing that has both. Writes `compare-xbrl.md` and `compare-xbrl.json` into the PDF run's folder and a settle sheet per dev filing with a disagreement into `data/eval/settle/`. `--against <run>` adds the delta, `--to` publishes the Markdown, `--force` replaces a settle sheet. `--set heldout` and `--set all` need `--gate`. |
| `maester-eval settle <filing-id> --run <pdf run>` | Adds the cells the investor settled in `data/eval/settle/<filing-id>.csv` (rows marked `verified`) to the filing's gold file as facts of origin `settled`. Never replaces a gold fact. Held-out gold is sealed. |
| `maester-eval report --run <pdf run>` | Scores the run against the gold set and writes `report.md` and `report.json` into the run folder; `--to docs/eval/<date>-<label>.md` publishes the Markdown; `--against <run>` adds the delta. Repeat `--run` (and `--against`) once per source to add an XBRL run: the report then gives the figures by source (`pdf`, `xbrl` and `shown`), by format tag and for the element map against gold, and scores settled facts apart. |

A filing id is its path under the corpus without `.pdf`: `synthetic-cements/ar-2025-26`.

## Layout

```
data/eval/manifest.json   which filings exist, whose they are, annual report or results, dev or held-out, their XBRL pairs and format tags (committed)
data/eval/corpus/         the PDFs, and each company's XBRL instances under <company>/xbrl/ (git-ignored)
data/eval/sheets/         labelling sheets (yours to commit or not)
data/eval/settle/         settle sheets: the disagreements `compare` found, for you to settle (yours to commit or not)
data/eval/gold/           the gold set (committed)
data/eval/runs/           artefacts and reports per run, PDF runs and XBRL runs (git-ignored)
data/eval/xbrl/           `xbrl-elements` output (git-ignored)
docs/eval/                published reports (committed)
packages/contracts/concepts.json   the concepts the gold set is labelled with
```

A results filing may also carry `bse_code`, `xbrl` (its pairs: instance file, basis, period token, filed date and format, written by `xbrl-pair`) and `tags` (`unit`, `unit_from`, `negatives_in_brackets`, `restated_columns`). A tag nobody set is "not tagged", never "no".

A filing may also carry `stratum` (`large`, `mid`, `small`, `financials`: the size band the split was stratified by), `out_of_scope` (why a baseline leaves it out: `live` skips it unless named with `--only`; `report` lists it under "Out of scope" and does not count it as not run) and `printed_pages_per_page` (`2` when each PDF page is a spread of two printed pages).

## Rules

- Public filings only. Never put a private document in the corpus.
- A company is in one set only, `dev` or `heldout`. Tune on `dev`; run `heldout` only to decide whether a change lands.
- The held-out gate: `xbrl-read` and `compare` refuse `--set heldout` and `--set all` unless you pass `--gate`, and `settle` refuses every held-out filing. `report` and `live` have no gate, so name the held-out set in them only for that one decision. Do not tune a prompt, a rule or an element map on it.
- Every headline rate (by source, by format tag, the held-out gate) is over the gold facts a person labelled from a sheet (`origin "sheet"`). Facts frozen from settled disagreements (`origin "settled"`) were labelled with the XBRL figure in view, so `report` scores them in a table of their own.
- `match` is exact equality, for every source. A figure equal only at the coarser of two precisions (`match_at_precision`), a printed dash against an XBRL `0` (`match_dash_zero`) and a figure that differs only in sign (`wrong_sign`) are counted beside it, never inside it.
- The console never shows a label or a figure; the files do.
- Figures are compared as exact decimals. A match means value, sign and scale together (the normalised figure), basis and period all agree.
- Freeze from the run you exported (`freeze <id> --run latest`): a cell you edit must still agree with the artefact, or put the correction in its `gold_` column.

## Configuration

The same variables as the extractor: `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` (default `us-central1`), `GEMINI_MODEL` (default `gemini-2.5-pro`), `EXTRACT_DEADLINE_SECONDS` (default `840`), read from `.env`.
