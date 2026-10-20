# Ingestion phase 5: measure the numbers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This plan adds to `maester-eval`:
- figures scored against the gold set by source (`pdf`, `xbrl`, and `shown`, the figure the source rule picks) and by format tag;
- the element map scored against gold;
- `maester-eval compare`, which sets Gemini against XBRL, cell by cell, on every corpus results filing that has both, with the disagreements written out for the investor to settle and freeze into gold.

**Architecture:** The work lives in `apps/eval` only. It reads files, never the database, and makes no model call except `live`, which already exists.
- **Pairing.** `xbrl-pair` pairs each results filing of the manifest with its instances from the investor's `xbrl-manifest.csv`, by BSE code, period end and basis, and copies the instances into the git-ignored corpus.
- **Tags.** `tags` fills, sets and checks the format tags, and proposes the first gold filings.
- **XBRL runs.** `xbrl-read` reads the paired instances in-process with phase 4's reader (`parse_instance`, `classify_instance`, `read_instance`) into an XBRL run folder, the way `live` writes a Gemini run.
- **Cells.** A cell is a source-rule slot (`maester_eval.source_rule.slot_key`) plus a concept.
  - XBRL facts take their concept from the element map.
  - Gemini facts take theirs from the labelling sheets' `concept` column.
  - Gold facts are keyed by concept already.
  - A span rule over column headers places Gemini and gold facts in a slot.
- **Agreement.** Figures agree exactly, or at the coarser of the two precisions, which is stitch's `sameFigure` rule.
- **Scoring.** `report` scores one run per source and the `shown` mix built with `plan_pdf_numbers`. `compare` writes an agreement report and a settle sheet per filing. `settle` adds the investor's settled cells to the filing's gold file.

**Tech Stack:** Python 3.11+, Typer, Rich, Pydantic v2, `decimal.Decimal` (`ROUND_HALF_UP`), `csv`, `hashlib`, `unittest`. Phase 4's `pdf_financial_qa.xbrl` (lxml) and `maester_eval.source_rule`.

**Spec:**
- [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md): §10.1, §10.2, §14, §16 phase 5 and §17.
- [Financial data layer](../specs/2026-10-15-financial-data-layer-design.md): §4 (span, override), §5.2 (span from header words) and §9 (corpus, gold, held-out, gate).
- Builds on the [phase 0 plan](2026-10-15-eval-baseline.md) (`apps/eval` as built on this branch) and the [phase 4 plan](2026-10-20-ingestion-phase-4-xbrl.md) with its interface sheet `.superpowers/plans-1-6/phase-4-interfaces.md`.
- Rules: `CLAUDE.md` "Financial figures", the `financial-figures` skill.

## Survey of the manifests

Read-only, 20 October 2026. Only ids, codes, period tokens, bases, file names and counts were taken, never a figure.
- **The corpus manifest is on `origin/feat/eval-corpus` only** (commit `24e5f3e`).
  - It holds 491 filings of 50 companies: 99 annual reports and 392 results.
  - Dev has 30 companies and held-out has 20.
  - 48 filings of the five banks and NBFCs are `out_of_scope`.
  - 31 annual reports are spreads (`printed_pages_per_page: 2`).
  - Its code changes are already in this branch's `manifest.py` (this branch's file is a superset). It loads under the current loader: 491 filings, 266 dev filings in scope.
  - `json.dumps(data, indent=2, ensure_ascii=False) + "\n"` reproduces it byte for byte.
  - It has no BSE code.
- **`~/Personal/maester-filings/xbrl-manifest.csv`.**
  - Its columns are `tier, bse_code, company, period, audited, basis, filed, file, status`.
  - It has 807 rows of 50 companies, all with status `exists`.
  - `file` is relative to `~/Personal/maester-filings` (`xbrl/<tier>/<code>_<name>/<filed>_<period>_<basis>_<format>_<code>_<stamp>.xml`).
  - The period tokens are `JQ` 193, `MC` 187, `SQ` 105, `DN` 103, `DQ` 99, `SH` 92, `MQ` 18 and `MH` 10, each followed by a financial year such as `2025-2026`.
  - Every manifest company matches one CSV company by normalised name (`maester_eval.text.normalise`), and each name has one code.
- **Pairing results filings by (BSE code, period end):**
  - 390 results filings pair (233 dev, 157 held-out) with 793 instances.
  - 14 instances have no results filing of their period:
    - HDFC Bank `SH2025-2026` and `SQ2024-2025`;
    - Coforge `DN2025-2026` and `JQ2025-2026`;
    - Gujarat State Petronet `DQ2024-2025`;
    - Infosys `MC2025-2026` and Aether Industries `MC2024-2025`, whose only PDF for that period is an annual report.
  - 2 results filings have none: `nestle-india/results-2026-09` and `polycab-india/results-2026-09`.
  - By basis:
    - 351 pair one consolidated and one standalone instance;
    - 17 pair a standalone instance only;
    - 18 pair one period token and basis twice: a refiling, the same filed date (7 dev and 10 held-out in scope, 1 held-out out of scope);
    - 5 pair two tokens for one period end (`MH` with `MQ` four times, `MC` with `MH` once): a March half year beside a March quarter or year. These are different instances, not copies, and can still meet in one slot (the year).
- **In scope, by format token.**
  - Dev: 211 paired filings, 322 `Integrated_Finance_Ind_As`, 106 `Main_Ind_As` and 2 `IFOtherthan`. `larsen-and-toubro/results-2025-03` has no mapped instance.
  - Held-out: 141 paired filings, 220 and 66.
- **Units.** The rounding words on hand are Crores, Lakhs and Millions (phase 4 survey). No instance declares Thousands or Actual.
- **Column headers.** The text layers of the 379 results PDFs under `~/Personal/maester-filings/filings` were searched for span words only, with no figures. "Year to date" is on 264 of them. "Quarter ended", "three months" or "3 months" is on 361, "nine months" on 149, and "half year" or "six months" on 127. 90 print "year to date" with no half-year or nine-month words.

## Where this plan departs from the spec, and why

1. **The XBRL side is read in-process, not from the database.** §10.2 says "the XBRL revisions of the same slots". `apps/eval` does not use the database (`docs/systems/eval.md`).
   - `xbrl-read` runs `parse_instance`, `classify_instance` and `read_instance`, the functions `/v1/xbrl` runs, and writes one artefact per filing into a run folder with source `xbrl`. Phase 0 runs `live` in-process for the same reason.
   - So an XBRL reading is kept, versioned (`XBRL_PARSER_VERSION`, `XBRL_MAP_VERSION` in `run.json`) and re-scored against today's gold, and `--against` works for a map change as it does for a prompt change.
   - Phase 4 lists the `xbrl_in_pdf` rows as a phase 5 input. They are in Postgres, so they are not read; see "Not in this phase".
2. **A Gemini fact's concept is taken from the sheets, verified or not, and carried by label within a company.** §10.2 says both "no gold needed" and "Gemini facts through the gold sheet's concept column". Across 211 dev filings, both cannot hold.
   - The concept is taken from a `concept` cell of any sheet of the same company, keyed by statement, normalised section and normalised label. Without the section it is taken only when that label never carries two concepts in the company's sheets.
   - This is the data layer's override (§4: "the investor's concept for a line of a company, by label, applying to every filing of that company").
   - Never by value, and never by a match between labels and the map's labels: either would hide the disagreements being measured.
   - Matches from the filing's own sheet and matches carried from another filing are counted apart (`own`, `company`). The rule is `CONCEPT_CARRY_VERSION = 1`. Open question 1 asks the investor to accept it.
