---
name: financial-figures
description: The rules and checklists for any work in Maester that reads, stores, computes or shows a financial figure — a concept in the taxonomy, a mapping rule, a metric, an extraction check, an extraction prompt, the text-layer reader, the series query, an API route or MCP tool that returns numbers, or a page or component that displays them. Use whenever a task touches `packages/financial-engine/src/pdf_financial_qa/workflow` or `concepts`, `packages/financial-engine-ts`, `packages/contracts/concepts.json` or `extraction.ts`, `apps/extractor`, `apps/worker/src/jobs/document-extract.ts`, `apps/api/src/financials`, `apps/mcp`, `apps/eval`, or `apps/web/src/lib/research`; whenever a prompt mentions revenue, profit, margin, growth, ratio, P/E, EPS, cash flow, balance sheet, quarter, TTM, unit, scale, crore, lakh, decimal, rounding or "the number"; and whenever an answer to the user would state a figure from the database. Also use when asked how a figure was worked out or why one is "—".
---

# Financial figures

Every number an investor or an agent sees in Maester is one of two things: a **fact** read from a filing, with its page, or the **result of a named calculation** over facts. There is no third kind. The design is `docs/superpowers/specs/2026-10-15-financial-data-layer-design.md`; the decision is ADR 0006. This skill is the working rule-book for it.

## The rules

**For any model, including you, when a figure is in play**

1. A number you state is a fact (fact id, filing, page) or a calculation result (metric id and version, input fact ids). Nothing else: no figure from memory, no figure from outside knowledge of the company.
2. You never add, divide, compare, rank, convert, round or annualise figures yourself. You call `compute` (or, in this repository, write or extend a metric). No metric for it? Say so.
3. Unknown stays unknown: null with its reason, never zero, never an estimate, never "about".
4. Every figure travels with its basis (consolidated, standalone), currency, unit, span and period. Consolidated and standalone never mix in one sentence or one formula.
5. A figure that is disputed, failed a check, was mapped by the model, or is not reviewed is said to be so, in words.
6. No advice words (buy, sell, cheap, expensive, undervalued, overvalued, target, opportunity). Direction is a sign or a word, never a colour.

**For the code**

- A derived number comes from a named, versioned function in `packages/financial-engine-ts` (`@maester/financial-engine`), with a fixture whose expected value was worked out independently of the function (by hand, or a spreadsheet, with the working recorded). `apps/web` formats; it never computes a figure. `apps/api` orchestrates; the formula is in the engine package.
- Decimal strings on the wire, `numeric` in Postgres, `decimal.js` in TypeScript, `Decimal` in Python. Never a float for money, a quantity, a ratio or a percentage. `Number()` on a figure is a defect.
- What a printed line means comes from the taxonomy (`packages/contracts/concepts.json`), the mapping rules, and the recorded mapping or override. Never a regular expression over labels in a page, a component or a route; never a guess at read time.
- Model output is data: validated against a schema, never executed, never the authority for a number. A prompt never asks a model to compute, convert, round, rank or compare; it asks for text as printed.
- A change to a prompt, a mapping rule, the taxonomy, reader B (the text-layer parser), a check or a metric lands with an evaluation run (`apps/eval`) and its report under `docs/eval/`; no regression on the held-out set. A version is bumped: `PIPELINE_VERSION`, `PROMPT_VERSION` (automatic), `MAPPING_RULES_VERSION`, `TAXONOMY_VERSION`, or the metric's `version`.
- Facts and revisions are immutable. A correction is a `fact_review` or a `concept_override` row; the original stays.
- Checks say "not checked" with a reason, never a silent pass; a failure names its cells.

## Where things live

Paths marked *(phase n)* arrive with that phase of the spec; until then they do not exist, and the rule that would use them still applies.

| What | Where |
| --- | --- |
| Taxonomy | `packages/contracts/concepts.json` *(phase 1)*; Python copy `packages/financial-engine/src/pdf_financial_qa/concepts/taxonomy.py`, generated, checked by a test |
| Mapping rules | `packages/financial-engine/src/pdf_financial_qa/concepts/rules.py` *(phase 1)* |
| Extraction workflow | `packages/financial-engine/src/pdf_financial_qa/workflow/` — `runner.py` (graph), `prompts.py`, `drafts.py` (checks), `values.py` (parsing, scale, dates), `model.py`, `pdf.py`; reader B `reader_b.py` *(phase 3)* |
| Wire format | `packages/financial-engine/src/pdf_financial_qa/workflow/contracts.py` ↔ `packages/contracts/src/extraction.ts`, pinned by `packages/contracts/fixtures/extraction/` |
| Writes | `apps/worker/src/jobs/document-extract.ts`; `document-map.ts` *(phase 1)* |
| Schema | `packages/db/src/schema/extraction.ts`; `concepts.ts` *(phase 1)* for `concept_mapping`, `concept_override`, `fact_review` |
| Series and metrics | `packages/financial-engine-ts/src/` — `decimal`, `concepts`, `series`, `periods`, `metrics` *(phase 1)*; fixtures beside them |
| API | `apps/api/src/financials/` (`stitch.ts` today; `series.ts`, `compute.ts` *(phase 1)*), `apps/api/src/routes/research.ts` |
| MCP | `apps/mcp/` *(phase 2)* |
| Evaluation | `apps/eval/` *(phase 0)*; corpus `data/eval/corpus/` (git-ignored); gold `data/eval/gold/`; reports `docs/eval/` |
| Web | `apps/web/src/lib/research/` (`summary.ts` formats only), `components/research/` |