3. **Span is read from the column header by a named rule.**
   - A quarter and its year to date end on the same day: Q2 and the half year on 30 Sep, Q3 and nine months on 31 Dec, Q4 and the year on 31 Mar. XBRL facts carry a span; Gemini facts do not.
   - `GoldFact.span` exists, but `freeze` never sets it.
   - `span_of_label` (`SPAN_RULE_VERSION = 1`) reads the data layer's §5.2 words into phase 4's `fact_span` names (`year`, not `full_year`).
   - SEBI's results format heads the year-to-date column "Year to date figures for current period ended …". That phrase is on the text layer of 264 of the 379 results PDFs on hand. 90 of those print no half-year or nine-month words at all (a count of words, no figures). So "year to date" takes its span from the month its column ends in, under the 1 April financial year Indian listed companies keep: Jun gives quarter, Sep half year, Dec nine months and Mar year.
   - A header that still says no span gives null, and a Gemini fact with a null span is never placed ("no span").
   - The sheet gains `span` (by the rule) and `gold_span` (the person's), and `freeze` writes `span`.
   - The data layer's phase 4 moves the rule into the engine; the eval then imports it.
4. **Only the instances' own slots are compared.**
   - An instance holds its own contexts, not the comparative columns the PDF prints (§6.2). A Gemini line in another slot is "outside the instance", never "PDF only".
   - Gold facts outside the slots are not scored for `xbrl`. They are counted.
   - So the "restated columns" tag will be nearly empty in `compare`: restated figures sit in comparative columns.
5. **Agreement at the coarser precision is agreement.** A PDF can print whole crore where the instance holds lakh precision.
   - `same_figure` brings both values to the coarser of the two precisions, half away from zero. This is stitch's `sameFigure` and `roundTo`, and phase 4's Departure 12 pads XBRL values so that it works.
   - Such a cell is `agree` (or `match` against gold) with `at_precision` true, counted apart. Exact equality stays the headline count beside it.
6. **One instance owns a slot.**
   - 18 filings pair one token and basis twice, and 5 pair two March tokens whose year-to-date facts can share a slot. As in the product, the slot's owner is `rank_slot_candidates`'s first. `revisionCreatedAt` is the CSV's `filed` date and `revisionId` is the instance's file name, so the larger name wins a tie.
   - Every cell where another instance of the slot holds a different figure is listed ("instances differ"). There is no silent pick.
7. **`--xbrl` names an XBRL run.** It is an option with a run as its value; its default is `latest`, the newest XBRL run.
   - `report` and `compare` take `--run` and `--against` more than once, at most one run per source. `--against` replaces the run of its source.
8. **Only results filings are paired.** An annual report is never paired with a Q4 (`MC`) instance, because that is the investor's open question. Instances are copied into the corpus (`data/eval/corpus/<company>/xbrl/<file>`), so the eval reads only `data/eval`, as it does for the PDFs.
9. **Tags.**
   - The unit is proposed from the instances' declared rounding (`unit_from: "xbrl"`).
   - The investor sets the rest: the unit of an annual report, "negatives in brackets" and "restated columns" (`unit_from: "investor"`). No free reader tells these apart reliably.
   - Two-page spreads come from `printed_pages_per_page`, and "banks and NBFCs" from `stratum == "financials"`.
   - An untagged filing is "not tagged", never "no". The financials row reads "out of scope", never 0%.
10. **Held-out stays sealed.**
    - `xbrl-read` and `compare` refuse `--set heldout` or `all` without `--gate`. `settle` refuses every held-out filing.
    - The held-out run happens once, in Task 15, on the investor's word. The XBRL read is free, but the seal is about tuning, not cost.
11. **Settled cells freeze through the normal gold machinery.**
    - A settle sheet is the labelling sheet's columns plus the XBRL ones. `freeze_sheet` reads only the columns it knows.
    - `settle` merges the verified rows into the filing's gold file as `origin: "settled"` facts, and never replaces a gold fact.
12. **A dash against XBRL.** A printed dash against an XBRL `0` agrees (nil both ways). A dash against no XBRL fact is `missing` for `xbrl` and `pdf_only` in `compare`: XBRL did not carry the line.

## Not in this phase

- **Concept mapping of Gemini facts by rule** (the data layer's phase 1). When it lands, it replaces the sheet concepts in `compare`.
- **Measuring `xbrl_in_pdf` itself** (its false failures against Gemini agreement). `check_xbrl_in_pdf` is callable in-process. It is a small follow-up once this phase's `compare` exists.
- **Comparing an annual report with its Q4 results instance.** That would inform the open decision without making it. See open question 4.
- **Labelling held-out filings beyond what phase 0 seals.**
- **A reader for brackets or restated columns.**

## Global Constraints

- **Branching.** Branch from phase 4's branch, or from `staging` once phase 4 is merged.
  - Needs phase 4's Tasks 2 to 6 (`pdf_financial_qa.xbrl`), Task 9 (`maester_eval.source_rule`) and Task 20 (`xbrl-map`, the map's baseline report).
  - Phases 3 and 4 also add commands to `cli.py`; take theirs first.
  - No migration. No TypeScript change.
- **Financial figures** (`CLAUDE.md`, the `financial-figures` skill):
  - Every figure is a `Decimal` or a decimal string. Rates are whole tenths (`Summary.tenths`). There is no float anywhere in scoring, `same_figure` or `compare`.
  - Unknown stays unknown: a null span or date is "no period", nil is `xbrl_unknown`, and an untagged filing is "not tagged".
  - The basis is in every slot, so consolidated and standalone never meet.
  - A figure goes only into files under `data/eval/` and the reports the investor publishes, never onto the console. Console lines carry ids, codes, counts, seconds and versions.
- **The rules' versions** are fixed and recorded in every report and `compare-xbrl.json`: `SPAN_RULE_VERSION = 1`, `COMPARE_RULE_VERSION = 1`, `CONCEPT_CARRY_VERSION = 1`, and phase 4's `SOURCE_RULE_VERSION`, `XBRL_PARSER_VERSION` and `XBRL_MAP_VERSION`.
- **XBRL limits.** `xbrl-read` passes the extractor's defaults: `max_bytes=20971520`, `max_facts=100000`, `deadline_seconds=30.0`.
- **No paid calls.** Every test is offline. `xbrl-pair`, `tags`, `xbrl-read`, `report`, `compare` and `settle` make no model call. Only `live` costs calls. It runs from the main checkout, on the investor's word, with the filing count and the estimate stated first.
- **Held-out.** Development is on `dev`. `--gate` is used once, in Task 15.
- **No database, no Docker.** The live tasks (13 to 15) run from the main checkout, where `data/eval/corpus` exists; this worktree has none.
- **Tests** are `unittest` under `tests/`. Run one file with `uv run --locked python -m unittest discover -s tests -p '<file>' -v`, and all with `uv run --locked python -m unittest discover -s tests -v`. Tests that read real instances or the real corpus are gated on `MAESTER_XBRL_DIR` or on `data/eval/corpus` existing, and skip otherwise.
- **Docs.** `docs/systems/eval.md` is ASD-STE100 Simplified Technical English (the `writing-ste` skill). British spelling ("normalise", "artefact").

## Review Focus

1. **A quarter and its year to date end on the same day.** Q2 FY26 quarter and half year both end 30 Sep 2025. A Gemini half-year figure is never compared with the XBRL quarter fact. "Year to date figures for current period ended 30.09.2025" is the half year by its month, and a header with no span words at all ("Current period ended 30.09.2025") is never placed. Tests: Task 6 `test_a_quarter_and_its_half_year_never_share_a_slot`, Task 10 `test_a_quarter_never_meets_its_half_year`.
2. **A second instance of one slot** (18 refilings, and 5 March filings with two tokens). The slot comes whole from the ranked owner, and each cell the other instance holds differently is listed. Tests: Task 8 `test_the_newer_instance_owns_the_slot`, Task 10 `test_two_instances_of_one_slot`.
3. **Comparative columns.** A Q2 FY26 PDF prints Q2 FY25. Those lines are "outside the instance", not "PDF only", and their gold facts are not XBRL's misses. Tests: Task 8 `test_xbrl_scores_by_concept_span_and_period`, Task 10 `test_cells_by_outcome`.
4. **A lakh-precision XBRL value against a whole-crore PDF figure.**
   - 1,235 crore printed against 12,345,000,000 rupees at `decimals="-6"` agrees at precision.
   - 1,234 crore against the same value disagrees.
   - A negative rounds away from zero.

   Tests: Task 6 `test_same_figure`.
5. **Opening cash in a half-year cash flow.** XBRL's `PY_I` instant takes the column's period end and span (phase 4, Departure 13). The slot keys on `period_end` before `as_of_date`, so it meets Gemini's "Cash at beginning" in the "Half year ended" column. Test: Task 6 `test_balance_sheet_has_no_span_and_opening_cash_keys_on_the_column`.

---

### Task 1: The corpus manifest, and its new fields

**Files:**
- Data: `data/eval/manifest.json` (from `origin/feat/eval-corpus`, its data only)
- Modify: `apps/eval/src/maester_eval/manifest.py`
- Test: `tests/test_eval_manifest.py`

**Interfaces:**
- Produces (`maester_eval.manifest`):
  - `Unit = Literal["lakh", "crore", "thousand", "million", "rupees"]`.
  - `XbrlPair(BaseModel, extra="forbid")`, with these fields:
    - `file: str`: `<company-folder>/xbrl/<name>.xml`, relative to the corpus.
    - `basis: Literal["consolidated", "standalone"]`.
    - `period: str`: BSE's token as the CSV writes it, such as `SQ2025-2026`.
    - `filed: str`: an ISO date.
    - `format: str | None`: the format id from `detect_format` when paired, such as `in-capmkt/ind_as`; null when unreadable.
  - `FormatTags(BaseModel, extra="forbid")`: `unit: Unit | None = None`, `unit_from: Literal["xbrl", "investor"] | None = None`, `negatives_in_brackets: bool | None = None`, `restated_columns: bool | None = None`.
  - `Filing` gains `bse_code: str | None = None` (six digits), `xbrl: list[XbrlPair] = []` and `tags: FormatTags | None = None`. A model validator checks:
    - `xbrl` is non-empty only for `financial_results`;
    - pairs need a `bse_code`;
    - each pair's file is under `<the filing's company folder>/xbrl/`;
    - each pair's `period_end_of_token(period)` equals `period_end`.
  - `Filing.company_folder` (property): `Path(file).parts[0]`.
  - `period_end_of_token(token: str) -> date`. The token is `^(JQ|SQ|SH|DQ|DN|MQ|MH|MC)(\d{4})-(\d{4})$` with the second year one more than the first. JQ gives 30 Jun of the first year; SQ and SH give 30 Sep of the first year; DQ and DN give 31 Dec of the first year; MQ, MH and MC give 31 Mar of the second year. Anything else raises `ValueError`.
  - `tag_values(filing: Filing) -> dict[str, str]`, with keys `unit`, `brackets`, `restated`, `spreads` and `financials`:
    - the unit word, or `not tagged`;
    - `yes`, `no` or `not tagged`;
    - spreads `yes` when `printed_pages_per_page == 2`;
    - financials `yes` when `stratum == "financials"`.
  - `write_manifest(path: Path, manifest: Manifest) -> None`: `{"filings": [f.model_dump(mode="json", exclude_defaults=True) …]}` as `json.dumps(…, indent=2, ensure_ascii=False) + "\n"`, through `write_text_atomically`.

- [ ] **Step 1: Bring the corpus manifest onto the branch** (data only; the code on that branch is older than this one):

```bash
git checkout origin/feat/eval-corpus -- data/eval/manifest.json
uv run --locked python -c "from maester_eval.manifest import load_manifest; from maester_eval.paths import DEFAULT; m = load_manifest(DEFAULT.manifest); print(len(m.filings), len(m.select('dev')), len(m.out_of_scope('dev')))"
```

  Expected: `491 266 28`. Commit it on its own: `git commit -m "data(eval): the corpus manifest from feat/eval-corpus, 491 BSE filings of 50 companies"`.

- [ ] **Step 2: Write the failing tests** in `tests/test_eval_manifest.py`:

```python
Q2 = dict(file="synthetic-cements/results-2025-09.pdf", company="Synthetic Cements Limited", kind="financial_results",
          period_end="2025-09-30", set="dev")
PAIR = dict(file="synthetic-cements/xbrl/a.xml", basis="consolidated", period="SQ2025-2026", filed="2025-10-17", format="in-capmkt/ind_as")

def test_period_tokens(self):
    self.assertEqual([period_end_of_token(t) for t in ("JQ2025-2026", "SQ2025-2026", "SH2025-2026", "DQ2025-2026", "DN2025-2026", "MQ2025-2026", "MH2025-2026", "MC2025-2026")],
                     [date(2025, 6, 30), date(2025, 9, 30), date(2025, 9, 30), date(2025, 12, 31), date(2025, 12, 31), date(2026, 3, 31), date(2026, 3, 31), date(2026, 3, 31)])
    for bad in ("SQ2025-2027", "XQ2025-2026", "SQ25-26", "sq2025-2026"):
        with self.assertRaises(ValueError): period_end_of_token(bad)

def test_a_results_filing_takes_its_code_and_instances(self):
    f = Filing(**Q2, bse_code="500999", xbrl=[XbrlPair(**PAIR)])
    self.assertEqual((f.company_folder, f.xbrl[0].basis), ("synthetic-cements", "consolidated"))

def test_pairs_are_refused_where_they_cannot_belong(self):
    for bad in (dict(Q2, kind="annual_report", file="synthetic-cements/ar-2025-26.pdf", period_end="2026-03-31",
                     bse_code="500999", xbrl=[dict(PAIR, period="MC2025-2026")]),          # annual reports are never paired
                dict(Q2, bse_code="500999", xbrl=[dict(PAIR, period="JQ2025-2026")]),      # ends 30 Jun, the filing 30 Sep
                dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="other-metals/xbrl/a.xml")]),
                dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="synthetic-cements/a.xml")]),
                dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="synthetic-cements/xbrl/a.pdf")]),
                dict(Q2, xbrl=[PAIR]),                                                     # no BSE code
                dict(Q2, bse_code="50099")):
        with self.assertRaises(ValidationError): Filing(**bad)

def test_tag_values(self):
    f = Filing(**Q2, tags=FormatTags(unit="crore", unit_from="xbrl", negatives_in_brackets=True))
    self.assertEqual(tag_values(f), {"unit": "crore", "brackets": "yes", "restated": "not tagged", "spreads": "no", "financials": "no"})
    self.assertEqual(tag_values(Filing(**Q2, stratum="financials", printed_pages_per_page=2))["financials"], "yes")

def test_the_manifest_round_trips_byte_for_byte(self):
    # The committed corpus manifest, and a fixture with every optional field, are written back unchanged.
    for path in (DEFAULT.manifest, self.fixture_with_pairs_and_tags()):
        out = Path(self.tmp) / "m.json"; write_manifest(out, load_manifest(path))
        self.assertEqual(out.read_bytes(), path.read_bytes())
```

- [ ] **Step 3: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_manifest.py' -v`. Expected: FAIL (`ImportError: period_end_of_token`).
- [ ] **Step 4: Implement** the models, the validator, `period_end_of_token`, `tag_values` and `write_manifest`. `period_end_of_token` lowers nothing: the token is upper case.
- [ ] **Step 5: Run to see them pass**, then the whole suite. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/eval/src/maester_eval/manifest.py tests/test_eval_manifest.py
git commit -m "feat(eval): the manifest takes a BSE code, XBRL pairs by period token and the format tags, and is written back byte for byte"
```

---

### Task 2: `maester-eval xbrl-pair`

**Files:**
- Create: `apps/eval/src/maester_eval/xbrl_pair.py`
- Modify: `apps/eval/src/maester_eval/cli.py`
- Test: `tests/test_eval_xbrl_pair.py`

**Interfaces:**
- Consumes: Task 1. Phase 4's `parse_instance` and `detect_format` (only for `XbrlPair.format`).
- Produces:
  - `XbrlRow(bse_code, company, period, basis, filed, file, status)`; `read_xbrl_manifest(path: Path) -> list[XbrlRow]`. It reads UTF-8 with or without a BOM. Missing columns are `XbrlPairError(EvalError)` naming the column.
  - `PairPlan` holds these fields:
    - `codes: dict[str, str]`: company folder to BSE code;
    - `pairs: dict[str, list[XbrlRow]]`: filing id to its rows;
    - `no_code: list[str]`: filing ids;
    - `no_filing: list[XbrlRow]`: rows with no results filing of their period;
    - `none: list[str]`: results filing ids with no row;
    - `skipped: int`: rows whose status is not `exists`.
  - `plan_pairs(manifest: Manifest, rows: list[XbrlRow]) -> PairPlan` is pure. Steps:
    1. A company's code comes from the rows whose `normalise(company)` equals `normalise(filing.company)`. A name with two codes is an `XbrlPairError` naming the company.
    2. A results filing pairs with every `exists` row of its code whose `period_end_of_token(period)` is the filing's `period_end`, in CSV order.
    3. Annual reports get a code and no pairs.
  - `apply_pairs(manifest, plan, source_root: Path, corpus: Path) -> tuple[Manifest, int]`:
    - It copies each row's `source_root / file` to `corpus / <company folder> / "xbrl" / <file name>` and returns the new manifest and the number copied.
    - A destination with the same bytes is skipped. One with other bytes is an `XbrlPairError`: a corpus file is never overwritten.
    - A missing source stops the command before any copy, naming the count and the first three paths.
    - `XbrlPair.format` is `detect_format(parse_instance(...)).id`, or null when the instance is unreadable.
    - It never writes a figure.
  - `maester-eval xbrl-pair --xbrl-manifest <csv> --from <folder> [--dry-run]`. It writes `data/eval/manifest.json` through `write_manifest` after the copies; `--dry-run` copies and writes nothing. It prints counts and ids only:
    - `paired <n> results filing(s) (<d> dev, <h> heldout) with <i> instance(s)`;
    - `<k> refiled: one period token and basis paired twice`;
    - `<m> results filing(s) with none: <ids>`;
    - `<u> instance(s) with no results filing of their period`;
    - `<a> annual report(s) given a BSE code, never paired`;
    - `no BSE code: <ids>`.

- [ ] **Step 1: Write the failing tests.** The fixture is a temporary `data/eval` and a source folder.
  - The manifest holds `synthetic-cements/results-2025-09.pdf` (results, 2025-09-30), `synthetic-cements/ar-2025-26.pdf` (annual report, 2026-03-31) and `other-metals/results-2025-09.pdf` (company "Other Metals", not in the CSV).
  - The CSV has four rows for "Synthetic Cements" (code `500999`), each file a phase 4 `instance(facts=ind_as())` written by the test:
    - `SQ2025-2026` consolidated;
    - `SQ2025-2026` standalone;
    - a second `SQ2025-2026` consolidated (`…_27102025.xml`, same filed date);
    - `MC2025-2026` consolidated.

```python
def test_plan(self):
    plan = plan_pairs(manifest, rows)
    self.assertEqual(plan.codes, {"synthetic-cements": "500999"})
    self.assertEqual([r.basis for r in plan.pairs["synthetic-cements/results-2025-09"]], ["consolidated", "standalone", "consolidated"])
    self.assertEqual(plan.pairs.get("synthetic-cements/ar-2025-26", []), [])      # annual reports are never paired
    self.assertEqual([r.period for r in plan.no_filing], ["MC2025-2026"])         # only an annual report ends 31 Mar 2026
    self.assertEqual((plan.no_code, plan.none), (["other-metals/results-2025-09"], ["other-metals/results-2025-09"]))

def test_a_company_with_two_codes_stops(self):
    with self.assertRaises(XbrlPairError): plan_pairs(manifest, rows + [dataclasses.replace(rows[0], bse_code="500998")])

def test_apply_copies_into_the_corpus_and_writes_the_pairs(self):
    out, copied = apply_pairs(manifest, plan_pairs(manifest, rows), self.source, self.corpus)
    f = out.by_id()["synthetic-cements/results-2025-09"]
    self.assertEqual((f.bse_code, copied, f.xbrl[0].format), ("500999", 3, "in-capmkt/ind_as"))
    self.assertEqual((self.corpus / f.xbrl[0].file).read_bytes(), (self.source / rows[0].file).read_bytes())
    self.assertEqual(out.by_id()["synthetic-cements/ar-2025-26"].bse_code, "500999")

def test_a_corpus_file_is_never_overwritten(self):
    # A different file at a pair's destination stops apply_pairs with XbrlPairError; the same bytes are skipped.

def test_the_command_prints_counts_only_and_dry_run_writes_nothing(self):
    # CliRunner over the fixture with mock.patch.object(cli, "DEFAULT", paths); the output has
    # "paired 1 results filing(s) (1 dev, 0 heldout) with 3 instance(s)", "1 refiled: one period token and basis paired twice",
    # and no company name or file name; --dry-run leaves manifest.json and the corpus unchanged.
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_xbrl_pair.py' -v`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `xbrl_pair.py` and the command.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/xbrl_pair.py apps/eval/src/maester_eval/cli.py tests/test_eval_xbrl_pair.py
git commit -m "feat(eval): xbrl-pair pairs results filings with their instances by BSE code, period and basis, and copies them into the corpus"
```

---

### Task 3: Span from the column header, in the sheet and the gold file

**Files:**
- Create: `apps/eval/src/maester_eval/periods.py`
- Modify: `apps/eval/src/maester_eval/sheets.py`, `apps/eval/src/maester_eval/gold.py`
- Test: `tests/test_eval_periods.py`, `tests/test_eval_sheets.py`, `tests/test_eval_gold.py`

**Interfaces:**
- Produces:
  - `periods.py`: `SPAN_RULE_VERSION = 1`; `Span = Literal["quarter", "half_year", "nine_months", "year", "other"]`; `span_of_label(label: str, period_end: date | str | None = None) -> Span | None`. The label is lower-cased with its spaces collapsed, and the first rule that matches wins:

    | Order | Pattern | Span |
    | --- | --- | --- |
    | 0 | `\bas (at\|on)\b` | null |
    | 1 | `\byear to date\b\|\bytd\b` | by the month of `period_end`: 6 `quarter`, 9 `half_year`, 12 `nine_months`, 3 `year`; any other month, or no date, null (the 1 April financial year) |
    | 2 | `\b(nine\|9) months?\b` | `nine_months` |
    | 3 | `\b(six\|6) months?\b\|\bhalf[- ]?year(ly)?\b` | `half_year` |
    | 4 | `\b(three\|3) months?\b\|\bquarter(ly)?\b\|\bq[1-4]\b` | `quarter` |
    | 5 | `\b(twelve\|12) months?\b\|\byear (ended\|ending)\b\|\bfy\b` | `year` |
    | — | anything else | null |

    The rule never gives `other`; a person may (`gold_span`).
  - `SHEET_COLUMNS` gains `span` after `period_end`, and `gold_span` after `gold_period_end`. `sheet_rows` writes `span_of_label(periodLabel, periodEnd or asOfDate)`, or `""` for a `balance_sheet` fact or a null result.
  - `gold.py`:
    - `_AGREEMENTS["span"] = _same_words`, so `span` is a machine column read back from the artefact like the others.
    - `GoldFact.span: Span | None` is written by `freeze_sheet`: `gold_span` if given, else `span`. It is validated against `Span`. Another word is a `FreezeError`: `sheet row <n>: gold_span <word> is not quarter, half_year, nine_months, year or other`. A span on a `balance_sheet` row is a `FreezeError`: `a balance sheet line has no span`.
    - `GoldFact.origin: Literal["sheet", "settled"] = "sheet"`.

- [ ] **Step 1: Write the failing tests.** `tests/test_eval_periods.py`:

```python
CASES = [
    ("Quarter ended 30.09.2025", "quarter"), ("3 months ended 30/09/2025", "quarter"), ("Three Months Ended September 30, 2025", "quarter"),
    ("Corresponding 3 months ended in the previous year 30.09.2024", "quarter"), ("Preceding quarter ended 30.06.2025", "quarter"),
    ("Half year ended 30.09.2025", "half_year"), ("Six months ended 30.09.2025", "half_year"), ("Half-yearly 30.09.2025", "half_year"),
    ("Nine months ended 31.12.2025", "nine_months"), ("9 months ended 31-Dec-25", "nine_months"),
    ("Year ended 31.03.2026", "year"), ("For the year ended 31 March 2026", "year"), ("Twelve months ended 31.03.2026", "year"),
    ("Previous year ended 31.03.2025", "year"), ("FY 2025-26", "year"), ("Q1 FY 2026-27", "quarter"),
    ("As at 31 March 2026", None), ("Year to date figures for current period ended 30.09.2025", None),   # no date given
    ("31.03.2026 (Audited)", None), ("Current period", None), ("2025-26", None), ("", None),
]

def test_span_of_label(self):
    for label, span in CASES:
        self.assertEqual(span_of_label(label), span, label)

def test_year_to_date_takes_its_span_from_the_month(self):
    ytd = "Year to date figures for current period ended"
    self.assertEqual([span_of_label(f"{ytd} 30.06.2025", "2025-06-30"), span_of_label(f"{ytd} 30.09.2025", "2025-09-30"),
                      span_of_label(f"{ytd} 31.12.2025", "2025-12-31"), span_of_label("Year to date figures for the previous year ended 31.03.2025", "2025-03-31"),
                      span_of_label(f"{ytd} 31.08.2025", "2025-08-31")],
                     ["quarter", "half_year", "nine_months", "year", None])
    self.assertEqual(span_of_label("Half year ended 30.09.2025", "2025-12-31"), "half_year")   # the words win; the month is read for year to date only
```

  `test_eval_sheets.py`:
  - The column-order test lists `span` after `period_end` and `gold_span` after `gold_period_end`.
  - A fact headed "Half year ended 30.09.2025" writes `span` `half_year`.
  - A balance-sheet fact headed the same writes `""`.

  `test_eval_gold.py`:
  - A verified row freezes with `span` from the sheet.
  - `gold_span=year` overrides it.
  - `gold_span=annual` is refused with the message above.
  - A `balance_sheet` row with `gold_span=quarter` is refused.
  - An edited `span` cell with `--run` is refused as "no longer matches the artefact".
  - A gold file written before this task, with no `span` and no `origin` key, still reads: `span` is null and `origin` is `sheet`.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_periods.py' -v`, then the same with `-p 'test_eval_sheets.py'` and `-p 'test_eval_gold.py'`. Expected: FAIL.
- [ ] **Step 3: Implement** `periods.py`, the two columns and the freeze changes.
- [ ] **Step 4: Run to see them pass**, then the whole suite. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{periods.py,sheets.py,gold.py} tests/test_eval_{periods,sheets,gold}.py
git commit -m "feat(eval): span from the column header (rule 1); the sheet's span and gold_span columns, and freeze writes the gold fact's span"
```

---

### Task 4: The format tags: `tags propose`, `tags set`, `tags pick`, `tags coverage`

**Files:**
- Create: `apps/eval/src/maester_eval/tags.py`
- Modify: `apps/eval/src/maester_eval/cli.py` (a `tags` Typer group)
- Test: `tests/test_eval_tags.py`

**Interfaces:**
- Consumes: Task 1. Phase 4's `parse_instance`, `family_of`, `read_identity(...).rounding_word`, `rounding_of(word).exponent` and `MAPPED_FORMATS`.
- Produces:
  - `unit_of_exponent(exponent: int) -> Unit | None`: −7 is crore, −5 lakh, −6 million, −3 thousand and 0 rupees. Anything else, Billions (−9) included, is null.
  - `propose_unit(filing: Filing, corpus: Path) -> tuple[Unit | None, str]`. The second item is the reason: `xbrl`, `instances_disagree`, `no_rounding`, `unreadable` or `no_instance`. The unit is given only when every pair's declared rounding gives the same unit.
  - `REQUIREMENTS`, as data: `(dimension, value, minimum)`:

```python
REQUIREMENTS = (
    ("kind", "annual_report", 4), ("kind", "financial_results", 8), ("spread", "yes", 2),
    ("quarter", "Q1", 1), ("quarter", "Q2", 2), ("quarter", "Q3", 1), ("quarter", "Q4", 1),
    ("token", "SQ", 1), ("token", "SH", 1), ("family", "in-capmkt", 1), ("family", "in-bse-fin", 1),
    ("unit", "crore", 1), ("unit", "lakh", 1), ("unit", "million", 1),
    ("bases", "standalone_only", 1), ("instances", "refiled", 1),
    ("stratum", "large", 2), ("stratum", "mid", 2), ("stratum", "small", 2),
)
```

  - `requirement_keys(filing) -> set[tuple[str, str]]`, built from these fields:
    - `kind`, `stratum`, and `spread yes` when `printed_pages_per_page == 2`;
    - for each pair: `quarter` (JQ is Q1; SQ and SH are Q2; DQ and DN are Q3; MQ, MH and MC are Q4), `token` (the first two letters), and `family` (the format id's part before `/`);
    - `unit` when tagged;
    - `bases standalone_only` when every pair is standalone;
    - `instances refiled` when one `(period, basis)` has two or more pairs. Two tokens for one period end (`MH` with `MQ`) do not count.
  - `eligible(filing) -> bool`: not out of scope, and for results at least one pair with `format in MAPPED_FORMATS`.
  - `pick_gold(filings: list[Filing], count: int, requirements=REQUIREMENTS, include: list[str] = [], exclude: list[str] = []) -> PickResult(picked: list[str], unmet: list[tuple[str, str, int]])`. It is greedy and deterministic:

```python
need = {(d, v): n for d, v, n in requirements}
pool = [f for f in filings if eligible(f) and f.id not in exclude]   # manifest order
picked, per_company = [], Counter()
def gain(f): return sum(1 for key in requirement_keys(f) if need.get(key, 0) > 0)
def take(f):
    picked.append(f); per_company[f.company_folder] += 1
    for key in requirement_keys(f):
        if need.get(key, 0) > 0: need[key] -= 1
for f in [by_id[i] for i in include]: take(f)
while len(picked) < count:
    left = [f for f in pool if f not in picked]
    if not left: break
    take(max(left, key=lambda f: (gain(f), -per_company[f.company_folder], -pool.index(f))))