## Checklists

**Add a concept**

1. Add it to `concepts.json`: `id` (snake_case, permanent), `label`, `family`, `kind`, `period_type`, `dimensions`, `sum_of` or `cross_check` if a total or an identity defines it, `notes` for the convention. Bump `TAXONOMY_VERSION`.
2. Regenerate the Python copy; the drift test passes.
3. Add the mapping rule(s) that place it, with a `rule_id`, and a case for each in the rules test, including a label that must *not* match.
4. Add it to the gold labelling sheet columns if it is material.
5. Run `maester-eval replay` (mapping coverage and accuracy) and commit the report. Re-map stored revisions with `document.map`.

**Add a metric**

1. Registry entry: `id`, `version: 1`, `label`, `description` with the convention stated, `inputs` with period rules and alternatives, `spans`, `unit`, `unavailable_when`.
2. The formula as a pure function of `Decimal`s. No I/O, no dates, no formatting.
3. A fixture with inputs and the expected value, computed independently, with how it was computed in a comment; one fixture per unavailable case.
4. The UI sentence for each unavailable code in `lib/content/research.ts` if the web shows it.
5. A row in the spec's §7.2 table and in `docs/systems/packages.md`.

**Change a prompt, a check, or reader B**

1. Say in the plan which gold cases should change and why.
2. Make the change; the version bumps (`PROMPT_VERSION` is a hash; `PIPELINE_VERSION` for anything that changes what a fact means).
3. `maester-eval replay` for a check or reader B change; `maester-eval live --set dev` for a prompt change (costs model calls; say so first).
4. Compare with the previous report: exact match, agreement mix, check pass rate. A regression on held-out stops the change.
5. Commit the report under `docs/eval/` with the code.

**Change the element map** (an XBRL element's concept, scale or sign in `packages/financial-engine/src/pdf_financial_qa/xbrl/maps/`)

1. `xbrl-map --against` (phase 4): the map's own baseline report, against the earlier map.
2. `maester-eval xbrl-read --set dev`: a new XBRL run, read under the new map.
3. `maester-eval report --run <pdf run> --run <new xbrl run> --against <old xbrl run> --set dev`.
4. `maester-eval compare --run <pdf run> --xbrl <new xbrl run> --against <old xbrl run>`.
5. The held-out set once, to land: `xbrl-read --set heldout --gate`, then `report` and `compare --gate` on it. Only `xbrl-read` and `compare` take `--gate`.
6. No regression on held-out in the `xbrl` exact match (exact equality only, over `origin "sheet"` gold) or in `compare`'s agreement. Read the at-precision, dash-as-`0` and sign-only counts beside them.
7. The reports under `docs/eval/` (`--to`), committed with the change.

A change of sign convention in the map (an element whose figure is to be read as negative) is a map change like any other. It goes through these seven steps, and its report states which elements changed sign. Never flip a sign anywhere else, and never to make a number match.

**Show a figure**

1. The value comes from `/series`, `/compute`, `/financials` or an MCP tool, already in its canonical unit with provenance. The component formats it (`Intl`, the project's `format.ts`) and nothing more.
2. Unknown is "—" with the reason read out (`aria`), per `DESIGN.md` §5 and §10 ("Figures").
3. Basis, unit and period are visible or in the note. Direction is a sign.
4. A caveat in the result (model-mapped, disputed, failed check, unreviewed) appears as the figure's note, in words.

**Answer a question about a figure (as an agent, or in this session)**

1. `get_series` or `compute`; never arithmetic in your head.
2. Quote the value with unit, basis, period, filing and page, and the caveats.
3. If the metric does not exist: say so, offer to add it (checklist above), do not improvise the division.

## What not to do

- Do not "quickly" compute a percentage in a Svelte file, a route or a reply.
- Do not map a line to a concept with a regex in the API or the web "for now".
- Do not change a prompt and ship without an eval report.
- Do not treat a passed subtotal check as proof: it is one check that ran on known inputs. Say which check passed.
- Do not log a figure's printed text, a label or an excerpt: document text never goes to logs or traces.
- Do not reach for the CLI's `qa.py` pattern (pasting JSON into a prompt and asking the model to apply scale factors). It is deprecated for exactly this reason.