unmet = [(d, v, n) for (d, v), n in need.items() if n > 0]
```

  - `gold_coverage(filings: list[Filing], gold: dict[str, GoldFiling]) -> dict[str, dict[str, tuple[int, int]]]`: for each tag dimension (`tag_values`) and each value, the number of gold filings and gold facts. A value no gold filing has is `(0, 0)`, so it shows.
  - The commands are these:
    - `maester-eval tags propose [--set all]`. It sets `unit` and `unit_from "xbrl"` on each filing whose `unit_from` is not `investor`, leaving a unit it cannot propose unchanged. It prints `unit from XBRL: <n>`, then `instances disagree: <n> (<ids>)`, `no instance: <n>` and `unreadable: <n>`.
    - `maester-eval tags set <filing-id> [--unit <word>] [--brackets yes|no] [--restated yes|no]`. A unit sets `unit_from "investor"`. With no option it is refused.
    - `maester-eval tags pick [--set dev] [--count 12] [--include <id>]… [--exclude <id>]…`. `--count` must be 10 to 15. It prints each pick with the `dimension=value` pairs it advanced, then `unmet: …` or `every requirement met`. It writes nothing.
    - `maester-eval tags coverage [--set dev]` prints the coverage table for the gold filings of the set.

- [ ] **Step 1: Write the failing tests:**

```python
def test_units_from_exponents(self):
    self.assertEqual([unit_of_exponent(e) for e in (-7, -5, -6, -3, 0, -9)], ["crore", "lakh", "million", "thousand", "rupees", None])

def test_propose_unit_needs_every_instance_to_agree(self):
    # Two pairs, Lakhs and Lakhs: ("lakh", "xbrl"). Lakhs and Crores: (None, "instances_disagree").
    # No pairs: (None, "no_instance"). A DOCTYPE instance: (None, "unreadable").

def test_pick_is_greedy_spread_over_companies_and_in_manifest_order(self):
    # A: results JQ in-capmkt co1; B: results SQ in-bse-fin co2; C: results JQ in-capmkt co1; D: annual report, spread, co3.
    req = (("kind", "financial_results", 2), ("quarter", "Q1", 1), ("quarter", "Q2", 1), ("spread", "yes", 1))
    r = pick_gold([A, B, C, D], 3, requirements=req)
    # A gains 2 (ties with B and C; first in order); then B gains 2 (C only 1); then D gains 1 (C 0).
    self.assertEqual((r.picked, r.unmet), (["a", "b", "d"], []))

def test_include_comes_first_and_unmet_is_reported(self):
    r = pick_gold([A, B, C, D], 1, requirements=req, include=["c"])
    self.assertEqual((r.picked, r.unmet), (["c"], [("kind", "financial_results", 1), ("quarter", "Q2", 1), ("spread", "yes", 1)]))

def test_out_of_scope_and_unmapped_results_are_never_picked(self): ...

def test_coverage_shows_values_with_no_gold(self):
    cov = gold_coverage([A, D], {"a": gold_with_facts(3)})
    self.assertEqual(cov["spreads"], {"no": (1, 3), "yes": (0, 0)})

def test_set_and_propose_never_overwrite_the_investors_unit(self):
    # tags set a --unit crore, then tags propose: a keeps crore with unit_from investor.
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_tags.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `tags.py` and the group (`tags_app = typer.Typer(no_args_is_help=True)`, `app.add_typer(tags_app, name="tags")`).
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{tags.py,cli.py} tests/test_eval_tags.py
git commit -m "feat(eval): format tags: the unit from the declared rounding, the investor's tags, a greedy gold pick and gold coverage by tag"
```

---

### Task 5: XBRL runs: `maester-eval xbrl-read`

**Files:**
- Create: `apps/eval/src/maester_eval/xbrl_read.py`
- Modify: `apps/eval/src/maester_eval/{artefacts.py,paths.py,cli.py}`
- Test: `tests/test_eval_xbrl_read.py`, `tests/test_eval_cli.py`

**Interfaces:**
- Consumes: Task 1. Phase 4: `parse_instance`, `classify_instance`, `read_instance`, `XBRL_PARSER_VERSION`, `XBRL_MAP_VERSION`, `ExtractionError` (`pdf_financial_qa.workflow.errors`), and the fact fields of `XbrlFactData` (phase 4 Task 5).
- Produces:
  - `artefacts.py`:
    - `InstanceRead(BaseModel, extra="forbid")`, with these fields:
      - `file`, `basis`, `period`, `filed` (from the pair) and `sha256`;
      - `format: str | None`, `mapped: bool`, `used: bool`;
      - `reason: str | None`: one of `XBRL_UNREADABLE:<reason code>`, `XBRL_PAIR_COMPANY`, `XBRL_PAIR_PERIOD`, `XBRL_PAIR_BASIS` or `XBRL_FORMAT_UNMAPPED`;
      - `state: str | None`, `facts: int`, `warnings: list[str]` (codes only).
    - `Artefact` gains `source: Literal["pdf", "xbrl"] = "pdf"` and `instances: list[InstanceRead] = []`.
    - `RunRecord` gains `source: Literal["pdf", "xbrl"] | None`, `parser_version: str | None` and `map_version: str | None`.
  - An XBRL artefact holds these values:
    - `pipeline_version` `"xbrl-1"` and `model` `"xbrl-parser-1"`;
    - `prompt_version`: the sorted distinct `"<format id>@<XBRL_MAP_VERSION>"` of the used instances, joined by `"+"`, or `"-"` with none;
    - `bytes` (the sum), `seconds`, `model_calls` all zero and `pages_without_text` `[]`;
    - `result`: `{"state": "complete" | "partial", "facts": [...], "checks": [...], "warnings": [...]}`, where `partial` means any used instance is partial;
    - `error` null.

    Each fact is the `XbrlFact` wire shape plus `instance` (the pair's file). That shape is camelCase: `statement, basis, section, lineOrder, reportedLabel, isSubtotal, componentLabels, periodLabel, periodEnd, asOfDate, reportedText, reportedValue, valueStatus, unitLabel, scaleFactor, currency, normalizedValue, span, periodStart, element, contextId, decimals, nil, concept`.
  - `xbrl_read.py`:
    - `XBRL_LIMITS = {"max_bytes": 20971520, "max_facts": 100000, "deadline_seconds": 30.0}`.
    - `read_filing_xbrl(filing: Filing, corpus: Path) -> Artefact`. For each pair, in order:
      1. Parse. An `ExtractionError` gives `used=False` and `reason=f"XBRL_UNREADABLE:{exc.message}"`.
      2. Classify. A `bse_code`, `period_end` or `basis` that differs from the filing's or the pair's gives `XBRL_PAIR_COMPANY`, `XBRL_PAIR_PERIOD` or `XBRL_PAIR_BASIS`, unused.
      3. Read. `mapped` false gives `XBRL_FORMAT_UNMAPPED`, unused, no facts. Otherwise the instance is used and its facts are added.
    - `run_xbrl(filings, corpus, run_dir, eval_set, log) -> list[Artefact]`. It writes `run.json` with these keys:

      ```json
      {"run", "started_at", "finished_at", "set", "source": "xbrl", "pipeline_version": "xbrl-1",
       "model": "xbrl-parser-1", "parser_version", "map_version", "filings"}
      ```

      It then writes one artefact per filing with pairs through `write_artefact`.
  - `paths.py`: `EvalPaths.resolve_run(name_or_path, source: Literal["pdf", "xbrl"] | None = None)`. With `source`, `latest` is the newest run whose `run.json` `source` is that source; a missing `source` key reads as `pdf`. A named run of the other source is a `RunNotFoundError`, `run <name> is a <source> run`. `EvalPaths.settle` is `base / "settle"`.
  - `cli.py`:
    - `maester-eval xbrl-read [--set dev] [--only <id>]… [--label xbrl] [--gate]` reads every selected filing that has pairs. It prints, per filing, `<id>: <used>/<pairs> instance(s), <facts> fact(s)[, <reason codes>]`, then `done: <n> filing(s) → <run>`.
    - `_gate(eval_set, gate)` refuses `heldout` and `all` without `--gate`: `held-out is read only to decide whether a change lands; pass --gate`.
    - `export` and `freeze --run` refuse an XBRL run: `<run> is an XBRL run; label the PDF run`.

- [ ] **Step 1: Write the failing tests** over a temporary corpus with phase 4 fixture instances:
  - `synthetic-cements/results-2025-09` has four pairs:
    - `a.xml` consolidated Ind AS, used;
    - `b.xml` standalone Ind AS, used;
    - `c.xml` banking (`CET1Ratio` added), `XBRL_FORMAT_UNMAPPED`;
    - `d.xml` with a DOCTYPE, `XBRL_UNREADABLE:DOCTYPE`.
  - A second filing pairs `e.xml`, whose `DateOfEndOfReportingPeriod` is 2025-06-30: `XBRL_PAIR_PERIOD`.

```python
def test_instances_are_read_checked_and_recorded(self):
    a = read_filing_xbrl(self.q2, self.corpus)
    self.assertEqual([(i.file.rsplit("/", 1)[1], i.used, i.reason) for i in a.instances],
                     [("a.xml", True, None), ("b.xml", True, None), ("c.xml", False, "XBRL_FORMAT_UNMAPPED"), ("d.xml", False, "XBRL_UNREADABLE:DOCTYPE")])
    self.assertEqual((a.source, a.pipeline_version, a.model, a.prompt_version), ("xbrl", "xbrl-1", "xbrl-parser-1", "in-capmkt/ind_as@1"))
    rev = next(f for f in a.result["facts"] if f["element"] == "RevenueFromOperations" and f["contextId"] == "OneD" and f["basis"] == "consolidated")
    self.assertEqual((rev["normalizedValue"], rev["span"], rev["concept"], rev["instance"]), ("1234500000", "quarter", "revenue_from_operations", "synthetic-cements/xbrl/a.xml"))

def test_a_pairing_that_does_not_hold_is_not_used(self):
    self.assertEqual(read_filing_xbrl(self.q1_wrong, self.corpus).instances[0].reason, "XBRL_PAIR_PERIOD")

def test_the_run_records_its_versions_and_source(self):
    # run_xbrl writes run.json with source "xbrl", parser_version XBRL_PARSER_VERSION, map_version XBRL_MAP_VERSION.

def test_latest_by_source(self):
    # A pdf run at 09:00 and an xbrl run at 10:00: resolve_run("latest", "pdf") is the first; ("latest", "xbrl") the second;
    # resolve_run("latest") the newest (phase 0 behaviour).

def test_the_console_and_the_artefact_names_hold_no_figure(self):
    # CliRunner xbrl-read --set dev: no "1234500000", "12345" or "SYNTHETIC" in the output.

def test_held_out_needs_the_gate(self):
    # xbrl-read --set heldout exits 1 with the gate message and makes no run folder; with --gate it runs.

def test_an_xbrl_run_cannot_be_exported_or_frozen_from(self): ...
```

  The test writes the revenue line itself, `("RevenueFromOperations", "OneD", "INR", "-3", "1234500000")` in a Lakhs instance, and does not rely on `ind_as()`'s defaults. It also asserts the map's concepts for `RevenueFromOperations`, `OtherIncome` and `Income` (`revenue_from_operations`, `other_income`, `total_income`), so a map that names them otherwise fails here first, not in Tasks 8 to 10.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_xbrl_read.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use phase 4's `to_xbrl_read_result(...)` and `to_wire()` for the facts when it gives the keys above; otherwise map `XbrlFactData`'s fields one for one.
- [ ] **Step 4: Run to see them pass**, then the whole suite (phase 0's `test_eval_cli.py` included). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{xbrl_read.py,artefacts.py,paths.py,cli.py} tests/test_eval_xbrl_read.py tests/test_eval_cli.py
git commit -m "feat(eval): xbrl-read: the paired instances read in-process into an XBRL run, with each instance's use and reason; held-out behind --gate"
```

---

### Task 6: Cells: the slot, and agreement at the coarser precision

**Files:**
- Create: `apps/eval/src/maester_eval/cells.py`
- Modify: `tests/eval_fixtures.py` (`pdf_fact`, `xbrl_fact`, `RESULTS_Q2`)
- Test: `tests/test_eval_cells.py`

**Interfaces:**
- Consumes: Task 3 `span_of_label`. Phase 4 `maester_eval.source_rule.slot_key`, given a slot with the twin's fields `company_id`, `filing_kind`, `statement`, `basis`, `period_end` and `span`.
- Produces:
  - `COMPARE_RULE_VERSION = 1`.
  - `Placed(key: str | None, reason: Literal["no_period", "no_span"] | None)`.
  - The slot functions:
    - `gemini_slot(company_id: str, filing_kind: str, fact: dict) -> Placed`:
      - the date is `fact["periodEnd"] or fact["asOfDate"]`, and a null date gives `no_period`;
      - the span is null for `balance_sheet`, otherwise `span_of_label(fact["periodLabel"], date)`;
      - a null span on another statement gives `no_span`.
    - `xbrl_slot(company_id, filing_kind, fact: dict) -> str | None`: the date is `periodEnd or asOfDate`, and the span is `fact["span"]`, null for `balance_sheet`.
    - `gold_slot(company_id, filing_kind, g: GoldFact) -> Placed`: the date is `g.period_end`; the span is `g.span`, or `span_of_label(g.period_label, g.period_end)` when a gold file predates Task 3, and null for `balance_sheet`.
  - `printed_exponent(reported_value: str | None, scale_factor: str | None) -> int | None`: the power of ten a printed figure is known to, in rupees (or rupees a share). It is the scale's exponent minus the places of `reported_value` as written. A scale that is not a power of ten, or a null, gives null.
  - `xbrl_exponent(decimals: str | None, normalized_value: str) -> int | None`: an integer `d` gives `-d`; `"INF"` gives minus the places of `normalized_value`; null gives null.
  - `same_figure(a: Decimal, a_exp: int | None, b: Decimal, b_exp: int | None) -> Literal["exact", "at_precision", "different"]`:
    - equal values are `exact`;
    - with both exponents known, both values are quantised to `Decimal(f"1E{max(a_exp, b_exp)}")` with `ROUND_HALF_UP` (Python's half away from zero), and equal results are `at_precision`;
    - anything else is `different`.

- [ ] **Step 1: Write the failing tests.** `RESULTS_Q2` is the Task 1 filing with `bse_code="500999"`. `pdf_fact(**kw)` is a Gemini wire fact with these defaults:

  ```python
  dict(statement="income_statement", basis="consolidated", section="Income", lineOrder=1,
       reportedLabel="Revenue from operations", periodLabel="Quarter ended 30.09.2025",
       periodEnd="2025-09-30", asOfDate=None, reportedText="12,345.00", reportedValue="12345.00",
       valueStatus="value", unitLabel="₹ in lakh", scaleFactor="100000",
       normalizedValue="1234500000", pageIndex=1)
  ```

  `xbrl_fact(**kw)` is the same line as an `XbrlFact` dict, plus:

  ```python
  dict(span="quarter", periodStart="2025-07-01", element="RevenueFromOperations", contextId="OneD",
       decimals="-3", nil=False, concept="revenue_from_operations",
       instance="synthetic-cements/xbrl/a.xml", reportedText="1234500000", unitLabel="₹ lakh")
  ```

```python
C, K = "synthetic-cements", "financial_results"

def test_a_quarter_and_its_half_year_never_share_a_slot(self):
    q = gemini_slot(C, K, pdf_fact())
    h = gemini_slot(C, K, pdf_fact(periodLabel="Six months ended 30.09.2025"))
    self.assertNotEqual(q.key, h.key)
    self.assertEqual(q.key, xbrl_slot(C, K, xbrl_fact()))
    self.assertEqual(h.key, xbrl_slot(C, K, xbrl_fact(span="half_year", periodStart="2025-04-01", contextId="FourD")))

def test_a_header_with_no_span_or_no_date_is_not_placed(self):
    self.assertEqual(gemini_slot(C, K, pdf_fact(periodLabel="Current period ended 30.09.2025")), Placed(None, "no_span"))
    ytd = gemini_slot(C, K, pdf_fact(periodLabel="Year to date figures for current period ended 30.09.2025"))
    self.assertEqual(ytd.key, xbrl_slot(C, K, xbrl_fact(span="half_year", periodStart="2025-04-01", contextId="FourD")))
    self.assertEqual(gemini_slot(C, K, pdf_fact(periodEnd=None)), Placed(None, "no_period"))

def test_balance_sheet_has_no_span_and_opening_cash_keys_on_the_column(self):
    bs = gemini_slot(C, K, pdf_fact(statement="balance_sheet", periodLabel="Half year ended 30.09.2025", periodEnd=None, asOfDate="2025-09-30"))
    self.assertEqual(bs.key, xbrl_slot(C, K, xbrl_fact(statement="balance_sheet", span=None, periodEnd=None, asOfDate="2025-09-30")))
    opening = xbrl_fact(statement="cash_flow", span="half_year", periodEnd="2025-09-30", asOfDate="2025-03-31", contextId="PY_I")
    self.assertEqual(xbrl_slot(C, K, opening), gemini_slot(C, K, pdf_fact(statement="cash_flow", periodLabel="Half year ended 30.09.2025")).key)

def test_bases_never_share_a_slot(self):
    self.assertNotEqual(xbrl_slot(C, K, xbrl_fact()), xbrl_slot(C, K, xbrl_fact(basis="standalone")))

def test_exponents(self):
    self.assertEqual(printed_exponent("12345.67", "10000000"), 5)    # crore to two places: known to 10^(7-2) rupees
    self.assertEqual(printed_exponent("1235", "10000000"), 7)
    self.assertEqual(printed_exponent("12.34", "1"), -2)            # a share's rupees to the paisa
    self.assertIsNone(printed_exponent("12.34", "2500")); self.assertIsNone(printed_exponent("12.34", None))
    self.assertEqual((xbrl_exponent("-6", "12345000000"), xbrl_exponent("INF", "12.345"), xbrl_exponent(None, "1")), (6, -3, None))

def test_same_figure(self):
    D = Decimal
    self.assertEqual(same_figure(D("12350000000"), 7, D("12345000000"), 6), "at_precision")    # 1,235 crore; 1,234.5 crore rounds away from zero to 1,235
    self.assertEqual(same_figure(D("12340000000"), 7, D("12345000000"), 6), "different")       # 1,234 crore
    self.assertEqual(same_figure(D("-12350000000"), 7, D("-12345000000"), 6), "at_precision")  # −1,234.5 → −1,235
    self.assertEqual(same_figure(D("1235000"), 3, D("1234567"), 0), "at_precision")           # 12.35 lakh; 12,34,567 → 12,35,000 at 10^3
    self.assertEqual(same_figure(D("123400000"), 5, D("123400000.0"), 5), "exact")
    self.assertEqual(same_figure(D("12350000000"), None, D("12345000000"), 6), "different")    # an unknown precision compares exactly only
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_cells.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement `cells.py`.** There is no float. `Decimal(scale)` is a power of ten when its digits are `1` followed by zeros.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/cells.py tests/eval_fixtures.py tests/test_eval_cells.py
git commit -m "feat(eval): cells keyed by the source rule's slot and a concept; figures agree exactly or at the coarser precision (rule 1)"
```

---

### Task 7: Concepts for Gemini facts, from the sheets

**Files:**
- Create: `apps/eval/src/maester_eval/sheet_concepts.py`
- Test: `tests/test_eval_sheet_concepts.py`

**Interfaces:**
- Consumes: `read_sheet`, `sheet_path`, `normalise`, `load_taxonomy`.
- Produces:
  - `CONCEPT_CARRY_VERSION = 1`.
  - `ConceptPick(concept: str, source: Literal["own", "company"])`.
  - `CompanyConcepts`, with `lookup(filing_id: str, statement: str, section: str, label: str) -> ConceptPick | None`. It looks in two places, in order:
    1. `(statement, normalise(section), normalise(label))`.
    2. `(statement, normalise(label))`, only when that label maps to exactly one concept across the company's sheets.

    A key given two different concepts in the company's sheets maps to nothing. `source` is `own` when a row of `filing_id`'s own sheet gave the key, otherwise `company`.
  - `load_company_concepts(sheets_dir: Path, company_folder: str, taxonomy: Taxonomy) -> CompanyConcepts`. It reads every `sheets_dir/<company_folder>/*.csv`. It keeps the rows whose `concept` is in the taxonomy and whose concept family equals the row's `statement`; `verified` does not matter. Settle sheets are not read.

- [ ] **Step 1: Write the failing tests.** The fixture is two sheets of `synthetic-cements`, `results-2025-09.csv` and `results-2025-06.csv`, and one of `other-metals`.

```python
def test_own_row_then_carried_to_another_filing(self):
    cc = load_company_concepts(self.sheets, "synthetic-cements", load_taxonomy())
    self.assertEqual(cc.lookup("synthetic-cements/results-2025-09", "income_statement", "Income", "Revenue from operations"), ConceptPick("revenue_from_operations", "own"))
    self.assertEqual(cc.lookup("synthetic-cements/results-2025-12", "income_statement", "INCOME", "Revenue from Operations"), ConceptPick("revenue_from_operations", "company"))

def test_a_label_with_two_concepts_maps_to_nothing(self):
    # "Borrowings" under "Non-current liabilities" → non_current_borrowings, under "Current liabilities" → current_borrowings:
    # each section keeps its own; without a section (another section name) it maps to nothing.

def test_the_label_alone_when_it_is_unique(self):
    # "Revenue from operations" under section "Revenue": found through the label alone.

def test_a_concept_of_another_statement_and_another_company_are_never_used(self):
    # A row on income_statement labelled total_assets is ignored; other-metals' rows never reach synthetic-cements.

def test_a_conflict_within_one_key(self):
    # Two sheets give (income_statement, Income, Other income) two concepts: lookup is None.
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_sheet_concepts.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/sheet_concepts.py tests/test_eval_sheet_concepts.py
git commit -m "feat(eval): a Gemini fact's concept from its company's sheets, by section and label (carry rule 1)"
```

---

### Task 8: Scoring by source: XBRL against gold, the `shown` mix and the map's suspects

**Files:**
- Modify: `apps/eval/src/maester_eval/scoring.py`
- Create: `apps/eval/src/maester_eval/owners.py`
- Modify: `tests/eval_fixtures.py` (`gold_fact`, `pdf_artefact`, `xbrl_artefact`)
- Test: `tests/test_eval_scoring_xbrl.py`, `tests/test_eval_scoring.py`

**Interfaces:**
- Consumes: Tasks 5 and 6. Phase 4: `rank_slot_candidates`, with candidates of the twin's fields `revision_id`, `document_id`, `source`, `filing_period_end` and `revision_created_at`; and `plan_pdf_numbers`, with the twin's `PdfNumbersInput` and `XbrlDocInput` fields.
- Produces:
  - `owners.py`: `slot_owners(artefact: Artefact) -> dict[str, str]`, slot key to owner instance file. For each slot, the candidates are the used instances holding facts in it: `revision_id` is the file name, `document_id` the file, `source` `"xbrl"`, `filing_period_end` the filing's and `revision_created_at` the pair's `filed`. `owned_facts(artefact) -> list[dict]` keeps each fact whose instance owns its slot. `differing_cells(artefact) -> list[tuple[str, str, str]]` gives `(slot, element, other instance)` for each cell where a non-owner holds another figure (`same_figure != "exact"`).
  - `scoring.py`:
    - `FactScore` gains `source: Literal["pdf", "xbrl", "shown"] = "pdf"`, `element: str | None = None` and `detail: str | None = None` (`at_precision`, or `map_suspect:<elements, sorted, joined by ",">`).
    - `FilingScore` gains `source` (default `pdf`) and `outside_slots: int = 0`.
    - `RunScore` gains `source` (default `pdf`) and `unusable: dict[str, str] = {}`: filing id to `format_unmapped` or `unreadable`, never scored.
    - `strata()` is unchanged for one source.
    - `compare_xbrl(g: GoldFact, fact: dict) -> tuple[Outcome, str | None]`:
      - a gold dash with an XBRL `0` is `match`;
      - a gold dash with any other value is `wrong_value`;
      - a fact whose `valueStatus` is not `value` (nil) is `wrong_status`;
      - otherwise `same_figure(gold normalised, printed_exponent(g.value, g.scale), fact normalised, xbrl_exponent(...))`: `exact` is `match`, and `at_precision` is `match` with detail `at_precision`;
      - else a `reportedValue` equal to `g.value` (as `Decimal`) is `wrong_scale`;
      - else `wrong_value`.
    - `score_xbrl_filing(artefact: Artefact, gold: GoldFiling) -> FilingScore`:
      - Only gold facts whose `gold_slot` is an owned slot are scored. The rest count in `outside_slots`.
      - No owned fact with the gold concept in the slot is `missing`. Two such facts with different figures are `ambiguous`.
      - For `missing` and `wrong_value`, the slot's owned facts of another concept, or none, whose figure is `exact` or `at_precision` against gold give `detail` `map_suspect:<elements>`.
      - `read_printed` is the XBRL `reportedValue` with its `unitLabel`, `page_match` is null, and `element` is the matched fact's.
    - `score_xbrl_run(run_name, artefacts, gold, manifest_ids, eval_set, record, out_of_scope_ids) -> RunScore`, with `source="xbrl"`. A filing with no used instance goes into `unusable`.
    - `score_shown(pdf: RunScore, xbrl: RunScore, pdf_artefacts, xbrl_artefacts) -> RunScore`, with `source="shown"`. For each filing in both with gold:
      1. Call `plan_pdf_numbers`. `statements_found` is the PDF artefact's `coverage` pairs. Each used instance is an XBRL document with these values:
         - `state` `"settled"` and `company_id` the company folder;
         - `identity` `{bse_code: <the filing's>, cin, nse_symbol, isin: None}`;
         - `period_end` the filing's;
         - `coverage` its facts' `(statement, basis)` pairs.
      2. Only gold facts whose `period_end` is the filing's are scored: the filing's own period. A gold fact takes the `xbrl` FactScore when its `(statement, basis)` is covered (`skip`, or `read` and not in `uncovered`). Otherwise it takes the `pdf` one.
      3. A covered gold fact whose slot XBRL does not own is `missing` with detail `not_in_xbrl`. An example is the quarter column of a BSE Main `SH` filing, whose `OneD` is the half year. The product shows nothing there: a covered slot is never filled from the PDF (§6.3.1).
      4. An annual report takes the PDF's throughout (rule 1).

- [ ] **Step 1: Write the failing tests.** `gold_fact(**kw)` builds a `GoldFact` as `freeze` writes one: by default `concept="revenue_from_operations"`, consolidated, `period_label="Quarter ended 30.09.2025"`, `period_end="2025-09-30"`, `span="quarter"`, `printed="12,345.00"`, `value="12345.00"`, `scale="100000"`, `normalized_value="1234500000.00"` and `page_index=1`. The fixture is `RESULTS_Q2` with three gold facts:
  - G1, revenue, consolidated, quarter, 2025-09-30: `12,345.00` lakh (1234500000).
  - G2, revenue, standalone, quarter, 2025-09-30: `10,000.00` lakh (1000000000).
  - G3, revenue, consolidated, quarter, 2024-09-30, a comparative: 1100000000.

  The XBRL artefact uses `a.xml` (consolidated, revenue 1234500000) and `b.xml` (standalone, revenue 1000000000). The PDF artefact reads G1 and G3 right and G2 as `10,500.00` (1050000000), with coverage `income_statement` for both bases.

```python
def test_xbrl_scores_by_concept_span_and_period(self):
    s = score_xbrl_filing(self.xbrl, self.gold)
    self.assertEqual([(f.basis, f.outcome, f.element) for f in s.facts], [("consolidated", "match", "RevenueFromOperations"), ("standalone", "match", "RevenueFromOperations")])
    self.assertEqual((s.source, s.outside_slots), ("xbrl", 1))      # G3 is a comparative: outside the instances' slots

def test_a_value_on_another_element_marks_the_map_suspect(self):
    # Gold total_income 1250000000; XBRL has no total_income but element "Income" with concept null and 1250000000.
    f = one(score_xbrl_filing(xbrl_artefact(RESULTS_Q2, [xbrl_fact(element="Income", concept=None, normalizedValue="1250000000")]), gold_of(gold_fact(concept="total_income", normalized_value="1250000000"))))
    self.assertEqual((f.outcome, f.detail), ("missing", "map_suspect:Income"))

def test_dash_zero_nil_and_precision(self):
    self.assertEqual(compare_xbrl(gold_fact(printed="-", value_status="dash", value=None, scale=None, normalized_value=None), xbrl_fact(normalizedValue="0", reportedValue="0")), ("match", None))
    self.assertEqual(compare_xbrl(gold_fact(), xbrl_fact(valueStatus="unparsed", nil=True, normalizedValue=None, reportedValue=None)), ("wrong_status", None))
    self.assertEqual(compare_xbrl(gold_fact(printed="1,235", value="1235", scale="10000000", normalized_value="12350000000"),
                                  xbrl_fact(normalizedValue="12345000000", reportedValue="1234.5", decimals="-6")), ("match", "at_precision"))
    self.assertEqual(compare_xbrl(gold_fact(), xbrl_fact(normalizedValue="123450000000", reportedValue="12345.00")), ("wrong_scale", None))

def test_the_newer_instance_owns_the_slot(self):
    # a.xml and b.xml both consolidated, filed 2025-10-17, revenue 1234500000 and 1234600000; gold 1234600000.
    # Owner b.xml (the larger name): match. differing_cells == [(slot of the quarter, "RevenueFromOperations", "synthetic-cements/xbrl/a.xml")].

def test_a_filing_with_no_used_instance_is_listed_not_scored(self):
    # Only c.xml (unmapped): RunScore.unusable == {"synthetic-cements/results-2025-09": "format_unmapped"}, no FilingScore.

def test_shown_takes_xbrl_where_it_covers_and_the_pdf_elsewhere(self):
    # XBRL with a.xml only (consolidated): plan read, uncovered [income_statement/standalone].
    shown = score_shown(self.pdf_score, self.xbrl_score_cons_only, [self.pdf], [self.xbrl_cons_only])
    self.assertEqual([(f.basis, f.outcome, f.source) for f in shown.filings[0].facts], [("consolidated", "match", "xbrl"), ("standalone", "wrong_value", "pdf")])

def test_shown_leaves_out_comparatives_and_reads_an_annual_report_from_the_pdf(self): ...

def test_a_covered_slot_xbrl_does_not_own_is_missing_in_shown(self):
    # XBRL covers income_statement/consolidated with half-year facts only; gold has the consolidated quarter, which the PDF read right:
    # shown is ("missing", "not_in_xbrl"), never the PDF's match.
```

  In `test_eval_scoring.py`, `test_a_pdf_run_is_scored_as_before` covers every phase 0 fixture run:
  - `score.source` is `"pdf"` and `strata()` has exactly the keys `kind`, `scanned`, `basis`, `statement` and `stratum`;
  - `summary().model_dump()` equals the dict the phase 0 tests already assert.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_scoring*.py' -v`. Expected: FAIL in the new file only.
- [ ] **Step 3: Implement** `owners.py` and the scoring changes. The PDF path (`score_filing`, `_compare`, `_candidates`) does not change.
- [ ] **Step 4: Run to see them pass**, then the whole suite. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{owners.py,scoring.py} tests/eval_fixtures.py tests/test_eval_scoring_xbrl.py tests/test_eval_scoring.py
git commit -m "feat(eval): XBRL scored against gold by concept within its own slots; the shown mix through the source rule; map suspects named"
```

---

### Task 9: The report by source, by format tag and for the map

**Files:**
- Modify: `apps/eval/src/maester_eval/report.py`, `apps/eval/src/maester_eval/cli.py`
- Test: `tests/test_eval_report.py`

**Interfaces:**
- Consumes: Tasks 1, 5 and 8.
- Produces:
  - `render_markdown(score, against=None, generated_at=None, out_of_scope_reasons=None, others: list[RunScore] | None = None, others_against: list[RunScore] | None = None, tags: dict[str, dict[str, str]] | None = None) -> str`. With no `others` and no `tags`, its output is the phase 0 report unchanged. Otherwise it adds these sections:
    - `## By source`: `| Source | Filings | Gold facts | Exact match | Missing | Outside the instance |`, one row per score. Then the line `Exact match at the printed precision only: <n> (xbrl)`. Then `Gold facts from settled disagreements: <n>` when not zero.
    - `## By format tag`: one `### <Dimension>` table per tag dimension (Unit, Negatives in brackets, Restated columns, Two-page spreads, Banks and NBFCs), `| Value | Filings | pdf | xbrl | shown |`. A cell is `"<match> of <gold facts> (<rate>)"`, or `—`. A filing counts under every dimension, because the tags are not a partition. Under "Banks and NBFCs", `yes` reads `out of scope (<n> filing(s))`.
    - `## The element map against gold` (with an `xbrl` score):
      - per format id (from the artefacts' instances): gold facts, match, of which at precision, wrong value, wrong scale, wrong status, missing;
      - `### Map suspects`: `| Element | Its concept in the map | The gold concept | Gold facts |`;
      - `### Concepts no element gives`: gold concepts that no entry of the format's map carries (the parsed map file's `elements` list, through `load_map(format)`);
      - `### XBRL not used`: the `unusable` filings and their reasons.
    - `## Against <run>` for each source present in both, with the phase 0 delta rows.
  - `write_report(..., others=None, others_against=None, tags=None)`: `report.json` gains `"sources": {source: {"summary", "strata"}}`, `"format_tags": {...}` and `"map": {...}` when present.
  - `maester-eval report`:
    - `--run <run>` may be given more than once (default `latest`). Each run's source comes from its `run.json`, and two runs of one source are refused: `two pdf runs; name one run per source`. With a `pdf` and an `xbrl` run, `shown` is added.
    - `--against <run>` may also be repeated, one per source.
    - The tags come from the manifest (`tag_values`). The files are written into the first `--run`'s folder.
    - The console adds one line per source: `<source>: <n> gold fact(s), exact match <rate>`.

- [ ] **Step 1: Write the failing tests** with Task 8's fixture scores. The tags are `{"synthetic-cements/results-2025-09": {"unit": "lakh", "brackets": "yes", "restated": "not tagged", "spreads": "no", "financials": "no"}}`.

```python
def test_by_source(self):
    md = render_markdown(self.pdf, others=[self.xbrl, self.shown], tags=self.tags, generated_at=WHEN)
    self.assertIn("| pdf | 1 | 3 | 66.6% | 0.0% | — |", md)        # 2 of 3; 2000 // 3 = 666 tenths
    self.assertIn("| xbrl | 1 | 2 | 100.0% | 0.0% | 1 |", md)
    self.assertIn("| shown | 1 | 2 | 100.0% | 0.0% | — |", md)

def test_by_format_tag(self):
    md = render_markdown(self.pdf, others=[self.xbrl, self.shown], tags=self.tags, generated_at=WHEN)
    self.assertIn("### Unit", md); self.assertIn("| lakh | 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | 2 of 2 (100.0%) |", md)
    self.assertIn("| not tagged | 1 |", md.split("### Restated columns")[1])

def test_the_map_section_names_suspects_by_element(self):
    self.assertIn("| Income | none | total_income | 1 |", render_markdown(self.pdf, others=[self.xbrl_suspect], tags=self.tags, generated_at=WHEN))

def test_a_pdf_only_report_is_unchanged(self):
    self.assertNotIn("## By source", render_markdown(self.pdf, generated_at=WHEN))   # and every phase 0 report test passes as it is

def test_the_command_takes_one_run_per_source(self):
    # report --run <pdf> --run <xbrl> --set dev: report.md in the pdf run's folder; console has "xbrl: 2 gold fact(s), exact match 100.0%"
    # and no figure; two pdf runs exit 1 with "two pdf runs; name one run per source"; --against per source adds "## Against" for each.
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_report.py' -v`. Expected: FAIL in the new tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass**, then the whole suite. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{report.py,cli.py} tests/test_eval_report.py
git commit -m "feat(eval): the report by source and by format tag, the element map against gold, and one run per source"
```

---

### Task 10: `maester-eval compare`: Gemini against XBRL

**Files:**
- Create: `apps/eval/src/maester_eval/compare.py`
- Modify: `apps/eval/src/maester_eval/cli.py`; Create: `data/eval/settle/.gitkeep`
- Test: `tests/test_eval_compare.py`

**Interfaces:**
- Consumes: Tasks 5 to 8 (`gemini_slot`, `xbrl_slot`, `same_figure`, `owned_facts`, `differing_cells` and `CompanyConcepts`), `sheet_rows` and `tag_values`.
- Produces:
  - `CompareOutcome = Literal["agree", "disagree_value", "disagree_scale", "ambiguous", "pdf_unknown", "xbrl_unknown", "pdf_only", "xbrl_only", "unlabelled", "span_unknown", "not_read"]`.
  - `CellCompare(BaseModel)`, with these fields:
    - `slot`, `statement`, `basis`, `span`, `period_end`, `period_label` (the XBRL fact's, else the Gemini fact's) and `concept`;
    - `outcome` and `at_precision: bool`;
    - `concept_from: Literal["own", "company"] | None`;
    - the Gemini side: `pdf_row: int | None` (the fact's 1-based place in the artefact, as the sheet's `row`), `pdf_printed`, `pdf_page: int | None` (from 1), `pdf_unit` and `pdf_normalized`;
    - the XBRL side: `xbrl_element`, `xbrl_value` (its `reportedValue`), `xbrl_unit` and `xbrl_normalized`.
  - `FilingCompare(BaseModel)`, with these fields:
    - `filing_id`, `company`, `set` and `tags: dict[str, str]`;
    - `compared: bool` and `reason: Literal["no_pdf_artefact", "pdf_failed", "no_xbrl_artefact", "no_mapped_instance", "no_concepts"] | None`. `no_concepts` means no Gemini fact of the filing has a concept, so its company has no labelled sheet: the filing is listed, not compared, and never shown as Gemini missing lines;
    - `cells: list[CellCompare]`;
    - `counts: dict[str, int]`: every `CompareOutcome` (counting XBRL cells and compared cells), plus the Gemini facts by what happened to them (`no_period`, `no_span`, `outside_instance`, `no_concept`, `concept_own`, `concept_company`);
    - `instances_differ: list[tuple[str, str, str]]`.
  - `compare_filing(pdf: Artefact, xbrl: Artefact, concepts: CompanyConcepts, tags: dict[str, str]) -> FilingCompare`:
    1. The XBRL cells are the owned facts with a concept, keyed by `(xbrl_slot, concept)`. The owned slots are the universe.
    2. Each Gemini fact is placed first, before its concept is looked up, so a missing concept never reads as a missing line:
       - not placed: it counts in `no_period` or `no_span`, as `gemini_slot` says;
       - placed in a slot that is not owned: `outside_instance`;
       - placed in an owned slot: the slot is read. Then the concept is looked up: none counts in `no_concept`, and one counts in `concept_own` or `concept_company` and makes the fact a candidate for its cell.
    3. An owned slot that no Gemini fact is placed in:
       - every XBRL cell is `span_unknown` when a Gemini fact with `no_span` has the slot's statement, basis and date;
       - otherwise every XBRL cell is `not_read`.
    4. A read slot, for each concept on either side:
       - With both sides, these are checked in order:
         1. two Gemini figures for the cell are `ambiguous`;
         2. a Gemini dash with an XBRL `0` is `agree`;
         3. XBRL nil is `xbrl_unknown`;
         4. a Gemini fact with `valueStatus` not `value`, or a null `normalizedValue`, is `pdf_unknown`;
         5. `same_figure` not `different` is `agree`, with `at_precision` set;
         6. equal `reportedValue`s are `disagree_scale`;
         7. anything else is `disagree_value`.
       - XBRL alone is `unlabelled` when the slot holds a Gemini fact with no concept (that fact may be this line), otherwise `xbrl_only`. Gemini alone, a dash included, is `pdf_only`.
  - `agreement_tenths(counts) -> int | None`: `agree * 1000 // (agree + disagree_value + disagree_scale + ambiguous)`.
  - `CompareRun(BaseModel)`, with these fields:
    - `pdf_run`, `xbrl_run`, `eval_set` and `generated_at`;
    - `versions`: `span_rule`, `compare_rule`, `concept_carry`, `source_rule`, `parser` and `map`;
    - `filings: list[FilingCompare]`.

    `compare_runs(pdf_artefacts, xbrl_artefacts, manifest, sheets_dir, taxonomy, eval_set) -> CompareRun` compares every selected filing that has pairs.
  - `render_compare_markdown(run: CompareRun, against: CompareRun | None) -> str`, with these sections:
    - a header with both runs and every version;
    - `## Summary`: filings compared and not compared, with reasons; the cells by outcome; agreement; of which at precision; the Gemini facts by what happened to them;
    - `## By format tag` (one table per dimension, agreement and the outcome counts);
    - `## By statement`;
    - `## Disagreements`: `| Filing | Statement | Basis | Period | Concept | PDF (page) | XBRL | Outcome |`, every `disagree_*` and `ambiguous` cell;
    - `## Instances that differ`;
    - `## Against <runs>`: the change in agreement and in each count, in percentage points from tenths, as phase 0's `_pp`.
  - `write_compare(run_dir, run, against) -> tuple[Path, Path]` writes `compare-xbrl.md` and `compare-xbrl.json`.
  - `settle_rows(fc: FilingCompare, pdf: Artefact) -> list[dict[str, str]]`: for each `disagree_value` or `disagree_scale` cell, its Gemini fact's `sheet_rows` row with `concept` filled, plus `xbrl_element`, `xbrl_value`, `xbrl_unit`, `xbrl_normalized` and `outcome`. `SETTLE_COLUMNS = SHEET_COLUMNS + ["xbrl_element", "xbrl_value", "xbrl_unit", "xbrl_normalized", "outcome"]`.
  - `maester-eval compare`:
    - Its options are `--run <pdf run, default latest pdf>`, `--xbrl <xbrl run, default latest xbrl>`, `[--set dev]`, `[--gate]`, `[--against <run>]…` (one per source), `[--to docs/eval/<file>.md]` and `[--force]`.
    - It writes both files into the PDF run's folder.
    - For each dev filing with a settle row, it writes `data/eval/settle/<filing-id>.csv` (UTF-8 with a BOM, as `write_sheet`). It never overwrites one without `--force`, and never writes one for a held-out filing.
    - The console gets these lines: `compared <n> filing(s), not compared <m>`, `cells: agree <a>, disagree <d>, PDF only <p>, XBRL only <x>, unlabelled <l>, span unknown <s>, not read <r>`, `agreement <rate>`, `settle sheets: <w> written, <k> kept`.

- [ ] **Step 1: Write the failing tests.** `RESULTS_Q2` uses the PDF artefact below and `xbrl` with `a.xml` (consolidated) and `b.xml` (standalone). Its sheet, `results-2025-09.csv`, labels row 1 only (`Income`, `Revenue from operations`, `revenue_from_operations`, not verified).
  - The PDF facts:
    1. revenue, consolidated, quarter, 2025-09-30: 1234500000;
    2. revenue, standalone, quarter: `10,500.00`, 1050000000;
    3. revenue, consolidated, "Quarter ended 30.09.2024": 1100000000;
    4. "Other income", consolidated, quarter: 23450000.
  - The XBRL facts: `a.xml` has revenue 1234500000 and `OtherIncome` (`other_income`) 23450000; `b.xml` has revenue 1000000000.

```python
def test_cells_by_outcome(self):
    fc = compare_filing(self.pdf, self.xbrl, self.concepts, self.tags)
    # Fact 4 has no concept and sits in other_income's slot, so XBRL's other income is "unlabelled", not "XBRL only".
    # Fact 3 is a comparative: outside the instance, so its concept is never looked up.
    self.assertEqual(nonzero(fc.counts), {"agree": 1, "disagree_value": 1, "unlabelled": 1, "outside_instance": 1, "no_concept": 1, "concept_own": 2})
    self.assertEqual(agreement_tenths(fc.counts), 500)                  # 1 of 2

def test_xbrl_only_needs_every_gemini_line_of_the_slot_labelled(self):
    # The same filing with fact 4 labelled other_expenses: XBRL's other income is xbrl_only and Gemini's other expenses pdf_only.

def test_a_filing_with_no_concepts_is_not_compared(self):
    # No sheet for the company: compared False, reason no_concepts, no cell and no not_read.

def test_a_header_with_no_span_makes_its_slot_span_unknown(self):
    # Gemini "Current period ended 30.09.2025" (no_span); XBRL FourD half-year facts:
    # each XBRL half-year cell is span_unknown, none not_read.

def test_a_quarter_never_meets_its_half_year(self):
    # Gemini: quarter 1234500000 and "Half year ended 30.09.2025" 2469000000; XBRL OneD 1234500000, FourD 2469000000.
    self.assertEqual(sorted((c.span, c.outcome) for c in compare_filing(...).cells), [("half_year", "agree"), ("quarter", "agree")])

def test_two_instances_of_one_slot(self):
    # a.xml and b.xml consolidated, revenue 1234500000 and 1234600000; Gemini 1234600000: agree (owner b.xml),
    # instances_differ has one entry, element RevenueFromOperations, other a.xml.

def test_dash_zero_nil_scale_and_precision(self):
    # Gemini dash vs XBRL "0": agree; Gemini dash, no XBRL: pdf_only; XBRL nil: xbrl_unknown;
    # Gemini "12,345.00" at scale 10000000 vs XBRL 1234500000 (reportedValue "12345.00"): disagree_scale;
    # Gemini "1,235" crore vs XBRL 12345000000 decimals "-6": agree with at_precision True.

def test_a_column_gemini_did_not_read(self):
    # XBRL cash_flow consolidated half_year facts; no Gemini cash-flow fact at all: each is not_read, none xbrl_only.

def test_ambiguous_and_not_compared(self):
    # Two Gemini facts, one cell, two figures: ambiguous. A filing whose instances are all unmapped: compared False, reason no_mapped_instance.

def test_settle_rows(self):
    rows = settle_rows(compare_filing(self.pdf, self.xbrl, self.concepts, self.tags), self.pdf)
    self.assertEqual([(r["row"], r["concept"], r["printed"], r["xbrl_value"], r["xbrl_unit"], r["xbrl_normalized"], r["outcome"]) for r in rows],
                     [("2", "revenue_from_operations", "10,500.00", "10000.00", "₹ lakh", "1000000000", "disagree_value")])

def test_the_command(self):
    # compare --run <pdf> --xbrl <xbrl>: compare-xbrl.md and .json in the pdf run, settle/synthetic-cements/results-2025-09.csv written;
    # a second call keeps it ("1 kept"); the console holds no figure; --set heldout without --gate exits 1; with --gate no settle sheet is written
    # for a held-out filing; --against <earlier xbrl run> adds "## Against".
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_compare.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `compare.py` and the command.
- [ ] **Step 4: Run to see them pass**, then the whole suite. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{compare.py,cli.py} data/eval/settle/.gitkeep tests/test_eval_compare.py
git commit -m "feat(eval): compare: Gemini against XBRL by slot and concept, agreement by format tag, disagreements listed and written as settle sheets"
```

---

### Task 11: `maester-eval settle`: settled cells into gold

**Files:**
- Create: `apps/eval/src/maester_eval/settle.py`
- Modify: `apps/eval/src/maester_eval/{gold.py,cli.py}`
- Test: `tests/test_eval_settle.py`, `tests/test_eval_gold.py`

**Interfaces:**
- Consumes: `read_sheet`, `freeze_sheet`, `read_gold`, `write_gold`, `compare-xbrl.json` (Task 10).
- Produces:
  - `gold.py`: `SettledRecord(BaseModel, extra="forbid")` with `pdf_run`, `xbrl_run`, `map_version`, `compare_rule`, `settled_at` and `facts: int`. `GoldFiling.settled: list[SettledRecord] = []`. `freeze --force` keeps the existing file's `origin == "settled"` facts and its `settled` records. A key in both (`(concept, basis, period_label, dimensions)` or `(concept, basis, span, period_end)`) is a `FreezeError`: `sheet row <n>: gold already has <concept> for <basis> <period_end> from a settled disagreement`.
  - `settle.py`: `SettleError(EvalError)`. `merge_gold(existing: GoldFiling | None, settled: GoldFiling, record: SettledRecord) -> tuple[GoldFiling, int]` returns the merged file and the number of rows skipped:
    - each settled fact gets `origin "settled"`;
    - a key already in gold with the same figure (`Decimal` equal) is skipped;
    - one with another figure is a `SettleError` naming the concept, basis and period end, and nothing is written;
    - with no existing file, the settled facts are the file.
  - `maester-eval settle <filing-id> --run <pdf run>`:
    - It reads `data/eval/settle/<filing-id>.csv`, `freeze_sheet`s its verified rows against the PDF run's artefact, and takes `xbrl_run` and the versions from `<run>/compare-xbrl.json`.
    - It merges and writes the gold file.
    - It prints `settled <n> fact(s) into <path>; <k> already in gold`.
    - It refuses a held-out filing (`held-out gold is sealed`), and a run with no `compare-xbrl.json`.

- [ ] **Step 1: Write the failing tests.** The fixture is Task 10's: its settle sheet has row 2 with `gold_text` `10,000.00` and `verified` `yes`, and the existing gold file holds G1 only.

```python
def test_settled_facts_join_the_gold_file(self):
    gold, skipped = merge_gold(self.existing, freeze_sheet(self.rows, RESULTS_Q2, load_taxonomy(), WHEN, None, self.pdf), self.record)
    self.assertEqual([(f.concept, f.basis, f.normalized_value, f.span, f.origin) for f in gold.facts],
                     [("revenue_from_operations", "consolidated", "1234500000.00", "quarter", "sheet"),
                      ("revenue_from_operations", "standalone", "1000000000.00", "quarter", "settled")])   # format_decimal(10000.00 × 100000)
    self.assertEqual((skipped, gold.settled[0].facts), (0, 1))

def test_a_settled_cell_never_replaces_gold(self):
    # The existing file already has standalone revenue 1050000000: SettleError, the file unchanged.
    # With 1000000000 already: skipped 1, nothing added.

def test_held_out_gold_is_sealed(self): ...
def test_freeze_force_keeps_settled_facts_and_refuses_a_clash(self): ...
def test_the_command_prints_counts_only(self): ...
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_settle.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass**, then the whole suite. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/{settle.py,gold.py,cli.py} tests/test_eval_settle.py tests/test_eval_gold.py
git commit -m "feat(eval): settle: the investor's settled disagreements join the filing's gold file, never replacing a gold fact"
```

---

### Task 12: `live --paired`, and the documentation

**Files:**
- Modify: `apps/eval/src/maester_eval/cli.py` (`live --paired`), `apps/eval/README.md`, `docs/systems/eval.md`, `.claude/skills/financial-figures/SKILL.md`
- Test: `tests/test_eval_cli.py`

**Interfaces:**
- Produces:
  - `live --paired` keeps only the selected filings that have `xbrl` pairs. It prints `paired: <n> of <m>` before the run.
  - The documentation:
    - `README.md`: the new commands in the table, `data/eval/settle/` in the layout, and the held-out gate.
    - `docs/systems/eval.md` (STE), with these changes:
      - "Terms" gains source, XBRL run, instance, pair, slot, cell, concept source, format tag, settle sheet and gate.
      - "Operation" gains one subsection per new command.
      - "How the harness scores a gold fact" gains the XBRL rule and the `shown` rule.
      - "Data" gains the manifest's new fields, the XBRL artefact, `compare-xbrl.json` and the settle sheet.
      - "Procedures" gains "To pair the XBRL files", "To pick the first gold filings", "To compare Gemini with XBRL", "To settle a disagreement" and "To measure a change of the element map".
      - "Limits" gains the concept carry, the span rule with its 1 April financial year, and "results only".
    - `SKILL.md` gains a checklist, "Change the element map":
      1. `xbrl-map --against` (phase 4).
      2. `xbrl-read --set dev`.
      3. `report --run <pdf> --run <new xbrl> --against <old xbrl> --set dev`.
      4. `compare --run <pdf> --xbrl <new> --against <old>`.
      5. Held-out once with `--gate` to land.
      6. No regression in `xbrl` exact match or agreement on held-out.
      7. The reports under `docs/eval/`.

- [ ] **Step 1: Write the failing test.** `live --set dev --paired` with `run_live` patched selects only the filings with pairs, and prints `paired: 1 of 3`.
- [ ] **Step 2: Run it to fail, implement, run it to pass.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_cli.py' -v`.
- [ ] **Step 3: Write the documentation.** `uv run --locked python scripts/check_workspace.py`. Expected: `Workspace OK` (every local Markdown link resolves).
- [ ] **Step 4: Run the whole suite.** `uv run --locked python -m unittest discover -s tests -v`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/eval docs/systems/eval.md .claude/skills/financial-figures/SKILL.md tests/test_eval_cli.py
git commit -m "docs(eval): sources, format tags, compare and settle; live --paired; the element-map checklist"
```

---

### Task 13: Gold v1: the first development filings, with the investor

From the main checkout, after Tasks 1 to 12 are merged. **Step 3 costs Gemini calls: ask first.** Steps marked **You** are the investor's.

- [ ] **Step 1: Pair and tag** (free). Run:

  ```bash
  uv run --locked maester-eval xbrl-pair --xbrl-manifest ~/Personal/maester-filings/xbrl-manifest.csv --from ~/Personal/maester-filings --dry-run
  ```

  Expected, as the survey counted:
  - `paired 390 results filing(s) (233 dev, 157 heldout) with 793 instance(s)`;
  - `18 refiled: one period token and basis paired twice`;
  - `2 results filing(s) with none: nestle-india/results-2026-09, polycab-india/results-2026-09`;
  - `14 instance(s) with no results filing of their period`;
  - `99 annual report(s) given a BSE code, never paired`.

  A different count stops the task: report it. Then run the same command without `--dry-run`, then `uv run --locked maester-eval tags propose`. Expected: every paired filing gets a unit or is listed. A filing whose instances disagree is named.
- [ ] **Step 2: Pick.** Run `uv run --locked maester-eval tags pick --set dev --count 12`. Expected: 12 ids and `every requirement met`. An unmet requirement is met with `--include <id>` of a filing that has it. **You:** approve the list, or swap filings with `--include` and `--exclude`.
- [ ] **Step 3: Read them with Gemini.** First give the investor the count and the estimate. Use phase 0's smoke run calls per filing if it exists. Otherwise about 10 calls for a results filing and more for a long annual report (phase 0 Task 10 Step 4). On their go, run:

  ```bash
  uv run --locked maester-eval live --set dev --only <id> … --label gold-v1
  ```

  Then run `uv run --locked maester-eval export --run latest`.
- [ ] **Step 4: You: label** each sheet as phase 0 Task 10 Step 5 says, and also:
  - check `span`, and put the right one in `gold_span` where it is wrong or blank;
  - run `maester-eval tags set <id> --brackets yes|no --restated yes|no`, and `--unit <word>` for each annual report.
- [ ] **Step 5: Freeze and check the coverage.** Run `uv run --locked maester-eval freeze <id> --run latest` for each pick, then `uv run --locked maester-eval tags coverage --set dev`. Expected: every value of every dimension present in dev has gold, apart from these:
  - `thousand` and `rupees` where no dev filing prints them;
  - "Banks and NBFCs: yes", which is out of scope;
  - a value the investor chose to leave.

  If no pick prints a restated column, swap one (Steps 2 to 5) or record it in the report.
- [ ] **Step 6: Commit**

```bash
git add data/eval/manifest.json data/eval/gold
git commit -m "eval: gold v1, the first 12 development filings chosen to cover the format tags; the manifest's XBRL pairs and tags"
```

---

### Task 14: The development measurement, with the investor

From the main checkout. **Step 3 costs Gemini calls: ask first.**

- [ ] **Step 1: Read the XBRL of the dev set** (free). Run `uv run --locked maester-eval xbrl-read --set dev --label xbrl-map-v1`. Expected:
  - 211 filings;
  - 428 instances used;
  - `larsen-and-toubro/results-2025-03` with 0 used (`XBRL_FORMAT_UNMAPPED`, `IFOtherthan`);
  - no `XBRL_UNREADABLE` (phase 4's `xbrl-map` read every file);
  - no `XBRL_PAIR_*`. A `XBRL_PAIR_*` reason stops the task: the CSV and the instance disagree, so report it.
- [ ] **Step 2: Score gold by source and tag.** Run:

  ```bash
  uv run --locked maester-eval report --run <gold-v1 run> --run <Step 1 xbrl run> --set dev --to docs/eval/$(date -u +%F)-numbers-dev.md
  ```

  Write "What this run says" at the top: the sources' exact match, the tags that do worst, and the map suspects. Check two suspects against the PDF; each one the map got wrong is a phase 4 map fix, made through the checklist of Task 12.
- [ ] **Step 3: Gemini on every paired dev results filing.** First tell the investor two numbers:
  - the count: `--set dev --paired` selects 211 filings, some of which Task 13 has read already;
  - the estimate: Task 13's calls per results filing times the count.

  A sample is the investor's choice. On their go, run:

  ```bash
  uv run --locked maester-eval live --set dev --paired --label paired-dev
  ```

  For a sample, add `--only <id>` for each filing in it.
- [ ] **Step 4: Compare.** Run:

  ```bash
  uv run --locked maester-eval compare --run <paired-dev run> --xbrl latest --set dev --to docs/eval/$(date -u +%F)-gemini-vs-xbrl-dev.md
  ```

  Expected: every filing either compared or listed with its reason. Filings whose company has no labelled sheet show every Gemini fact as `no concept`. **You:** decide open question 1, whether to label one results sheet's `concept` column per company and run `compare` again.
- [ ] **Step 5: You: settle** the disagreements you choose. In `data/eval/settle/<id>.csv`, put what the PDF prints in `gold_text` where Gemini misread, or leave `printed` where Gemini is right. Mark the row `verified` and run `maester-eval settle <id> --run <paired-dev run>`. Then run Step 2 again so the published report counts them.
- [ ] **Step 6: Commit**

```bash
git add docs/eval data/eval/gold data/eval/manifest.json
git commit -m "eval: numbers by source and format tag, and Gemini against XBRL, on the development set"
```

---

### Task 15: The held-out measurement, once, with the investor

From the main checkout, after Task 14 is committed and nothing in the map or the rules is being tuned. Held-out gold is phase 0's sealed set (open question 3). **Step 2 costs Gemini calls: ask first.**

- [ ] **Step 1: XBRL and gold** (free). Run:

  ```bash
  uv run --locked maester-eval xbrl-read --set heldout --gate --label xbrl-map-v1-heldout
  uv run --locked maester-eval report --run <phase 0's held-out run> --run <the held-out xbrl run> --set heldout --to docs/eval/$(date -u +%F)-numbers-heldout.md
  ```

  Expected for the read: 141 filings and 286 instances used.
- [ ] **Step 2: Gemini on the paired held-out filings** (141, less any phase 0 read). Give the count and the estimate. On the investor's go, run:

  ```bash
  uv run --locked maester-eval live --set heldout --paired --label paired-heldout
  uv run --locked maester-eval compare --run latest --xbrl <held-out xbrl run> --set heldout --gate --to docs/eval/$(date -u +%F)-gemini-vs-xbrl-heldout.md
  ```

  No settle sheet is written; held-out disagreements stay in the report.
- [ ] **Step 3: Commit** the two reports. They are the baseline that every later map, prompt or rule change must not regress on held-out.

```bash
git add docs/eval
git commit -m "eval: numbers by source and Gemini against XBRL on the held-out set: the phase 5 baseline"
```

---

## Task order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15.

The dependencies are these:
- Task 1 comes before every other task.
- Task 2 needs phase 4's parser. Task 3 needs nothing new and may run beside Task 2.
- Task 4 needs Tasks 1 and 2.
- Task 5 needs Task 1 and phase 4 Tasks 2 to 6.
- Task 6 needs Task 3 and phase 4 Task 9.
- Task 7 needs nothing new.
- Task 8 needs Tasks 5 and 6.
- Task 9 needs Tasks 1 and 8.
- Task 10 needs Tasks 4 and 6 to 8.
- Task 11 needs Tasks 3 and 10.
- Task 12 documents everything.
- Tasks 13 to 15 are live, in order. Task 13 also needs phase 0 Task 10 Step 1 (the corpus PDFs in the main checkout's `data/eval/corpus`).

## Open questions for the investor

1. **Concepts for Gemini facts.** `compare` takes a Gemini fact's concept from the sheets of its company, carried by section and label (Departure 2). Do you accept that rule? And to cover every dev company, will you fill the `concept` column (not `verified`) of one results sheet per company: 30 dev and 20 held-out? Until the data layer's phase 1 maps Gemini facts by rule, a company with no labelled sheet shows only "no concept".
2. **Gemini cost.** Phase 0 Task 10 Step 4 reads the whole dev set (266 filings in scope), a plan written for 10 to 30 filings. This plan reads:
   - the 12 picks (Task 13);
   - the paired dev results (Task 14, about 200 more);
   - the paired held-out results (Task 15, 141).

   Which of these, or which sample, do you want read?
3. **Held-out gold for the gate.** Phase 0 seals held-out gold "once". With 197 held-out filings, should `tags pick --set heldout --count 10` choose the held-out gold the same way? Picking reads no figure; labelling happens once.
4. **Q4 results against the annual report.** Comparing an annual report with its `MC` instance's full-year facts would measure how far the results format differs. It would inform the open decision without making it. It is not built; say if you want it.
5. **Banks and NBFCs.** They are out of scope in the corpus, and their XBRL formats are unmapped. Should one bank or NBFC results filing be labelled on the common lines (profit, EPS, total assets), so that the tag carries a number?

## Spec gaps found

- §10.2 says "no gold needed" and also "Gemini facts through the gold sheet's concept column"; Departure 2.
- Gemini facts have no span, and `freeze` never writes `GoldFact.span` although the data layer's §9 lists it; Departure 3.
- The data layer's §5.2 span words do not cover SEBI's "Year to date figures for current period ended …" header. It is on 264 of the 379 results PDFs on hand, and 90 of them print no half-year or nine-month words at all. This plan reads its span from the month under the 1 April financial year (Departure 3). A company with another year end would need `gold_span`, and its Gemini cells go unplaced or into another slot.
- The comparative columns of a results PDF are not in its instance, so a naive comparison counts them as Gemini-only; Departure 4.
- The manifest has no BSE code. The code comes from `xbrl-manifest.csv` by company name, and 18 filings pair one token and basis twice (a refiling) while 5 pair two March tokens; Departures 6 and 8.
- No instance on hand declares Thousands or Actual, so those unit rows are empty. Brackets and restated columns have no free reader, so the investor tags them.
- The financials tag cannot produce a number: banks and NBFCs are out of scope, and their formats are unmapped.
- Phase 4 lists "the `xbrl_in_pdf` rows" as a phase 5 input, but `apps/eval` does not read Postgres; see "Not in this phase".
- §4 and §10.1 say `maester-eval` and the corpus manifest are on `feat/eval-baseline` and `feat/eval-corpus`. The harness is on `staging` now; the manifest is still on `feat/eval-corpus` (Task 1 Step 1).
- The done-when names "every corpus filing that has both", held-out included. The brief seals held-out, so held-out is measured once, in Task 15.

## After this plan

- **Every later change** to the element map, the parser, a check, a prompt or the taxonomy is measured with `report` by source and with `compare`, against the Task 14 (dev) and Task 15 (held-out) reports (the checklist in `SKILL.md`).
- **The data layer's phase 1** (concept mapping):
  - its mapping of Gemini facts replaces `sheet_concepts` in `compare`;
  - `compare`'s carried and own matches become its first accuracy measure;
  - the map's `concept_mapping` rows (source `xbrl_rule`) are scored by this phase's map section unchanged.
- **The data layer's phase 4** (results) moves `span_of_label` into the engine as its span rule and fills `financial_fact.span` for PDF facts. `cells.py` then imports it, and `SPAN_RULE_VERSION` becomes that rule's version.
- **Phase 6 (the screen)** needs nothing from this plan. The Task 14 report's disagreement and "instances differ" counts tell its design how often the figure panel's XBRL words for a mismatch will show.
