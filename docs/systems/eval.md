# Maester evaluation harness: system description

This document describes the Python command-line application in `apps/eval`. For the full system, read the [Maester overview](maester.md). For the extraction workflow that the harness runs, read the [Extractor](extractor.md) description. For the design, read [financial data layer](../superpowers/specs/2026-10-15-financial-data-layer-design.md), section 9.

## Terms

| Term | Meaning in this document |
| --- | --- |
| harness | The Python command-line application in `apps/eval`. Its distribution name is `maester-eval`. Its command is `maester-eval`. |
| command | A subcommand of `maester-eval`. The commands are `live`, `xbrl-read`, `export`, `freeze`, `settle`, `report`, `compare`, `xbrl-elements`, `xbrl-pair` and `tags`. The command `tags` has four subcommands: `propose`, `set`, `pick` and `coverage`. |
| engine | The Python package in `packages/financial-engine`. Its import name is `pdf_financial_qa`. |
| workflow | The extraction workflow of the engine. The function `run_extraction` starts it. |
| model | The Gemini model on Vertex AI that the workflow calls. |
| model call | One request from the workflow to the model. The harness counts three kinds: `locate`, `extract` and `correct`. |
| filing | The annual report or the financial results of one company for one period. The corpus keeps it as one PDF. |
| corpus | The folder `data/eval/corpus`. It holds the PDFs of public filings. Git ignores it. |
| manifest | The file `data/eval/manifest.json`. It lists each filing of the corpus with its fields. |
| filing id | The path of the PDF under the corpus, without `.pdf`. For example, `synthetic-cements/ar-2025-26`. |
| set | `dev` or `heldout`. The manifest puts each filing in one set. A company is in one set only. |
| stratum | The size band of a filing: `large`, `mid`, `small` or `financials`. Banks and non-bank finance companies are `financials`. |
| out of scope | The state of a filing that has the field `out_of_scope` in the manifest. A baseline does not include such a filing. |
| run | One folder under `data/eval/runs`. It holds `run.json`, the artefacts and the report of one `live` command or one `xbrl-read` command. |
| baseline | The report of the workflow before any change. Each later report can show the change against an earlier run. |
| artefact | One JSON file in the folder `artefacts` of a run. It holds the result or the error of the workflow for one filing. |
| statement | One financial statement: `balance_sheet`, `income_statement` or `cash_flow`. |
| basis | The scope of a statement: `consolidated`, `standalone` or `unknown`. |
| section | A named group of rows in a statement, for example `Assets`. |
| row | One row of a table. A row of a statement has a label and one printed text for each period. A row of a sheet holds one read fact. |
| label | The words that the filing prints for a row of a statement, for example `Total assets`. |
| period label | The words that the filing prints at the head of a column, for example `As at 31 March 2026`. |
| fact | One value of one row of a statement for one period. |
| check | An arithmetic test that the workflow runs on a statement. The two types are `subtotal` and `balance_identity`. |
| read fact | A fact that the workflow read. The artefact keeps it. |
| printed text | The number of a fact exactly as the filing prints it, for example `(1,234.50)`. A dash is also printed text. |
| page index | The position of a page in the PDF, counted from 0. The artefact and the gold file use it. The sheet counts the PDF pages from 1. |
| printed page | A page with the number that the filing prints on it. One PDF page can hold two printed pages. |
| text layer | The text that the engine can read from a page of the PDF. A scanned page has none. |
| value | The decimal number that the engine reads from the printed text. A dash has no value. |
| scale | The multiplier of the unit of a statement. For example, the scale of crore is `10000000`. |
| normalized value | The value multiplied by the scale. |
| sheet | One CSV file under `data/eval/sheets`. It has one row for each read fact of one artefact. A person corrects it against the PDF. |
| machine column | One of ten sheet columns that `freeze` can read again from the artefact: `statement`, `basis`, `section`, `label`, `period_label`, `period_end`, `span`, `printed`, `scale_factor` and `page`. |
| taxonomy | The file `packages/contracts/concepts.json`. It lists the concepts. |
| concept | An id in the taxonomy, for example `profit_after_tax`. |
| gold file | One JSON file under `data/eval/gold`. It holds the facts of one filing that a person checked against the PDF. |
| gold fact | One fact in a gold file. It has a concept. |
| expected check | A record in a gold file of what a person found by hand: a subtotal adds up (`yes`) or does not add up (`no`). |
| outcome | The result of the comparison of one gold fact with a run: `match`, `match_at_precision`, `match_dash_zero`, `wrong_value`, `wrong_scale`, `wrong_sign`, `wrong_status`, `ambiguous` or `missing`. Only a figure from XBRL gives `match_at_precision`, `match_dash_zero` and `wrong_sign`. |
| exact match | The outcome `match`. The read fact and the gold fact agree in the normalized value (value, sign and scale together), the basis and the period. It has the same meaning for every source. |
| report | The files `report.md` and `report.json` in a run folder. |
| exit code | The number that a command gives to the shell when it stops. 0 means success. |
| span | How long the period of a fact is: `quarter`, `half_year`, `nine_months`, `year` or `other`. A balance sheet fact has no span. |
| source | Who read a figure: `pdf` (the workflow, on the PDF), `xbrl` (the XBRL reader, on the instances) or `shown`. The source `shown` is the figure that the product shows. The report builds it from the other two. A run has the source `pdf` or `xbrl`. |
| XBRL run | A run that `xbrl-read` made. Its `run.json` has the key `source` with the value `xbrl`. It holds one artefact for each filing that has pairs. |
| instance | One XBRL file that BSE filed for a results filing. The corpus keeps it under `<company-folder>/xbrl`. |
| pair | One entry in the field `xbrl` of a filing in the manifest. It names one instance with its basis, its period token, its filed date and its format. |
| element map | A JSON file in the engine. It gives a concept for each XBRL element of one format. |
| rounding | The level of rounding that an instance declares, for example Crores or Lakhs. The reader finds the unit of the instance from it. |
| refiling | One period token and basis that has two pairs in the manifest. BSE received two instances for it. |
| stamp | The digits at the end of the file name of an instance, before `.xml`. BSE writes the day, the month, the year, the hour, the minute and the second in it. |
| slot | One column of one statement of one company: the company, the kind of filing, the statement, the basis, the period end and the span. A balance sheet slot, and a fact with no span, have the span word `instant` in the key of the slot. |
| owner | The one instance that holds the facts of a slot for the harness, when two or more instances have facts in the slot. |
| pooled slot | A slot that has two or more instances and no owner, because the harness cannot put the instances in order. |
| cell | A slot and a concept. `compare` sets one figure from Gemini against one figure from XBRL for each cell. |
| concept source | Where a Gemini fact gets its concept in `compare`: `own` (a concept cell of the sheet of the same filing) or `company` (a concept cell of the sheet of another filing of the same company). |
| cell outcome | The result of the comparison of one cell in `compare`. The list is in the section "How `compare` sets a cell". |
| format tag | One of five words that tell how a filing prints its figures: `unit`, `brackets`, `restated`, `spreads` and `financials`. A tag that nobody set is `not tagged`. |
| settle sheet | One CSV file under `data/eval/settle`. It has the columns of a sheet, and the columns of the XBRL side. `compare` writes it. A person checks it. `settle` reads it. |
| origin | The field of a gold fact that tells where the fact came from: `sheet` (a person labelled it from a sheet) or `settled` (a person settled a disagreement). |
| gate | The option `--gate`. `xbrl-read` and `compare` need it to read the held-out set. |

## Function

The harness measures how well the extraction workflow reads real filings, and how well the XBRL reader reads the XBRL files of the same filings. A person runs it on a local computer, in a terminal. It has these commands:

- `live` reads the filings of a set with the real model and keeps one artefact for each filing. With `--paired`, it reads only the filings that have pairs.
- `xbrl-read` reads the paired instances of the filings and keeps one artefact for each filing in an XBRL run.
- `export` writes one sheet for each artefact of a run.
- `freeze` turns a sheet that a person checked into a gold file.
- `settle` adds the disagreements that a person settled to a gold file.
- `report` compares runs with the gold files and writes the result, by source and by format tag.
- `compare` sets Gemini against XBRL, cell by cell, and writes the disagreements to settle sheets.
- `xbrl-elements` lists the numeric elements that the instances of each format hold.
- `xbrl-pair` pairs each results filing with its instances and copies the instances into the corpus.
- `tags propose`, `tags set`, `tags pick` and `tags coverage` fill, set and count the format tags, and pick the first gold filings.

A person corrects each sheet against the PDF between `export` and `freeze`. The first report is the baseline. Each later report can show the change against an earlier run. The harness has no connection to the API, the worker, the extractor service or the database. It reads files only. Only `live` calls the model.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| Command line | `apps/eval/src/maester_eval/cli.py` | Defines the commands and their options with Typer. Reads `.env` before each command. Shows filing ids, codes, counts and seconds. Shows no label and no value of a fact. |
| Entry point | `apps/eval/src/maester_eval/__main__.py`, `apps/eval/pyproject.toml` | `pyproject.toml` installs the command `maester-eval`. `__main__.py` starts the command line for `python -m maester_eval`. |
| Paths | `apps/eval/src/maester_eval/paths.py` | Gives the folders under `data/eval` and the path of the taxonomy. Makes a run folder. Finds a run from `latest`, a name or a path, and can ask for the source of the run. |
| Manifest | `apps/eval/src/maester_eval/manifest.py` | Reads, checks and writes the manifest. Selects the filings of a set. Lists the filings that are out of scope. Checks the pairs and the format tags of a filing. |
| Taxonomy | `apps/eval/src/maester_eval/concepts.py` | Reads `packages/contracts/concepts.json`. |
| Runner | `apps/eval/src/maester_eval/runner.py` | `live`: builds the Gemini model and runs `run_extraction` with a model that counts its calls. |
| Artefacts | `apps/eval/src/maester_eval/artefacts.py` | Defines the artefact, with the source and the instances of an XBRL run. Writes and reads the artefacts and `run.json`. |
| Sheets | `apps/eval/src/maester_eval/sheets.py` | `export`: writes the sheets. Also writes the settle sheets for `compare`. |
| Gold | `apps/eval/src/maester_eval/gold.py` | `freeze`: reads a sheet and writes a gold file. Reads the gold files. Gives the view of the gold files for one origin. |
| Scorer | `apps/eval/src/maester_eval/scoring.py` | Finds each gold fact among the read facts of a PDF run or an XBRL run, compares the values as exact decimals and counts the outcomes. Builds the source `shown`. |
| Report | `apps/eval/src/maester_eval/report.py` | Writes `report.md` and `report.json`: the figures by source and by format tag, the element map against gold and the settled facts. |
| XBRL pairing | `apps/eval/src/maester_eval/xbrl_pair.py` | `xbrl-pair`: reads `xbrl-manifest.csv`, pairs the instances with the results filings and copies them into the corpus. |
| XBRL reading | `apps/eval/src/maester_eval/xbrl_read.py`, `apps/eval/src/maester_eval/xbrl_limits.py` | `xbrl-read`: reads each instance with the reader of the engine and writes the XBRL run. `xbrl_limits.py` holds the size limits of the parser. |
| XBRL survey | `apps/eval/src/maester_eval/xbrl_survey.py` | `xbrl-elements`: counts the numeric elements of each format. |
| Format tags | `apps/eval/src/maester_eval/tags.py` | `tags`: proposes the unit, sets the tags, picks the first gold filings and counts the gold by tag. |
| Source rule | `apps/eval/src/maester_eval/source_rule.py` | The Python twin of the source rule of `@maester/financial-engine`. Gives the key of a slot, the owner of a slot and the plan for a results PDF. |
| Periods | `apps/eval/src/maester_eval/periods.py` | Reads the span of a column from the words of its head (span rule version 1). |
| Cells | `apps/eval/src/maester_eval/cells.py` | Puts a Gemini fact, a gold fact or an XBRL fact in a slot. Decides if two figures agree (compare rule version 1). |
| Owners | `apps/eval/src/maester_eval/owners.py` | Finds the owner of each slot, reads the stamp of a file name and lists the cells that two instances hold differently (owner rule version 1). |
| Sheet concepts | `apps/eval/src/maester_eval/sheet_concepts.py` | Gives a Gemini fact the concept that a sheet of the same company holds (concept carry rule version 1). |
| Compare | `apps/eval/src/maester_eval/compare.py` | `compare`: sets Gemini against XBRL for each cell. Writes `compare-xbrl.md`, `compare-xbrl.json` and the rows of the settle sheets. |
| Settle | `apps/eval/src/maester_eval/settle.py` | `settle`: adds the settled facts to a gold file. A settled fact never replaces a gold fact. |
| Text helper | `apps/eval/src/maester_eval/text.py` | `normalise`: makes lower case, changes `&` to `and`, removes punctuation and joins spaces. It follows `normalise` in `apps/api/src/financials/stitch.ts`. |
| Engine functions | `packages/financial-engine/src/pdf_financial_qa/workflow/`, `packages/financial-engine/src/pdf_financial_qa/xbrl/` | The harness calls `run_extraction`, `GeminiExtractionModel`, `PdfDocument`, `parse_reported`, `parse_label_date` and `format_decimal`. For XBRL it calls `parse_instance`, `detect_format`, `classify_instance` and `read_instance`. |
| Tests | `tests/test_eval_*.py`, `tests/test_concepts_json.py` | Offline tests. They make no model call. |

## Operation

### The `live` command

Usage: `maester-eval live [--set <set>] [--only <filing id>] [--label <word>] [--paired]`. You can repeat `--only`.

1. The harness loads `.env` and checks `--set`. The default is `dev`. If the value is not `dev`, `heldout` or `all`, the harness stops.
2. It reads the manifest and selects the filings of the set, in the order of the manifest. With `--only`, it selects only the filings that you name.
3. If a name is not in the manifest, or the filing is in another set than `--set`, the harness stops.
4. Without `--only`, it does not select a filing that is out of scope. If the set has such filings, it shows `left out as out of scope: <n>`.
5. With `--only`, the harness reads a named filing also when the filing is out of scope.
6. With `--paired`, it keeps only the selected filings that have pairs. It shows `paired: <n> of <m>`. The number `<m>` is the count of selected filings. The number `<n>` is the count that it keeps. It shows this line before the run starts.
7. If the corpus does not hold a PDF of a filing that it keeps, the harness stops and names the files. If the selection is empty, it stops.
8. It builds the model from `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` and `GEMINI_MODEL`, as the extractor does. If `GOOGLE_CLOUD_PROJECT` has no value, it stops.
9. It reads `EXTRACT_DEADLINE_SECONDS`. If the value is not a number, the harness stops. Thus a wrong value leaves no empty run folder.
10. It makes the run folder in `data/eval/runs`. The name is the UTC start time as `YYYYMMDDTHHMMSSZ`, then `-<label>` if you give `--label`.
11. A label has letters, digits, dots, dashes and underscores only. With any other character the harness stops and makes no folder.
12. The harness shows `run <name>: <n> filing(s), set <set>`. It writes `run.json`.
13. For each filing, in order, it reads the PDF and runs `run_extraction`. It gives the company name of the manifest to the workflow.
14. It shows `<filing id>: reading…` before the workflow starts. After the workflow stops, it shows `<filing id>: <state> in <n>s, <m> model calls`. The state is `complete` or `partial`, or the error code.
15. It writes the artefact before it starts the next filing. If the workflow fails, the artefact holds the error code and no result. The run continues. If the harness cannot write `run.json` or an artefact, it shows `cannot write <path>: <reason>` and stops. The run folder keeps the artefacts that it wrote before.
16. At the end, the harness adds `finished_at` and `model` to `run.json`. It shows `done: <n> read, <m> failed → <run folder>`.

The harness counts the model calls of each kind, and the artefact stores the counts. `locate` finds the pages of the statements. It makes one call for each part of 30 pages if the PDF has more than 60 pages or more than 15 MiB. `extract` reads one statement of one basis. `correct` reads a section again after a failed check.

The workflow limits the work for each filing. If a filing needs more than 40 model calls, the workflow stops with the error `MODEL_CALL_BUDGET_EXCEEDED`. If the time since the start is more than `EXTRACT_DEADLINE_SECONDS`, the workflow stops with the error `DEADLINE_EXCEEDED`.

### The `xbrl-pair` command

Usage: `maester-eval xbrl-pair --xbrl-manifest <csv> --from <folder> [--dry-run]`.

1. The harness reads the manifest and the file `xbrl-manifest.csv`. The file must have the columns `bse_code`, `company`, `period`, `basis`, `filed`, `file` and `status`. If a column is not there, the harness stops and names it.
2. A row with the status `exists` must follow these rules. If a row breaks a rule, the harness stops and names the line and the column.
   - `bse_code` has six digits.
   - `company` has text.
   - `period` is a period token.
   - `basis` is `consolidated` or `standalone`.
   - `filed` is a date written `YYYY-MM-DD`.
   - `file` ends in `.xml` and stays in the folder.
3. The harness leaves out the rows that have another status, and counts them.
4. It matches the company name of each filing to a company name of the file, after `normalise`. If one company or one corpus folder has more than one BSE code, the harness stops.
5. For each results filing, it takes the rows of its BSE code whose period token ends on the period end of the filing. It keeps the order of the file.
6. The harness does not choose a basis. A refiling, that is one period token and basis that the file lists twice, stays as two pairs.
7. It does not pair an annual report. It gives an annual report the BSE code only.
8. It checks each source file and each destination `<company-folder>/xbrl/<file name>` in the corpus. If a source file is not there, the harness stops. If a destination holds other bytes, the harness stops. The harness never overwrites a corpus file. It stops before it copies the first file.
9. With `--dry-run`, it writes nothing. It shows the counts and `dry run: <n> instance(s) would be copied; nothing written`.
10. Without `--dry-run`, it copies each instance that the corpus does not hold. It reads the format of each instance and writes the manifest with the fields `bse_code` and `xbrl`. It shows `copied <n> instance(s) into the corpus; manifest written`.
11. Before this last line, it shows these lines:
    - `paired <n> results filing(s) (<a> dev, <b> heldout) with <k> instance(s)`.
    - `<n> refiled: one period token and basis paired twice`.
    - `<n> results filing(s) with none` and the filing ids.
    - `<n> instance(s) with no results filing of their period`.
    - `<n> annual report(s) given a BSE code, never paired`.
    - `no BSE code:` and the filing ids, or `none`.
    - `<n> row(s) not marked exists, left out`, if there are such rows.

The harness reads an instance for its format only. It writes no figure.

### The `xbrl-read` command

Usage: `maester-eval xbrl-read [--set <set>] [--only <filing id>] [--label <word>] [--gate]`. You can repeat `--only`. The command makes no model call.

1. The harness loads `.env` and checks `--set`. The default is `dev`. If the set is `heldout` or `all` and you did not give `--gate`, the harness stops with `held-out is read only to decide whether a change lands; pass --gate`.
2. It selects the filings as `live` does, and keeps those that have pairs. If no filing is left, it stops with `nothing to read: no selected filing has XBRL instances`.
3. If the corpus does not hold an instance of a kept filing, the harness stops and names the files. It makes no run folder.
4. It makes the run folder. The default label is `xbrl`. It writes `run.json` with the source `xbrl`, the pipeline version `xbrl-1`, the model `xbrl-parser-1`, `parser_version`, `map_version` and the filing ids.
5. For each filing, in order, it reads each instance with `parse_instance`. It gives the limits of the constant `XBRL_LIMITS`: 20971520 bytes, 100000 facts and 30 seconds.
6. It uses an instance only if all these conditions are true:
   - The instance can be read.
   - The BSE code that the instance states is the BSE code of the filing.
   - The period end that the instance states is the period end of the filing.
   - The basis that the instance states is the basis of the pair.
   - The format of the instance has an element map.
7. For an instance that it uses, the harness runs `classify_instance` and `read_instance`. It keeps the facts, the checks and the warnings, and tags each fact with the file of the instance.
8. For an instance that it does not use, the harness keeps the reason as a code. The codes are `XBRL_UNREADABLE:<reason code>`, `XBRL_PAIR_COMPANY`, `XBRL_PAIR_PERIOD`, `XBRL_PAIR_BASIS` and `XBRL_FORMAT_UNMAPPED`.
9. It writes the artefact of the filing before it reads the next filing. It shows `<filing id>: <used>/<pairs> instance(s), <facts> fact(s)`, then the reason codes.
10. At the end, it adds `finished_at` to `run.json`. It shows `done: <n> filing(s) → <run folder>`.

A filing that has no pair has no artefact in the XBRL run. The harness never shows a figure of an instance.

### The `xbrl-elements` command

Usage: `maester-eval xbrl-elements --instances <folder> --out <folder>`.

1. The harness reads each `.xml` file under `--instances` with the parser. If `--instances` is not a folder, or holds no `.xml` file, the harness stops.
2. It finds the format of each instance. It counts the instances for each format, the instances that have no known format, and the instances that it cannot read. It counts the unreadable instances by reason code.
3. For each format, it counts the numeric elements that have a fact in a context without a dimension. For each element it counts the instances and the contexts.
4. It writes `elements-<format id>.csv` in `--out` for each format. The `/` of the format id becomes `-`. The columns are `element`, `files`, `contexts` and `statement_guess`. The value of `statement_guess` is `balance_sheet` if every fact of the element is in an instant context, or else `duration`.
5. It shows `<format id>: <n>` for each format, `no format: <n>`, `unreadable: <n>` with a line for each reason, `wrote <path>` for each file, and `<n> file(s) read`.

The files hold element names and counts. They hold no value.

### The `tags` command

The command `tags` has four subcommands. A tag that nobody set is `not tagged`. It is never `no`.

**`tags propose`**. Usage: `maester-eval tags propose [--set <set>]`. The default set is `all`.

1. The harness selects the results filings of the set that are in scope.
2. It skips a filing whose unit the investor set (`unit_from` is `investor`).
3. For each other filing, it reads the declared rounding of each instance. If every instance names the same unit, it sets `unit` and sets `unit_from` to `xbrl`. The units are `crore`, `lakh`, `million`, `thousand` and `rupees`.
4. Otherwise the filing keeps its unit. The harness counts the filing as `instances disagree`, `no rounding` (no rounding word, an unknown word, or a rounding with no unit), `no instance` or `unreadable`.
5. If the manifest changed, the harness writes it. It shows `unit from XBRL: <n>`, `instances disagree: <n> (<filing ids>)`, `no rounding: <n> (<filing ids>)`, `no instance: <n>` and `unreadable: <n>`.

**`tags set`**. Usage: `maester-eval tags set <filing id> [--unit <unit>] [--brackets <yes|no>] [--restated <yes|no>]`.

1. If you give none of the three options, the harness stops with `nothing to set: give --unit, --brackets or --restated`.
2. The unit is `crore`, `lakh`, `million`, `thousand` or `rupees`. The other two options take `yes` or `no`.
3. A unit that you set gets `unit_from` with the value `investor`. `tags propose` never changes it.
4. The harness writes the manifest. It shows `<filing id>:` and each tag that has a value.

**`tags pick`**. Usage: `maester-eval tags pick [--set <set>] [--count <n>] [--include <filing id>] [--exclude <filing id>]`. You can repeat `--include` and `--exclude`. The command writes nothing.

1. The set is `dev` or `heldout`. The default is `dev`. The value `all` stops the command, because a pick over both sets would mix them.
2. The count is a whole number from 10 to 15. The default is 12.
3. A filing can be picked if it is not out of scope. A results filing must also have a pair whose format has an element map.
4. The harness takes the filings of `--include` first. It stops if one is not in the set, is also in `--exclude`, cannot be picked, or if there are more of them than `--count`.
5. Then it takes, one at a time, the filing that advances the most unmet requirements. If two filings tie, it takes the filing of the company that has fewer picks. If the tie stays, it takes the earlier filing of the manifest.
6. It shows `<n>. <filing id>` and the requirements that the pick advanced, as `<dimension>=<value>`.
7. At the end, it shows `unmet:` with each requirement and its shortage, or `every requirement met`.

**`tags coverage`**. Usage: `maester-eval tags coverage [--set <set>]`. The set is `dev` or `heldout`, and the default is `dev`. The command counts and scores nothing.

1. The harness reads the filings of the set and the gold facts of origin `sheet`.
2. For each tag dimension and each value that a filing of the set has, it shows `<dimension> <value>: <n> gold filing(s), <m> gold fact(s)`. The dimensions are `unit`, `brackets`, `restated`, `spreads` and `financials`.
3. For `unit`, `brackets` and `restated`, it shows `gold filings not tagged: <name> <n> (<filing ids>)` if a gold filing has no such tag.
4. It checks the unit tag of each gold filing against the scales of its monetary gold facts. The answer is `agree`, `disagree`, `mixed` (more than one scale), `no monetary gold` or `not tagged`.
5. It shows `unit tag against gold:` with the count of each answer, and the filing ids of `disagree` and `mixed`.

### The `export` command

Usage: `maester-eval export [--run <run>] [--only <filing id>] [--force]`. You can repeat `--only`.

1. The harness finds the run. The default is `latest`. If the run is an XBRL run, it stops with `<run> is an XBRL run; label the PDF run`. It reads the artefacts of the run, in the order of the filing ids.
2. If the run has no artefact, the harness stops. If `--only` names a filing that the run does not hold, it stops before it writes a sheet.
3. For each artefact, it writes `data/eval/sheets/<filing id>.csv`. With `--only`, it writes the sheets of the named filings only. If it cannot write a sheet, it shows `cannot write <path>: <reason>` and stops. The sheets that it wrote before stay.
4. A sheet has one row for each read fact, in the order of the artefact. A filing that failed gets one row with `extraction failed: <code>` in `note`.
5. If the sheet exists, the harness keeps it. It shows `kept  <path> (exists; --force to overwrite)`. With `--force`, it replaces the sheet.
6. For each new sheet, it shows `wrote <path>`. At the end, it shows `<n> written, <m> kept`.

The harness puts `yes` in `material` for some rows. It does this if the label has one of these words: total, revenue, profit, loss, earnings per, cash, borrowings, finance costs or dividend. This is a hint. It shows a person where to start. A person checks every row that the person keeps.

### The `freeze` command

Usage: `maester-eval freeze <filing id> [--run <run>] [--force]`.

1. The harness reads the manifest. If the manifest has no entry for the filing id, the harness stops.
2. If the sheet `data/eval/sheets/<filing id>.csv` does not exist, it stops.
3. With `--run`, it finds the run and reads `run.json` and the artefact of the filing. If the run is an XBRL run, it stops with `<run> is an XBRL run; label the PDF run`. If `run.json` or the artefact does not exist, it stops.
4. It reads the sheet as UTF-8 text. It stops if the text is not UTF-8, or if the header has no `verified` column.
5. It keeps the rows that have `yes` in `verified`. Capital letters do not matter. It counts the other rows that have text in them.
6. With `--run`, a kept row that has a `row` number takes its machine columns from the read fact with that number in the artefact.
7. A cell that a person changed must still agree with the artefact. The harness compares text after `normalise` and numbers as numbers.
8. It always compares `label`. It does not compare an empty cell in another column. It does not compare `printed` if `gold_text` has text. If a cell disagrees, the harness stops and names the sheet row.
9. A kept row without a `row` number is a row that a person added. The harness uses its cells as they are. Without `--run`, it uses the cells of every kept row as they are.
10. The harness checks each kept row against these rules:
    - The `concept` is in the taxonomy. The `adds_up` cell is empty, `yes` or `no`.
    - The `statement`, `basis`, `label` and `period_label` cells have text. The statement is `balance_sheet`, `income_statement` or `cash_flow`. The basis is `consolidated`, `standalone` or `unknown`.
    - The printed text is `gold_text` if it has text, or else `printed`. `parse_reported` must read it. A dash stays a dash.
    - The scale is `1` for a concept of the kind `per_share` or `count`. For another concept it is `gold_scale`, or else `scale_factor`. It is a whole number from 1 that does not start with a zero. A dash has no scale.
    - The page is `gold_page`, or else `page`. It is a whole number of 1 or more. The gold fact keeps it as a page index, counted from 0.
    - The period end is `gold_period_end`, or else `period_end`. It is empty or a real date in the form `YYYY-MM-DD`.
    - The span is `gold_span`, or else `span`. It is empty or one of `quarter`, `half_year`, `nine_months`, `year` and `other`. A balance sheet row has no span. A row of a `financial_results` filing that is not on the balance sheet needs one. A quarter and its year to date end on the same day.
11. If two kept rows have the same concept, basis and period label, the harness stops and names both sheet rows.
12. If no row has `yes` in `verified`, the harness stops and writes nothing.
13. It writes `data/eval/gold/<filing id>.json`. If the file exists, it stops. With `--force`, it replaces the file. If it cannot write the file, it shows `cannot write <path>: <reason>` and stops. A gold file that exists stays as it was.
14. With `--force`, the harness reads the gold file that exists before it replaces the file. The gold facts of origin `settled` and the settled records stay in the new file, after the facts of the sheet.
15. With `--force`, if a verified row is the same cell as a settled gold fact, the harness stops and names the sheet row. A sheet never writes over a settled cell.
16. With `--force`, if the gold file that exists cannot be read, the harness stops with `GoldError` and the message `<path> is not a readable gold file`. It writes nothing. To start again, delete the gold file.
17. It shows `froze <n> fact(s), <m> expected check(s); <k> row(s) not verified → <path>`. Each fact that it writes has the origin `sheet`.

A sheet row number is the row number in a spreadsheet application. The header is row 1.

A kept row with `yes` or `no` in `adds_up` gives one expected check in the gold file.

### The `settle` command

Usage: `maester-eval settle <filing id> [--run <run>]`.

1. The harness reads the manifest. If the filing id is not in the manifest, it stops. If the filing is in the held-out set, it stops with `held-out gold is sealed`.
2. It finds the PDF run. The default is `latest`, the latest PDF run. The run folder must hold a readable `compare-xbrl.json`. If not, the harness stops and tells you to run `compare`.
3. It reads the name of the XBRL run and the versions from `compare-xbrl.json`.
4. It reads the settle sheet `data/eval/settle/<filing id>.csv` and the artefact of the filing in the PDF run. If one of them does not exist, it stops.
5. It freezes the rows that have `yes` in `verified`, with the rules of `freeze`. It reads the machine columns again from the artefact. Each kept row needs a concept. `compare` filled it.
6. For each frozen fact, the harness looks for the same cell in the gold file. Two facts are the same cell in one of two cases:
   - The concept, the basis and the period label are the same.
   - The concept, the basis, the span and the period end are the same.
7. If the gold file holds the cell with the same figure, the harness skips the fact and counts it. A dash is the same as a dash only.
8. If the gold file holds the cell with another figure, the harness stops with `gold already has <concept> for <basis> <period end> with another figure; nothing was written`. It writes nothing.
9. Otherwise it adds the fact with the origin `settled`.
10. It writes the gold file. A settled fact never replaces a gold fact. The facts, the expected checks and the frozen record of a gold file that exists stay. The harness adds a record to the list `settled` of the file. If it adds no fact, the gold file stays as it was.
11. If the filing has no gold file, the settled facts are the new gold file. It has no expected check.
12. It shows `settled <n> fact(s) into <path>; <k> already in gold`.

### The `report` command

Usage: `maester-eval report [--run <run>] [--set <set>] [--against <run>] [--to <path>]`. You can repeat `--run` and `--against`. Give one run for each source.

1. The harness loads `.env` and checks `--set`. The default is `all`.
2. It reads the manifest and finds each run in `--run`. The default is `latest`, the latest PDF run. It reads `run.json` of each run. If the manifest, a run or `run.json` does not exist, it stops and writes nothing.
3. The source of a run is the key `source` of its `run.json`. A run with no such key is a PDF run. To score an XBRL run, give it in a second `--run`.
4. If two runs have one source, the harness stops with `two <source> runs; name one run per source`. If no run is a PDF run, it stops with `name a pdf run: the report is made on the PDF run`. The report goes into the folder of the first run.
5. It reads the artefacts and the gold files. It makes two views of the gold: the facts of origin `sheet` and the facts of origin `settled`.
6. It scores the PDF run on the view `sheet`. See "How the harness scores a gold fact". A filing with settled facts only has gold, so the harness does not list it under "No gold yet".
7. With an XBRL run, it also scores the XBRL run on the view `sheet`. It builds the source `shown` from the PDF run and the XBRL run. The harness does not score a filing of an XBRL run that has no used instance. It lists the filing as not used.
8. The harness lists a filing under "Not run" if all of these are true:
   - The filing is in the set, it has a gold file and the manifest lists it.
   - The filing is not out of scope.
   - The run has no artefact for the filing.
9. It lists a filing under "No gold yet" if the run has its artefact but no gold file exists. It does not score the filings in these two lists.
10. The harness lists each filing of the set that is out of scope, with the reason of the manifest. It never counts such a filing as not run. If the run read one anyway, and it has a gold file, the harness scores it.
11. With `--against`, it reads and scores each earlier run in the same way. It uses the gold files as they are now. It does this before it writes anything.
12. An earlier run must have a source for which `--run` gave a run. If not, the harness stops with `<run> is <source>, but no <source> run is scored; add --run for it`.
13. If a gold file of the set holds facts of origin `settled`, the harness scores each run on the view `settled`. It scores these facts apart from every rate in the report.
14. It reads the format tags of every filing of the set. It checks the unit tag of each gold filing against the scales of its gold facts.
15. It writes `report.md` and `report.json` in the folder of the first run. It replaces the files of an earlier report. If it cannot write a file, it shows `cannot write <path>: <reason>` and stops.
16. It shows `<run> (<set>): <n> filing(s), <m> gold fact(s), exact match <rate>, missing <rate>`.
17. With an XBRL run, it shows `<source>: <n> gold fact(s), exact match <rate>` for `pdf`, `xbrl` and `shown`.
18. If the gold holds settled facts, it shows `settled: <n> gold fact(s), scored apart`.
19. If there are filings not run or with no gold yet, it shows `not run: <n>; no gold yet: <m>`. If there are filings out of scope, it shows `out of scope: <n>`. Then it shows `report → <path>`.
20. With `--to`, it copies `report.md` to the path and makes the folders of the path. It shows `published → <path>`.
21. If the copy fails, it shows `cannot write <path>: <reason>` and stops. The report is already written.

A report of one PDF run, with no settled facts in the gold, is the report of phase 0. It has no section for the source, the tag or the element map.

### The `compare` command

Usage: `maester-eval compare [--run <run>] [--xbrl <run>] [--set <set>] [--gate] [--against <run>] [--to <path>] [--force]`. You can repeat `--against`.

1. The harness checks `--set`. The default is `dev`. If the set is `heldout` or `all` and you did not give `--gate`, it stops with `held-out is read only to decide whether a change lands; pass --gate`.
2. It finds the PDF run in `--run` and the XBRL run in `--xbrl`. The default of each is `latest`, the latest run of that source.
3. With `--against`, it reads each earlier run, in place of the run of its source. It compares the earlier runs on the sheets as they are now, before it writes anything.
4. It takes each selected filing of the set that has pairs. It compares the filing, or it lists the filing with a reason. The reasons are in the table "How `compare` leaves a filing out" in the section "States and errors".
5. For each compared filing, it places each Gemini fact in a slot. See "How `compare` sets a cell".
6. It writes `compare-xbrl.md` and `compare-xbrl.json` in the folder of the PDF run.
7. For each dev filing that has a cell with the outcome `disagree_value`, `disagree_scale` or `disagree_status` and a Gemini fact, it writes a settle sheet `data/eval/settle/<filing id>.csv`. The settle sheet has one row for each such cell.
8. If the settle sheet exists, the harness keeps it, because it is the work of a person. With `--force`, it replaces the sheet. A held-out filing never gets a settle sheet.
9. It shows these lines:
   - `compared <n> filing(s), not compared <m>`.
   - `cells:` and the count of each group of outcomes.
   - `agreement <rate>, exact <rate>`.
   - `settle sheets: <n> written, <m> kept`.
   - `compare → <path>`.
10. With `--to`, it copies `compare-xbrl.md` to the path and shows `published → <path>`.

### How `compare` sets a cell

A cell is a slot and a concept. The instances of the filing give the slots. Each Gemini fact goes through these steps in this order:

1. The harness places the fact in a slot. If the fact has no date, it counts the fact as `no_period`. If the fact is not on the balance sheet and its column head gives no span, it counts the fact as `no_span`. It never compares such a fact.
2. If no used instance holds the slot, the harness counts the fact as `outside_instance`. A comparative column of the PDF is such a case. It is never a line that XBRL lacks.
3. If an instance holds the slot, the harness looks for the concept of the fact. It reads the concept from the sheets of the same company, by the carry rule. If there is none, it counts the fact as `no_concept`.
4. A concept from the sheet of the same filing counts as `concept_own`. A concept from another sheet counts as `concept_company`.

XBRL facts take their concept from the element map. The harness sets the Gemini figure against the XBRL figure for each cell, and gives the cell one outcome:

| Cell outcome | Meaning |
| --- | --- |
| `agree` | The normalized values are equal. |
| `agree_at_precision` | The values are equal after both are rounded half away from zero to the coarser of the two precisions. |
| `agree_dash_zero` | Gemini read a dash and XBRL holds `0`. A filer tags a printed dash as `0`. |
| `disagree_value` | The figures differ. |
| `disagree_scale` | The printed values are equal, but the normalized values differ. |
| `disagree_status` | Gemini read a dash and XBRL holds another figure, or Gemini read a figure and XBRL holds `0`. |
| `disagree_sign` | The figures are equal in size and opposite in sign. This is a convention of the element, not a misread. |
| `ambiguous` | Gemini or XBRL holds two different figures for the cell. The harness never picks one. |
| `instances_differ` | The slot is pooled, the instances hold the cell with different figures, and Gemini has a fact for the cell. |
| `pdf_unknown` | XBRL holds a figure. The Gemini fact is neither a figure nor a dash. |
| `xbrl_unknown` | The XBRL fact is nil: it holds no figure. |
| `pdf_only` | Gemini has a fact for the cell and XBRL has none. A dash against no XBRL fact is also `pdf_only`. |
| `xbrl_only` | XBRL has a fact for the cell. Gemini read the slot but has no fact for the cell. |
| `unlabelled` | As `xbrl_only`, but a Gemini fact of the slot has no concept. The unlabelled fact can be the line. |
| `not_read` | No Gemini fact is in the slot. |
| `span_unknown` | As `not_read`, but a Gemini fact that has no span has the statement, the basis and the date of the slot. |

The agreement is a rate over these cells: `agree`, `agree_at_precision`, `agree_dash_zero`, `disagree_value`, `disagree_scale`, `disagree_status` and `ambiguous`. The exact agreement counts `agree` only, over the same cells. All other outcomes are outside the denominator. This includes `disagree_sign` and `instances_differ`: a sign convention and an XBRL refiling are not a misread of Gemini. A rate is in tenths of a percent, rounded down.

If an owned slot has another instance that holds an element with another figure, `compare` lists the element under "Instances that differ". The outcome of the cell does not change.

### How the harness finds a run

The commands `export`, `freeze`, `settle`, `report` and `compare` take a run in `--run`. The commands `report` and `compare` also take runs in `--against`. The command `compare` takes the XBRL run in `--xbrl`.

- A bare name is a folder in `data/eval/runs`. A folder with the same name in the current folder does not count.
- A path is absolute or has a folder part, for example `archive/20261016T093005Z`. It is relative to the current folder, and it can lead to any folder.
- `latest` depends on the command.
- For `export` and `freeze`, `latest` is the last folder in `data/eval/runs` with a name of the form `YYYYMMDDTHHMMSSZ`, with or without `-<label>`. The harness ignores other folders, for example `archive`. If this folder is an XBRL run, the command stops with `<run> is an XBRL run; label the PDF run`.
- For `settle`, `report` and `compare --run`, `latest` is the last PDF run. This is the last folder of that form whose `run.json` has no `source`, or has the source `pdf`. The harness skips a folder that has no `run.json`.
- For `compare --xbrl`, `latest` is the last XBRL run.
- A run that you name, with a source that the command does not accept, stops the command with `run <name> is not a <source> run`. `compare --run` and `settle --run` accept a PDF run only. `compare --xbrl` accepts an XBRL run only.
- `report` takes the source of each run from its `run.json`.
- If the harness finds no run, it stops and shows `no runs under <path>`, `no runs under <path> with source <source>` or `no run '<name>' under <path>`.

### How the harness scores a gold fact

1. The harness reads the read facts of the artefact. A filing that failed has none, thus each gold fact of it is `missing`.
2. A read fact fits a gold fact if it has the same statement and the same basis. Its label and its period label must be the same after `normalise`.
3. The section counts only if the gold fact names one, and a read fact of the same statement and basis has it. Then only the read facts of that section fit.
4. Otherwise a read fact of any section can fit.
5. If no read fact fits, the outcome is `missing`.
6. If the read facts that fit do not all say the same, the outcome is `ambiguous`. They say the same if they are all dashes, or all unreadable, or all have the same value and the same normalized value. The harness compares the numbers as decimals, thus `2000` and `2000.0` are the same.
7. Otherwise the harness takes the read fact that comes first in the statement. It compares the gold fact with it.
8. If both are a dash, the outcome is `match`. If one is a dash and the other is not, the outcome is `wrong_status`. A read cell that the engine could not read also gives `wrong_status`.
9. If the normalized values are equal, the outcome is `match`.
10. If the values are equal, but the normalized values differ or the read fact has none, the outcome is `wrong_scale`.
11. Otherwise the outcome is `wrong_value`.
12. For a fact that it found, the harness also checks the page. The page index of the read fact must be the page index of the gold fact.

The harness compares the values of facts as `Decimal` values. It never uses a float for a value.

**The new outcomes.** Only a figure from XBRL gives these three outcomes:

- `match_at_precision`: the values are equal after both are rounded half away from zero to the coarser of the two precisions. A PDF can print whole crore where an instance holds lakh. The harness counts this outcome apart from `match`.
- `match_dash_zero`: the gold fact is a printed dash and the XBRL fact is `0`. XBRL cannot write a dash, so a filer tags a printed dash as `0`.
- `wrong_sign`: the figures are equal in size and opposite in sign. XBRL stores many payment lines as positive amounts, and the PDF prints them in brackets. This is a convention, not a misread. The harness never changes a sign.

`match` stays the exact match for every source, so the sources have one standard. The held-out gate guards the count of `match`. The three other counts stand beside it.

**The rule for XBRL.** The harness scores an XBRL run by concept, inside the slots of the instances:

1. The harness places the gold fact in a slot. The slot has the statement, the basis and the period end of the gold fact. The span is the span of the gold fact. If the gold file has none, the span is the span that the span rule reads from the period label. A balance sheet fact has no span.
2. If the gold fact has no period end, or has no span and is not on the balance sheet, the harness does not score it. It counts the fact as `no_period` or `no_span` under "Not placed".
3. If no used instance holds the slot, the harness does not score the fact. It counts the fact under "Outside". A comparative column is such a case. The XBRL run never takes the blame for it.
4. Otherwise the candidates are the facts with the concept of the gold fact that the owner of the slot holds. The element map gives the concept of an XBRL fact.
5. If no candidate exists, the outcome is `missing`. If the candidates hold different figures, the outcome is `ambiguous`.
6. Otherwise the harness compares the figure of the one candidate. The first rule that fits gives the outcome:
   - The gold fact is a dash and the XBRL fact is `0`: `match_dash_zero`.
   - The gold fact is a dash and the XBRL fact is another figure or nil: `wrong_status`.
   - The XBRL fact is nil and the gold fact is a figure: `wrong_status`.
   - The normalized values are equal: `match`.
   - The values are equal at the coarser precision: `match_at_precision`.
   - Both figures are not `0`, the signs are opposite and the figures are equal at the coarser precision: `wrong_sign`.
   - The reported value is the printed value of the gold fact: `wrong_scale`.
   - All other cases: `wrong_value`.
7. If the outcome is `missing` or `wrong_value`, the harness lists the elements of the slot that hold the gold figure under another concept. These are the map suspects.
8. The precision of an XBRL figure comes from its `decimals`. The precision of a gold figure comes from the scale and the places of the printed value.

**The rule for the owner of a slot.** An instance holds a slot if it has a fact in the slot. The period end of an XBRL fact comes before its as-at date. An XBRL fact with no date has no slot. An XBRL fact with no span has the span word `instant` in the key of its slot.

1. If one used instance holds the slot, it owns the slot.
2. If two or more used instances hold the slot, the source rule ranks them. The instance with the later filed date in its pair owns the slot.
3. If the filed dates tie, the harness reads the stamp at the end of each file name. The stamp is the digits after the last `_` and before `.xml`.
4. The harness reads the stamp in every way that gives a real date and time. The day and the month have one or two digits each. The year has four digits, from 2000 to 2099. The hour, the minute and the second have one or two digits each.
5. A tied instance owns the slot only if its earliest reading is later than the latest reading of every other tied instance. The harness never uses the text order of the names as the order in time.
6. If no tied instance owns the slot, or a tied instance has no reading, the slot is a pooled slot.
7. In a pooled slot, a cell that all pooled instances hold with one figure counts one time. A cell that they hold with different figures, or that one of them lacks, is `ambiguous` against gold. The harness never picks one figure.
8. In an owned slot, an element that another instance holds with another figure goes on a list of the cells that the instances hold differently. The list does not change a score.

**The rule for `shown`.** The source `shown` is the figure that the product shows. The harness builds it for each gold fact of the PDF run:

1. A gold fact with no period end is not placed. A gold fact with another period end than the period end of the filing is counted under "Outside". The product shows such a fact from another filing.
2. If the filing has no used instance, the PDF gives the figure. An annual report is never paired, so the PDF always gives its figures.
3. If an instance owns the slot of the gold fact, XBRL gives every figure of the slot. A line that XBRL lacks is `missing`.
4. In any other slot, the harness asks the source rule (`plan_pdf_numbers`) if the PDF is read. If yes, the PDF gives the figure. If no, the outcome is `missing` and the detail is `not_in_xbrl`.
5. The word "Outside" has two meanings in the report. For `xbrl`, it is a gold fact in a slot that no used instance holds. For `shown`, it is a gold fact of another period than the period of the filing.

**The rule for the rates.** Every headline rate is over the gold facts of origin `sheet`. This holds for the rates by source, the rates by format tag and the held-out gate. A person labelled these facts from a sheet, as a sample of the lines of the filing. A settled fact exists only where Gemini and XBRL disagreed, and a person labelled it with the XBRL figure in view. Thus the report scores the settled facts in a table of their own.

## States and errors

The harness shows an error in red and stops with exit code 1. A message names a filing id, a sheet row, a column, a count or a path. It never shows the label or the value of a fact, because the files hold them. The first table lists the states. The second table lists the reasons why `compare` leaves a filing out. The third table lists the errors by command.

| State | Cause | Result |
| --- | --- | --- |
| Outcome `match` | The normalized values agree. Or the gold fact and the read fact are both a dash. | Counted as an exact match. |
| Outcome `wrong_value` | Neither the normalized values nor the values agree. | Listed under Mismatches. |
| Outcome `wrong_scale` | The values agree, but the normalized values differ or the read fact has no scale. | Listed under Mismatches. |
| Outcome `wrong_status` | Only one of the two facts is a dash, or the engine could not read the printed text of the read fact. | Listed under Mismatches. |
| Outcome `ambiguous` | Read facts that fit the gold fact have different values. For XBRL, the pooled instances can also hold different figures. | Listed under Mismatches. The report shows no read value. Not counted as a match. |
| Outcome `missing` | No read fact fits the gold fact. | Listed under Mismatches. |
| Outcome `match_at_precision` | The XBRL value and the gold value are equal at the coarser of the two precisions, but not exactly equal. | Counted apart. Not an exact match. Not listed under Mismatches. |
| Outcome `match_dash_zero` | The gold fact is a printed dash and the XBRL fact is `0`. | Counted apart. Not an exact match. Not listed under Mismatches. |
| Outcome `wrong_sign` | The XBRL value and the gold value are equal in size and opposite in sign. | Counted apart. Listed under Mismatches. The element map section lists the element. |
| Instance not used | The harness cannot read an instance, or its BSE code, period end or basis is not that of the pair, or its format has no element map. | The artefact keeps the reason as a code. The harness reads no fact of the instance. A filing with no used instance is listed as not used and is not scored. |
| Gold fact not placed | The gold fact has no period end, or it has no span and is not on the balance sheet. | Counted under "Not placed". Not scored for `xbrl`. |
| Gold fact outside | The gold fact is in a slot that no used instance holds (`xbrl`), or has another period than the filing (`shown`). | Counted under "Outside". Not scored. |
| Pooled slot | Two or more instances hold the slot and the harness cannot put them in order. | A cell that the instances hold with different figures is `ambiguous` against gold and `instances_differ` in `compare`. |
| Filing not compared | `compare` cannot compare a filing. The next table gives the reasons. | The filing is listed in the summary of `compare-xbrl.md` with the reason. It has no cell. |
| Held-out set sealed | `xbrl-read` or `compare` reads the held-out set without `--gate`. `settle` gets a held-out filing. | The harness stops. |
| Filing failed | The artefact holds an error code and no result. | Each gold fact of the filing is `missing`. The report shows the error code in the Outcome column. |
| Not run | The filing is in the set, has a gold file and has a manifest entry. It is not out of scope, and the run has no artefact for it. | Listed under Not run. Not scored. |
| No gold yet | The run has an artefact of the set, but no gold file exists. | Listed under No gold yet. Not scored. |
| Out of scope | The manifest gives the filing the field `out_of_scope`. | `live` does not read it unless `--only` names it. `report` lists it under Out of scope. It scores the filing if the run read it. |
| Run stopped early | A person stops `live`, or the computer stops. | The run folder keeps the artefacts that `live` wrote. `run.json` has no `finished_at` and no `model`. The report shows the model as `unknown`. |
| Sheet exists | `export` finds a sheet for the filing. | The harness keeps the sheet. `--force` replaces it. |
| Settle sheet exists | `compare` finds a settle sheet for the filing. | The harness keeps the sheet. `--force` replaces it. |
| Gold file exists | `freeze` finds a gold file for the filing. | The harness stops. `--force` replaces the file. The settled facts of the file stay. |

**How `compare` leaves a filing out.** Each reason is a code in `compare-xbrl.json` and in the summary of `compare-xbrl.md`.

| Reason | Cause |
| --- | --- |
| `no_pdf_artefact` | The PDF run has no artefact for the filing. |
| `pdf_failed` | The artefact of the PDF run holds an error and no result. |
| `no_xbrl_artefact` | The XBRL run has no artefact for the filing. |
| `no_mapped_instance` | No instance of the filing is used, because the file cannot be read or its format has no element map. |
| `pair_mismatch` | No instance of the filing is used, because its BSE code, period end or basis is not that of the pair. |
| `no_concepts` | No Gemini fact of the filing has a concept from the sheets of the company. |

| Error | Cause | Result |
| --- | --- | --- |
| `--set must be dev, heldout or all` | `--set` of `live`, `xbrl-read`, `report`, `compare` or `tags propose` has another value. | Exit code 1. |
| `--set must be dev or heldout` | `--set` of `tags pick` or `tags coverage` has another value. The value `all` is also refused. | Exit code 1. |
| `--count must be 10 to 15` | `--count` of `tags pick` is outside the range. | Exit code 1. |
| `held-out is read only to decide whether a change lands; pass --gate` | `xbrl-read` or `compare` has `--set heldout` or `--set all`, without `--gate`. | Exit code 1. No run folder and no file. |
| `held-out gold is sealed` | `settle` gets a filing of the held-out set. | Exit code 1. |
| `nothing to read: no selected filing has XBRL instances` | No selected filing of `xbrl-read` has a pair. | Exit code 1. No run folder. |
| `<run> is an XBRL run; label the PDF run` | `export` or `freeze --run` gets an XBRL run. | Exit code 1. Nothing is written. |
| `run <name> is not a <source> run` | A run that you name has another source than the command accepts. | Exit code 1. |
| `two <source> runs; name one run per source` | `report --run` or `--against` gives two runs of one source. | Exit code 1. |
| `name a pdf run: the report is made on the PDF run` | `report` gets no PDF run. | Exit code 1. |
| `<run> is <source>, but no <source> run is scored; add --run for it` | `report --against` gives a run of a source that `--run` did not give. | Exit code 1. |
| `no element map for <format id>` | `report` finds an XBRL format with no map file in the engine. | Exit code 1. |
| `<path> is not a readable gold file` (`GoldError`) | `freeze --force`, `settle`, `report` or `tags coverage` reads a gold file that it cannot parse. | Exit code 1. Delete the file to start again. |
| `<run> has no compare-xbrl.json; run compare first` | `settle` finds no `compare-xbrl.json` in the PDF run. | Exit code 1. |
| `<path> is not a readable compare-xbrl.json; run compare again` | The file of `compare` is not of the form that `settle` reads. | Exit code 1. |
| `no settle sheet at <path>; …` | `settle` finds no settle sheet for the filing. | Exit code 1. The message tells you to run `compare`. |
| `gold already has <concept> for <basis> <period end> with another figure; nothing was written` | A settled row is the same cell as a gold fact with another figure. | Exit code 1. The gold file stays as it was. |
| `sheet row <n>: gold already has <concept> for <basis> <period end> from a settled disagreement` | `freeze --force` gets a row for a cell that a settled fact holds. | Exit code 1. The gold file stays as it was. |
| A message of `tags set` or `tags pick` | An option is wrong: for example `nothing to set: give --unit, --brackets or --restated`, `--unit must be one of <units>` or `--brackets must be yes or no`. Or a filing id is wrong: it is not in the manifest or the set, it cannot be picked, or it is in both `--include` and `--exclude`. | Exit code 1. The message names the option or the filing id. |
| A message of `xbrl-pair` | The CSV has no column or has a bad row (`<path> line <n>: <column> is not valid`). A company has more than one BSE code. A source file is not there. A corpus file holds other bytes. The pairs of a filing are not valid. | Exit code 1. The harness copies no file and writes no manifest. |
| `<folder> is not a folder` or `no .xml files under <folder>` | `--instances` of `xbrl-elements` does not lead to instances. | Exit code 1. |
| A manifest message | The manifest does not exist (`no manifest at <path>`), is not valid JSON, has a wrong or unknown field, repeats a filing id (`duplicate filing ids: …`), or puts one company or folder in two sets (`each company and corpus folder must be in one set only: …`). | Exit code 1. The message names the problem. |
| `not in the manifest: <ids>` | `--only` of `live` names an id that the manifest does not list. | Exit code 1. |
| `<id> is in set <a>, not <b>` | `--only` of `live` names a filing of another set than `--set`. | Exit code 1. |
| `missing under data/eval/corpus: <files>` | The corpus does not hold the PDF of a selected filing, or (`xbrl-read`) an instance of a selected filing. | Exit code 1. No run folder. |
| `nothing to read: the selection is empty` | The set has no filing that is in scope. | Exit code 1. No run folder. |
| `GOOGLE_CLOUD_PROJECT is not set; …` | `live` runs and the variable has no value. | Exit code 1. No run folder. |
| `EXTRACT_DEADLINE_SECONDS: <reason>` | The value is not a number. | Exit code 1. No run folder. |
| `run label '<label>': use letters, digits, dot, dash or underscore` | `--label` has another character. | Exit code 1. No run folder. |
| `no runs under <path>`, `no runs under <path> with source <source>` or `no run '<name>' under <path>` | `--run`, `--xbrl` or `--against` does not lead to a run. | Exit code 1. |
| `no artefacts in this run` | `export` finds no artefact in the run. | Exit code 1. No sheet. |
| `not in this run: <ids>` | `--only` of `export` names a filing that the run does not hold. | Exit code 1. No sheet. |
| `<id> is not in the manifest` | `freeze` gets a filing id that the manifest does not list. | Exit code 1. |
| `no sheet at <path>; …` | `freeze` finds no sheet for the filing. | Exit code 1. The message tells you to run `export`. |
| `no artefact for <id> in <run>` | `freeze --run` finds no artefact for the filing in the run. | Exit code 1. |
| A message about `run.json` | `freeze --run` or `report` uses a run folder that has no `run.json`. | Exit code 1. `report` writes nothing in the folder. |
| `the sheet has no 'verified' column; …` | The spreadsheet application saved the sheet with another delimiter. | Exit code 1. |
| `<name> is not UTF-8 text; …` | The spreadsheet application did not save the sheet as UTF-8 text. | Exit code 1. |
| `sheet row <n>: <column> no longer matches the artefact` | You gave `--run`, and a person changed a cell of a machine column. | Exit code 1. No gold file. |
| `sheet row <n>: row <k> no longer matches the artefact; …` | The label of the row differs from the label of the fact `<k>`, or the artefact has no fact `<k>`. | Exit code 1. No gold file. |
| Another `sheet row <n>: …` message | A kept row breaks a rule of the `freeze` command, or repeats the concept, basis and period of an earlier row. | Exit code 1. The message names the sheet row and the column. No gold file. |
| `no row is marked verified=yes; nothing to freeze` | No row has `yes` in `verified`. | Exit code 1. No gold file. |
| `<path> exists; gold is sealed, pass --force to replace it` | `freeze` finds the gold file, and you did not give `--force`. | Exit code 1. The file stays. |
| `cannot write <path>: <reason>` | The harness cannot write a file: `run.json` or an artefact (`live`, `xbrl-read`), a sheet (`export`), a gold file (`freeze`, `settle`), `report.md` or `report.json` (`report`), `compare-xbrl.md`, `compare-xbrl.json` or a settle sheet (`compare`), an instance or the manifest (`xbrl-pair`, `tags`), a CSV file (`xbrl-elements`), or the copy of `report --to` or `compare --to`. For example, a file is where the folder must be, you do not have permission, or the disk is full. | Exit code 1. The path is the file that the harness tried to write. The files that the command wrote before stay. A file that it could not replace stays as it was. If the copy of `report --to` fails, the report in the run folder exists. |
| The reason and the path, as the system gives them | The harness cannot read a file, for example the taxonomy or a PDF of the corpus. Or `live` cannot make the run folder. | Exit code 1. |
| `<path> is not a readable artefact`, `run.json` or `gold file` | An artefact, `run.json` or a gold file is not valid JSON, or has a field that the harness does not know. The message names the file and nothing in it. | Exit code 1. For a gold file, delete the file to start again. |
| A taxonomy that does not parse | The taxonomy is not valid JSON. | The harness does not catch the error. Python shows a traceback. |

## Data

### What the harness reads

- The file `.env`. The command line loads it with `load_dotenv()` before each command.
- The manifest, for every command except `xbrl-elements`.
- The PDFs under `data/eval/corpus`, for `live`.
- The instances under `data/eval/corpus`, for `xbrl-read` and `tags propose`.
- The file `xbrl-manifest.csv` and the instances in the folder that `--from` names, for `xbrl-pair`.
- The instances in the folder that `--instances` names, for `xbrl-elements`.
- The run folders under `data/eval/runs`, for `export`, `freeze`, `settle`, `report` and `compare`.
- The sheets under `data/eval/sheets`, for `freeze`. For `compare`, the `concept` column of each sheet of the company of the filing.
- The settle sheets under `data/eval/settle`, for `settle`.
- The gold files under `data/eval/gold`, for `freeze --force`, `settle`, `report` and `tags coverage`.
- The element maps in the engine, for `report`.
- The taxonomy, for `freeze`, `settle`, `compare`, `report` and `tags coverage`.
- The environment variables in this table:

| Variable | Default | Use |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | No default. `live` stops without it. | The Google Cloud project for Vertex AI. |
| `VERTEX_LOCATION` | `us-central1` | The Vertex AI location. |
| `GEMINI_MODEL` | `gemini-2.5-pro` | The name of the model. |
| `EXTRACT_DEADLINE_SECONDS` | `840` | The time in seconds that the workflow can use for one filing. |

These are the variables of the extractor, with the same defaults. Thus a run measures the configuration that the product runs. The model uses the Application Default Credentials of Google. If the model finds no credentials, each filing fails with the error `EXTRACTOR_NOT_CONFIGURED`.

### What the harness writes

- `run.json` and `artefacts/<filing id>.json` in the run folder, for `live` and `xbrl-read`.
- The instances in `data/eval/corpus/<company-folder>/xbrl`, and the manifest, for `xbrl-pair`. The manifest is also the output of `tags propose` and `tags set`.
- `elements-<format id>.csv` in the folder that `--out` names, for `xbrl-elements`.
- `data/eval/sheets/<filing id>.csv`, for `export`. The file is UTF-8 text with a byte order mark, so that spreadsheet applications read the text correctly.
- `data/eval/gold/<filing id>.json`, for `freeze` and `settle`.
- `report.md` and `report.json` in the run folder, for `report`. With `--to`, also a copy of `report.md` at the path that you give.
- `compare-xbrl.md` and `compare-xbrl.json` in the folder of the PDF run, for `compare`. With `--to`, also a copy of `compare-xbrl.md`.
- `data/eval/settle/<filing id>.csv`, for `compare`. The file has the same encoding as a sheet.

The harness finds `data/eval` from the repository root, from whichever folder you run it. A path that you give to `--run`, `--xbrl`, `--against`, `--to`, `--from`, `--instances`, `--out` or `--xbrl-manifest` is relative to the current folder.

Git ignores `data/eval/corpus`, `data/eval/runs` and `data/eval/xbrl` (`.gitignore`). It does not ignore the other files. You commit the manifest, the gold files and the reports in `docs/eval`. You decide if you commit the sheets and the settle sheets.

### The manifest

The manifest is a JSON object with the key `filings`. The key holds a list of objects, one for each filing. The harness refuses any other key, in the manifest and in a filing.

| Field | Rule |
| --- | --- |
| `file` | Required. The path of the PDF under the corpus: `<company-folder>/<name>.pdf`. The path must be in canonical form: no `/` at the start, no `./`, no `//` and no `..`. The ending `.pdf` can be in any case. |
| `company` | Required. The name of the company as the filing prints it. The workflow adds the warning `COMPANY_NAME_MISMATCH` to the result if the filing prints a name that does not agree with it. |
| `kind` | Required. `annual_report` or `financial_results`. The harness does not classify, thus the manifest gives the kind. |
| `period_end` | Required. The end of the period of the filing. It is a real calendar date written `YYYY-MM-DD`. |
| `set` | Required. `dev` or `heldout`. |
| `stratum` | Optional. `large`, `mid`, `small` or `financials`. The report groups the filings by stratum. A filing with no stratum counts as `none`. |
| `out_of_scope` | Optional. The reason why a baseline does not include the filing, as text. A filing with this field is out of scope. |
| `printed_pages_per_page` | Optional. `1` or `2`. The default is `1`. Use `2` when each PDF page is a spread of two printed pages. PDF page N then holds the printed pages 2N-1 and 2N. |
| `bse_code` | Optional. The six-digit scrip code of BSE. `xbrl-pair` writes it. A filing that has pairs must have it. |
| `xbrl` | Optional. A list of pairs, one for each instance that BSE filed for a results filing. The default is an empty list. Only a `financial_results` filing can have pairs. |
| `tags` | Optional. The format tags of the filing: `unit`, `unit_from`, `negatives_in_brackets` and `restated_columns`. A tag that is not in the manifest is `not tagged`. |

A pair is an object with these fields. The harness refuses any other field.

| Field | Rule |
| --- | --- |
| `file` | Required. The path of the instance under the corpus: `<company-folder>/xbrl/<name>.xml`. The company folder must be the company folder of the filing. |
| `basis` | Required. `consolidated` or `standalone`. |
| `period` | Required. The period token of BSE, for example `SQ2025-2026`. The period token must end on the `period_end` of the filing. |
| `filed` | Required. The date on which BSE received the instance, written `YYYY-MM-DD`. |
| `format` | The format id that the engine finds in the instance, for example `in-capmkt/ind_as`. It is empty if the instance cannot be read. |

The period token has two letters and two years. The second year is the first year plus one. The two letters give the period end:

| Letters | Period end |
| --- | --- |
| `JQ` | 30 June of the first year. |
| `SQ` and `SH` | 30 September of the first year. |
| `DQ` and `DN` | 31 December of the first year. |
| `MQ`, `MH` and `MC` | 31 March of the second year. |

The tags are these fields:

| Field | Rule |
| --- | --- |
| `unit` | `lakh`, `crore`, `thousand`, `million` or `rupees`. The unit in which the filing prints its figures. |
| `unit_from` | `xbrl` if `tags propose` set the unit from the declared rounding of the instances. `investor` if a person set it with `tags set`. |
| `negatives_in_brackets` | `true` or `false`. A person sets it. |
| `restated_columns` | `true` or `false`. A person sets it. |

The format tags are five words: `unit`, `brackets`, `restated`, `spreads` and `financials`. The tag `spreads` is `yes` if `printed_pages_per_page` is `2`. The tag `financials` is `yes` if `stratum` is `financials`. Banks and non-bank finance companies are out of scope, so their row in a report shows `out of scope` and not a rate.

These rules hold for the whole manifest:

- Each filing id is different.
- A company is in one set only. The harness tells companies apart by `company` after `normalise`, and by the corpus folder, the first part of `file`. Filings with the same company or the same folder must have the same set.
- A manifest that is not valid JSON, or is not UTF-8 text, gives a message and not a traceback.
- A filing that has pairs is a `financial_results` filing and has a `bse_code`.
- The harness writes the manifest back with two-space indents, with no field that has its default value, and with a final newline.

### The sheet

A spreadsheet application can retype a cell. It can change `10000000` to `1E+07`, or `2026-03-31` to `31/03/2026`. Keep every column as text, and keep each date in the form `YYYY-MM-DD`. With `--run`, `freeze` reads the machine columns again from the artefact. A retype that still agrees with the artefact is harmless:

- A number or a figure written another way, for example `1E+07` for `10000000`, or `2000` for `2,000`.
- A date written `YYYY-MM-DD` or day first with slashes, for example `31/03/2026`.
- The same words with another case or other punctuation.

Any other difference refuses the row.

Without `--run`, `freeze` uses the cells as they are. A cell that it cannot read stops the command. The message depends on the column:

- A `scale_factor` or a `period_end` on a numbered row: the message tells you to give `--run`.
- A `gold_scale` or a `gold_period_end`: the message tells you to keep the column as text.
- A `scale_factor` or a `period_end` on a row without a `row` number: the same message.
- A `page` or a `gold_page` that is not a whole number: a message of its own.
- A `printed` or a `gold_text` that `parse_reported` cannot read: a message of its own.
- A row of a `financial_results` filing that is not on the balance sheet and has no `span` and no `gold_span`: the message `no span; fill gold_span`. Write the span of the column in `gold_span`.
- A row of the balance sheet that has a `span` or a `gold_span`: the message says that a balance sheet row has no span. Clear the cell.

| Column | Written by | Meaning |
| --- | --- | --- |
| `row` | Harness | The number of the read fact in the artefact, from 1. A row that a person adds has none. |
| `statement` | Harness | The statement. A machine column. |
| `basis` | Harness | The basis. A machine column. |
| `section` | Harness | The section. A machine column. |
| `label` | Harness | The label. A machine column. |
| `period_label` | Harness | The period label. A machine column. |
| `period_end` | Harness | The one date of the fact: the period end, or the as-at date of a row of the balance sheet. Empty if the workflow could not read a date from the head of the column. A machine column. |
| `span` | Harness | How long the period is: `quarter`, `half_year`, `nine_months` or `year`, read from the words of the column head by the span rule (version 1, `maester_eval.periods`). A "year to date" head takes its span from the month of `period_end`. Empty for a balance sheet row, and if the head does not say. A machine column. |
| `printed` | Harness | The printed text. A machine column. |
| `value` | Harness | The value. Empty if the text has no value. |
| `unit_label` | Harness | The unit of the statement as the filing prints it. |
| `scale_factor` | Harness | The scale. Empty if the workflow knows no scale. A machine column. |
| `normalized_value` | Harness | The normalized value. |
| `page` | Harness | The PDF page of the fact, counted from 1. A machine column. |
| `printed_pages` | Harness | The printed pages on the PDF page. For a spread of two printed pages it is `3–4`, with an en dash. Else it is the PDF page. |
| `text_layer_match` | Harness | `yes` if the value is in the text layer of the page, `no` if it is not. Empty if the page has no text layer or the fact has no value. |
| `is_subtotal` | Harness | `yes` if the workflow found that the row is a subtotal, else `no`. |
| `material` | Harness | `yes` as a hint, else empty. |
| `concept` | Person | The concept of the fact. Each kept row needs one. |
| `gold_text` | Person | The printed text, if `printed` is wrong. |
| `gold_scale` | Person | The scale, if `scale_factor` is wrong or empty. |
| `gold_page` | Person | The PDF page, if `page` is wrong. |
| `gold_period_end` | Person | The date in the form `YYYY-MM-DD`, if `period_end` is wrong or empty. |
| `gold_span` | Person | `quarter`, `half_year`, `nine_months`, `year` or `other`, if `span` is wrong or empty. A balance sheet row has none. A row of a results filing needs a span from `span` or `gold_span`. |
| `adds_up` | Person | `yes` or `no` for a subtotal that the person checked by hand. Else empty. |
| `verified` | Person | `yes` for each row to keep. |
| `note` | Both | Free text. The harness writes `extraction failed: <code>` for a filing that failed. |

### The settle sheet

A settle sheet is a CSV file `data/eval/settle/<filing id>.csv`. `compare` writes it. It has the columns of a sheet, then these columns:

| Column | Written by | Meaning |
| --- | --- | --- |
| `concept_from` | Harness | `own` or `company`: where the concept came from. |
| `xbrl_element` | Harness | The XBRL element of the cell. |
| `xbrl_value` | Harness | The reported value of the XBRL fact. |
| `xbrl_unit` | Harness | The unit label of the XBRL fact. |
| `xbrl_normalized` | Harness | The normalized value of the XBRL fact. |
| `outcome` | Harness | The outcome of the cell: `disagree_value`, `disagree_scale` or `disagree_status`. |

A row is the sheet row of the Gemini fact, with `concept` filled. A person checks the row against the PDF and fills `gold_text`, `gold_scale`, `gold_page`, `gold_period_end` and `gold_span` as for a sheet. The person writes `yes` in `verified` for each cell that the person settled. `settle` reads only the columns that `freeze` knows.

### The run folder

`run.json` of a `live` run holds `run`, `started_at`, `set`, `pipeline_version`, `prompt_version`, `settings` and `filings`. At the end of the run it also holds `finished_at` and `model`. `settings` holds `deadline_seconds` and `max_model_calls`. `filings` lists the ids of the filings that `live` selected. It has no key `source`, and a run with no such key is a PDF run.

`run.json` of an XBRL run holds `run`, `started_at`, `set`, `source` (the value `xbrl`), `pipeline_version` (`xbrl-1`), `model` (`xbrl-parser-1`), `parser_version`, `map_version` and `filings`. At the end of the run it also holds `finished_at`. `filings` lists the ids of the filings that have pairs.

An artefact holds these fields:

- `filing_id`, `file`, `company`, `kind`, `period_end`, `set`, `stratum` and `printed_pages_per_page`, from the manifest.
- `pipeline_version`, `prompt_version` and `model`: the versions of the workflow and of the prompts, and the name of the model.
- `started_at`, `seconds` and `bytes`: the start time, the time in seconds and the size of the PDF.
- `model_calls`, with the counts `locate`, `extract` and `correct`.
- `pages_without_text`, the page indexes of the pages that have no text layer. It is empty if the PDF does not open.
- `result`, the result of the workflow in the wire format of the extractor, with camelCase names. It is empty if the filing failed.
- `error`, with `code`, `retryable` and `message`. It is empty if the workflow read the filing.

An artefact of an XBRL run has the same fields. These fields have another meaning:

- `source` is `xbrl`. A PDF artefact has the default `pdf`.
- `pipeline_version` is `xbrl-1` and `model` is `xbrl-parser-1`. `prompt_version` lists the format ids of the used instances, each as `<format id>@<map version>`. It is `-` if no instance is used.
- `seconds` is `0`, `model_calls` are all `0` and `pages_without_text` is empty. `bytes` is the total size of the instances.
- `result` holds `state`, `facts`, `checks` and `warnings`. `state` is `partial` if the reader of a used instance gave `partial`. Each entry has the field `instance`, the file of the instance that it came from. An XBRL fact also holds `element`, `concept`, `span`, `decimals` and `unitLabel`.
- `error` is empty.

An XBRL artefact also has the list `instances`. Each entry holds `file`, `basis`, `period` and `filed` of the pair. It also holds the `sha256` of the file and the `format`. It holds `mapped`, `used`, `reason`, `state`, `facts` (the count) and `warnings` (codes only). `reason` is empty for a used instance.

### The gold file

A gold file holds these fields:

- `filing_id`, `file`, `company`, `kind`, `period_end`, `set`, `stratum` and `printed_pages_per_page`, from the manifest.
- `taxonomy_version`, from the taxonomy, and `frozen_at`, the UTC time of the freeze.
- `exported_from`: with `--run`, the `run`, `pipeline_version`, `prompt_version` and `model` of `run.json`. Else it is empty.
- `facts`, the gold facts.
- `expected_checks`: one entry with `concept`, `basis`, `period_label` and `adds_up` for each kept row that has `yes` or `no` in `adds_up`.

A gold fact holds `concept`, `statement`, `basis`, `section`, `label`, `period_label`, `period_end`, `printed`, `value_status`, `value`, `scale`, `normalized_value`, `page_index`, `span`, `dimensions` and `origin`. `period_end` is the date that places the fact: the period end, or the as-at date of a row of the balance sheet. It can be empty. `value_status` is `value` or `dash`. `page_index` counts from 0.

`span` is `gold_span`, or else the `span` of the sheet row. It is empty for a row of the balance sheet. `dimensions` has no entry in this version.

`origin` is `sheet` or `settled`. The default is `sheet`: a person labelled the fact from a sheet. `freeze` writes `sheet` only. `settle` writes `settled` only.

A gold file also has the list `settled`. `settle` adds one record to it each time that it adds facts. A record holds `pdf_run`, `xbrl_run`, `map_version`, `compare_rule`, `settled_at` and `facts`, the count of facts that this run added.

A null `span` in a gold fact on the balance sheet is normal, because a balance sheet fact is an instant. For another statement, a null `span` means that the span is not known. The harness never places such a fact in a slot.

### The report

`report.md` has these parts, in this order. Parts 4 to 9 are in the report only if the report has another run, or if the gold holds settled facts. A report of one PDF run with no settled facts has parts 1 to 3 and 10 to 13. This is the report of phase 0.

1. The title `Evaluation report: <run>`, and a line with the set, the UTC time, and the pipeline version, the prompt version and the model of the run. The line shows `unknown` for a version that `run.json` does not hold.
2. Summary: the count and the rate of each measure. The measures are Filings, Read, Failed and Gold facts. They also include the six outcomes, Page match and the three counts of checks. The six outcomes are `match`, `wrong_value`, `wrong_scale`, `wrong_status`, `ambiguous` and `missing`. The counts of checks are Checks passed, Checks failed and Checks not checked. The median and the maximum of the seconds and of the model calls for each filing follow. The Summary is the PDF run.
3. `Against <run>`, only with `--against`: a table with nine rows, the six outcomes, Page match, Checks passed and Checks failed. Each row gives the rate for this run, the rate for the earlier run and the change in percentage points.
4. By source: one row for each source that the report scores. The columns are Source, Filings, Gold facts, Exact match, At precision, Dash as 0, Wrong sign, Missing, Outside and Not placed. A line names the run of each source.
5. By format tag: one table for each of the five tags. The columns are Value, Filings, `pdf`, `xbrl` and `shown`. A cell of a source is the count of exact matches over the gold facts of the filings with that value, and the rate. A filing is in every table, because the tags are not a partition. A filing that nobody tagged is `not tagged`. After the table of the unit tag, a line counts the filings whose unit tag agrees with the gold. It lists each filing that disagrees, or whose gold facts use more than one scale.
6. The element map against gold, only with an XBRL run. It has the table Per format, which gives the outcomes of the gold facts for each format id. Then it has the lists Map suspects, Sign only, Concepts no element gives, Refilings with no order and XBRL not used.
7. Settled disagreements, only if the gold holds settled facts. There is one row for each run that the report scores. The columns are Source, Filings, Settled facts, Exact match and Not in this run.
8. `Against <earlier run>` for each other source that has an earlier run, in the same form as part 3.
9. Rule versions: the span rule, the compare rule, the concept carry rule, the owner rule and the source rule. With an XBRL run, it also gives the parser version and the element map version of that run.
10. By kind, By scanned, By basis, By statement and By stratum. Each table has the columns Filings, Gold facts, Exact match, Missing and Page match. The harness leaves out a table that has no row.
11. Filings: one row for each scored filing, with the columns Kind, Scanned, Outcome, Gold facts, Exact match, Seconds, Model calls, Size (MB) and Stratum.
12. Not run, No gold yet and Out of scope: a list for each, only if it has an entry. An out-of-scope entry shows the reason of the manifest.
13. Mismatches: one row for each gold fact of the PDF run that is not `match`, `match_at_precision` or `match_dash_zero`, or `None.`

Every rate in the parts 2 to 11 is over the gold facts of origin `sheet`. The element map part has these meanings:

- Map suspects: an element of the slot holds the gold figure under another concept, or under none. The map may need the gold concept for the element.
- Sign only: the instance holds the gold figure with the opposite sign. The list shows the elements.
- Concepts no element gives: a gold concept that no element map of the format has.
- Refilings with no order: the filings with pooled slots, and the count of slots.
- XBRL not used: the filings with no used instance, with the reason.

A rate is a count divided by its own total, as a percentage rounded down to one decimal. Thus only 100.0% means that all agree. A rate with no total shows `—`.

The outcomes use the gold facts as the total. Read and Failed use the filings. Page match uses the found facts. The checks use all checks. The tables By basis and By statement count facts, thus their Filings cell shows `—`.

The report marks a filing as scanned if a page where the workflow found a statement has no text layer. For a filing that failed, it marks the filing as scanned if any page has no text layer. The column Outcome of the Filings table is different: it shows the `state` of the result of the filing, or its error code. A fact that is `missing` or `ambiguous` shows `—` as the read text in Mismatches.

`report.json` holds `generated_at`, `against`, `summary`, `strata`, `score` and `rule_versions`. With another run, it also holds `sources`. With the format tags, it also holds `format_tags` and `unit_tags`. With an XBRL run, it also holds `map`. With settled facts, it also holds `settled`.

### The comparison files

`compare-xbrl.md` has these parts, in this order:

1. The title `Gemini against XBRL: <PDF run> and <XBRL run>`. Then a line with the set, the UTC time and the two runs. Then a line with the versions of the five rules, the XBRL parser and the element map.
2. Summary: the count of compared filings, and the filings that `compare` left out, each with its reason. Then the measures Agreement, Exact agreement, Of which at precision, Of which dash against 0, Sign only and Instances that differ. Then the cells by outcome and the Gemini facts by what happened to them (`no_period`, `no_span`, `outside_instance`, `no_concept`, `concept_own` and `concept_company`).
3. By format tag: one table for each of the five tags. Each row gives the filings, the agreement, the exact agreement and the cells of each outcome.
4. By statement: the same columns, for each statement.
5. Disagreements: one row for each cell with the outcome `disagree_value`, `disagree_scale`, `disagree_status` or `ambiguous`, with the PDF figure and its page and the XBRL figure.
6. Sign only: the elements whose figure differs only in sign, with the count of cells.
7. Instances that differ: each cell that another instance of the slot holds with another figure, with the owner of the slot and the other instances.
8. `Against <earlier PDF run> and <earlier XBRL run>`, only with `--against`: the agreement, the exact agreement and the change of each count.

`compare-xbrl.json` holds `pdf_run`, `xbrl_run`, `eval_set`, `generated_at`, `versions`, `filings`, `counts`, `agreement_tenths`, `exact_agreement_tenths` and `against`. With `--against`, it also holds `against_counts`, `against_agreement_tenths` and `against_exact_agreement_tenths`. Each entry of `filings` holds `filing_id`, `company`, `set`, `tags`, `compared`, `reason`, `cells`, `counts` and `instances_differ`. Each cell holds the slot, the statement, the basis, the span, the period end, the concept, the outcome and the concept source. It also holds the PDF figure and the XBRL figure that `compare` shows. `settle` reads `xbrl_run` and `versions` from this file.


### What the harness sends to Google

`live` sends the bytes of each selected PDF to the model, in the requests of the workflow. This is also true with `--paired`. The other commands send nothing.

## Procedures

### To prepare the settings

You must do this procedure before you use `live`.

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. In `.env`, put the ID of your Google Cloud project in `GOOGLE_CLOUD_PROJECT`.
3. If your project cannot use `gemini-2.5-pro`, put another model name in `GEMINI_MODEL`.
4. Log in with Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

### To show the help

1. Show the list of commands:

   ```bash
   uv run --locked maester-eval --help
   ```

2. To see the options of one command, add the command name before `--help`:

   ```bash
   uv run --locked maester-eval live --help
   ```

### To read the filings of a set

WARNING: Read one filing first. `live` sends the PDFs to Google and can cause charges.

1. Do the procedure "To prepare the settings".
2. Make sure that the manifest lists the filings and that the corpus holds their PDFs.
3. To read one filing, run `live` with `--only` and a label:

   ```bash
   uv run --locked maester-eval live --only synthetic-cements/ar-2025-26 --label smoke
   ```

4. To read the filings of the `dev` set, run `live` with a label:

   ```bash
   uv run --locked maester-eval live --set dev --label baseline
   ```

5. To read only the filings that have pairs, add `--paired`. The harness shows `paired: <n> of <m>` before the run.
6. Read the state or the error code in the line of each filing.

### To correct a sheet

1. Run `export` for the last run:

   ```bash
   uv run --locked maester-eval export --run latest
   ```

2. Open the PDF of the filing beside its sheet in `data/eval/sheets`.
3. Keep every column as text and each date in the form `YYYY-MM-DD`.
4. Do not change a machine column.
5. Start with the rows that have `yes` in `material`.
6. In `concept`, write the id of the concept from the taxonomy.
7. Check each cell against the page of the PDF:
   - `printed`: if it is wrong, write the text as the page prints it in `gold_text`.
   - `scale_factor`: if it is wrong or empty, write the scale in `gold_scale`. Use `10000000` for crore, `100000` for lakh, `1000` for thousand and `1` for whole units.
   - `page`: if it is wrong, write the PDF page in `gold_page`.
   - `period_end`: if it is wrong or empty, write the date in `gold_period_end`.
   - `span`: if it is wrong or empty, write the span in `gold_span`. A row of a results filing needs a span, but not a row of the balance sheet. Without it, `freeze` gives the message `no span; fill gold_span`.
   - `statement`, `basis`, `section`, `label` and `period_label` have no `gold_` column. If one is wrong, leave that row unverified and add the corrected row by hand.
8. For a subtotal that you checked by hand, write `yes` or `no` in `adds_up`.
9. Write `yes` in `verified`.
10. To add a row by hand, add it at the end of the sheet.
11. Leave `row` empty in the new row.
12. In the new row, write `statement`, `basis`, `label`, `period_label`, `gold_text`, `gold_scale`, `gold_page`, `concept` and `verified`.
13. If the same label is in two sections, also write `section`.

### To freeze a sheet

1. Run `freeze` with the filing id and the run that you exported from:

   ```bash
   uv run --locked maester-eval freeze synthetic-cements/ar-2025-26 --run latest
   ```

2. If you ran `live` again after the export, give the name of the run in place of `latest`.
3. If the harness refuses a row, read the message, which names the sheet row and the column.
4. If the message says "no longer matches the artefact", put the cell back as it was.
5. If the cell has a `gold_` column, write the correction there.
6. For `statement`, `basis`, `section`, `label` or `period_label`, leave the row unverified and add the corrected row by hand.
7. To replace a gold file, run the command again with `--force`. The settled facts of the file stay.
8. If the message says that the gold file is not readable, delete the file and run the command again. The settled facts of the file are then lost.

### To make a report

1. Run `report` for a run and a set:

   ```bash
   uv run --locked maester-eval report --run latest --set dev
   ```

2. Open `report.md` in the run folder.
3. To see the change against an earlier run, add `--against` and the name of that run.
4. To score an XBRL run, add a second `--run` with the name of the XBRL run. Add one `--against` for each source that you compare.
5. To copy the report to a path, add `--to` and the path:

   ```bash
   uv run --locked maester-eval report --run latest --set dev --to docs/eval/2026-10-16-baseline.md
   ```

### To pair the XBRL files

Do this procedure in the checkout that holds `data/eval/corpus`.

1. Make sure that the manifest lists the filings.
2. Make sure that `xbrl-manifest.csv` has the columns `bse_code`, `company`, `period`, `basis`, `filed`, `file` and `status`.
3. Make sure that each `file` in the CSV is relative to the folder that holds the instances.
4. Check the pairs with a dry run:

   ```bash
   uv run --locked maester-eval xbrl-pair --xbrl-manifest ~/Personal/maester-filings/xbrl-manifest.csv --from ~/Personal/maester-filings --dry-run
   ```

5. Read the counts.
6. If a message names a company, a line or a path, remove the cause and go to step 4.
7. Run the command again without `--dry-run`:

   ```bash
   uv run --locked maester-eval xbrl-pair --xbrl-manifest ~/Personal/maester-filings/xbrl-manifest.csv --from ~/Personal/maester-filings
   ```

8. Set the units from the declared rounding of the instances:

   ```bash
   uv run --locked maester-eval tags propose
   ```

9. Commit the manifest. Git ignores the instances in the corpus.

### To pick the first gold filings

1. Do the procedure "To pair the XBRL files".
2. Set the tags that no instance gives: the unit of an annual report, negatives in brackets and restated columns. Run `tags set` for each filing:

   ```bash
   uv run --locked maester-eval tags set synthetic-cements/results-2025-09 --brackets yes --restated no
   ```

3. Pick the filings:

   ```bash
   uv run --locked maester-eval tags pick --set dev --count 12
   ```

4. Read the lines. Each line names a filing and the requirements that the filing advances.
5. If the last line starts with `unmet:`, change `--count`, or use `--include` and `--exclude`, and run the command again.
6. Read the picked filings with `live`. Give one `--only` for each filing and a label. Do not give `--paired` for an annual report, because an annual report has no pair.
7. Label and freeze each filing. Do the procedures "To correct a sheet" and "To freeze a sheet".
8. Count the gold by tag value:

   ```bash
   uv run --locked maester-eval tags coverage --set dev
   ```

9. If the line `unit tag against gold` lists a filing, correct its unit tag with `tags set <filing id> --unit <unit>`.

Each requirement is a minimum count of picked filings with one tag value:

| Tag | Value and minimum |
| --- | --- |
| Kind | `annual_report` 4, `financial_results` 8. |
| Spread | `yes` 2. |
| Quarter of the period token | `Q1` 1, `Q2` 2, `Q3` 1, `Q4` 1. |
| Period token | `SQ` 1, `SH` 1. |
| Format family | `in-capmkt` 1, `in-bse-fin` 1. |
| Unit | `crore` 1, `lakh` 1, `million` 1. |
| Bases | `standalone_only` 1. |
| Instances | `refiled` 1. |
| Stratum | `large` 2, `mid` 2, `small` 2. |

### To compare Gemini with XBRL

1. Do the procedure "To pair the XBRL files".
2. Read the filings that have pairs with `live`. State the count of filings first, because this costs model calls:

   ```bash
   uv run --locked maester-eval live --set dev --paired --label gemini
   ```

3. Make sure that each company has a sheet with the column `concept` filled for its lines. `compare` takes the concept of a Gemini fact from the sheets of the same company. Do the procedure "To correct a sheet".
4. Read the instances:

   ```bash
   uv run --locked maester-eval xbrl-read --set dev
   ```

5. Run `compare`. Give the names of the two runs, and not `latest`:

   ```bash
   uv run --locked maester-eval compare --run 20261021T090000Z-gemini --xbrl 20261021T100000Z-xbrl --set dev
   ```

6. Open `compare-xbrl.md` in the folder of the PDF run.
7. In the Summary, read the filings that `compare` left out, and the reason for each.
8. Read the agreement and the exact agreement. Read the counts at precision, dash against `0` and sign only beside them.
9. To copy the file to a path, add `--to` and the path.
10. To read the held-out set, give `--gate`. Do this one time only, when a change must land.

If Gemini did not read some filings, or some companies have no sheet with concepts, the comparison is partial. The summary names the filings that it did not compare.

### To settle a disagreement

1. Run `compare`. Open the settle sheet `data/eval/settle/<filing id>.csv`.
2. For each row, open the PDF at the page in `page`. The columns `xbrl_element`, `xbrl_value`, `xbrl_unit` and `xbrl_normalized` show the XBRL side.
3. If `printed` is not the figure on the page, write the figure in `gold_text`. If the page prints a dash, write the dash.
4. Check `scale_factor`, `period_end` and `span`, as in the procedure "To correct a sheet". Write a correction in the `gold_` column.
5. Write `yes` in `verified` for each cell that you settled. Leave the other rows unverified.
6. Run `settle` with the filing id and the name of the PDF run:

   ```bash
   uv run --locked maester-eval settle synthetic-cements/results-2025-09 --run 20261021T090000Z-gemini
   ```

7. If the message says that gold already has the cell with another figure, find which figure is right. `settle` never replaces a gold fact.
8. Run `report` with the PDF run and the XBRL run. The part Settled disagreements shows the settled facts.

### To measure a change of the element map

The `xbrl-map` command of phase 4 is not in this version of the harness. Step 1 uses it when it is there.

1. Run `xbrl-map` with `--against` the earlier map, and read its report.
2. Read the instances of the `dev` set with the new map:

   ```bash
   uv run --locked maester-eval xbrl-read --set dev --label newmap
   ```

3. Make a report with the PDF run, the new XBRL run and the earlier XBRL run:

   ```bash
   uv run --locked maester-eval report --run <pdf run> --run <new xbrl run> --against <old xbrl run> --set dev
   ```

4. Run `compare` with the same runs:

   ```bash
   uv run --locked maester-eval compare --run <pdf run> --xbrl <new xbrl run> --against <old xbrl run> --set dev
   ```

5. To decide if the change lands, read the held-out set one time. Give `--gate` to `xbrl-read` and to `compare`. `report` has no gate, thus run it on the held-out set for this one decision only.
6. Check that the exact match of `xbrl` has no regression on the held-out set. The exact match counts exact equality over the gold facts of origin `sheet`. Check also that the agreement of `compare` has no regression.
7. Read the counts at precision, dash against `0` and sign only beside these two rates.
8. Copy the reports to `docs/eval` with `--to`.

A change of the sign convention in the map is a change of the map like any other. It goes through these steps. Its report names the elements that changed sign.

### To list the elements of the instances

1. Run `xbrl-elements` with the folder of the instances and a folder for the output:

   ```bash
   uv run --locked maester-eval xbrl-elements --instances ~/Personal/maester-filings/xbrl --out data/eval/xbrl
   ```

2. Open `elements-<format id>.csv` in the output folder. Git ignores `data/eval/xbrl`.

### To take a baseline

Read the plan [evaluation baseline](../superpowers/plans/2026-10-15-eval-baseline.md), Task 10.

### To run the tests

1. Run all the Python tests:

   ```bash
   uv run --locked python -m unittest discover -s tests -v
   ```

2. To run the tests of one module, give its file name to `-p`:

   ```bash
   uv run --locked python -m unittest discover -s tests -p "test_eval_gold.py" -v
   ```

Note: several test modules import another module of `tests` by its bare name. Thus a dotted module name, such as `tests.test_eval_gold`, fails for them.

Note: the tests in `tests/test_eval_*.py` and `tests/test_concepts_json.py` use a scripted model. They make no model call.

## Warnings and cautions

WARNING: Put only public filings in the corpus. `live` sends each PDF to Google. The sheets, the gold files and the reports keep figures from the filings, and you can commit them.

WARNING: Use `--only` to read one filing first. `live` can cause charges to your Google Cloud project. This is also true with `--paired`.

CAUTION: Use `export --force` only to replace a sheet on purpose. It writes over the sheet, and you lose the corrections in it.

CAUTION: Use `freeze --force` only to replace a gold file on purpose. It writes over the file, and you lose the earlier facts.

CAUTION: Use `compare --force` only to replace a settle sheet on purpose. It writes over the sheet, and you lose the work in it.

CAUTION: Do not tune a prompt, a rule or an element map on the `heldout` set. Run it only to decide if a change lands. `xbrl-read` and `compare` need `--gate` for it.

## Limits

- The harness finds a gold fact by its printed words: the statement, the basis, the section, the label and the period label. A read fact with another label is `missing`, also when its value is right. It does not use the concept or the date. Phase 1 adds a way to find a gold fact by its concept.
- A gold fact has a `span`, but it has no `dimensions` yet. The gold files hold facts of the three statements only.
- `freeze` writes `adds_up` as an expected check. The report does not use the expected checks. It counts the checks that the workflow ran.
- The harness has the `live` mode only. It has no `replay` mode, thus every run calls the model. Phase 1 adds `replay`.
- The harness does not run classification. The kind of a filing comes from the manifest.
- `live` reads the filings one at a time.
- The concept of a Gemini fact in `compare` comes from the sheets of the same company (the concept carry, rule version 1).
  - The key is the statement, the section and the label. Without the section, the key is the statement and the label, but only if the label has one concept in the sheets of the company.
  - The harness never takes a concept from a value, and never from a match between a label and the label of the element map.
  - A Gemini fact with no concept is not a line that Gemini missed. A filing with no such concept is not compared.
  - Phase 1 replaces this rule with a mapping rule.
- The span of a Gemini fact or a gold fact comes from the words of its column head (the span rule, version 1).
  - A "year to date" head takes its span from the month of the period end, under the financial year that starts on 1 April. June gives `quarter`, September gives `half_year`, December gives `nine_months` and March gives `year`. Any other month gives no span.
  - A head with no span word gives no span. The harness does not place such a fact. A quarter and its year to date can end on one day, so a guess would be wrong.
  - The rule never gives `other`. A person can write `other` in `gold_span`.
  - The rule is in the harness. Phase 4 of the data layer moves it into the engine.
- Results only: the harness pairs results filings only. An annual report is never paired with the instance of a March quarter. The harness does not compare an annual report with XBRL.
- An instance holds its own slots only. A comparative column of a PDF is outside the instance. Thus the format tag `restated` has almost no cell in `compare`, because restated figures are in comparative columns.
- A slot with two `other` durations of different lengths that end on one day has no Gemini fact, because the span rule never gives `other`. Its cells are `not_read` or `span_unknown`.
- A slot with two instances that have no order is pooled. The investor cannot name an owner yet.
- A sign convention is the choice of the investor. `compare` and the report count a figure that differs only in sign apart, and never change a sign.
- The unit tag comes from the declared rounding of the instances. This assumes that the PDF prints in the unit that the instance declares. `tags coverage` and `report` check the tag against the scales of the gold facts.
- The harness does not measure the check `xbrl_in_pdf`.
- The command `xbrl-map` of phase 4 is not in this version of `cli.py`.

## Sources

- [`apps/eval/src/maester_eval/cli.py`](../../apps/eval/src/maester_eval/cli.py)
- [`apps/eval/src/maester_eval/paths.py`](../../apps/eval/src/maester_eval/paths.py)
- [`apps/eval/src/maester_eval/manifest.py`](../../apps/eval/src/maester_eval/manifest.py)
- [`apps/eval/src/maester_eval/concepts.py`](../../apps/eval/src/maester_eval/concepts.py)
- [`apps/eval/src/maester_eval/runner.py`](../../apps/eval/src/maester_eval/runner.py)
- [`apps/eval/src/maester_eval/artefacts.py`](../../apps/eval/src/maester_eval/artefacts.py)
- [`apps/eval/src/maester_eval/sheets.py`](../../apps/eval/src/maester_eval/sheets.py)
- [`apps/eval/src/maester_eval/gold.py`](../../apps/eval/src/maester_eval/gold.py)
- [`apps/eval/src/maester_eval/scoring.py`](../../apps/eval/src/maester_eval/scoring.py)
- [`apps/eval/src/maester_eval/report.py`](../../apps/eval/src/maester_eval/report.py)
- [`apps/eval/src/maester_eval/text.py`](../../apps/eval/src/maester_eval/text.py)
- [`apps/eval/src/maester_eval/xbrl_pair.py`](../../apps/eval/src/maester_eval/xbrl_pair.py)
- [`apps/eval/src/maester_eval/xbrl_read.py`](../../apps/eval/src/maester_eval/xbrl_read.py)
- [`apps/eval/src/maester_eval/xbrl_limits.py`](../../apps/eval/src/maester_eval/xbrl_limits.py)
- [`apps/eval/src/maester_eval/xbrl_survey.py`](../../apps/eval/src/maester_eval/xbrl_survey.py)
- [`apps/eval/src/maester_eval/tags.py`](../../apps/eval/src/maester_eval/tags.py)
- [`apps/eval/src/maester_eval/source_rule.py`](../../apps/eval/src/maester_eval/source_rule.py)
- [`apps/eval/src/maester_eval/periods.py`](../../apps/eval/src/maester_eval/periods.py)
- [`apps/eval/src/maester_eval/cells.py`](../../apps/eval/src/maester_eval/cells.py)
- [`apps/eval/src/maester_eval/owners.py`](../../apps/eval/src/maester_eval/owners.py)
- [`apps/eval/src/maester_eval/sheet_concepts.py`](../../apps/eval/src/maester_eval/sheet_concepts.py)
- [`apps/eval/src/maester_eval/compare.py`](../../apps/eval/src/maester_eval/compare.py)
- [`apps/eval/src/maester_eval/settle.py`](../../apps/eval/src/maester_eval/settle.py)
- [`apps/eval/pyproject.toml`](../../apps/eval/pyproject.toml)
- [`apps/eval/README.md`](../../apps/eval/README.md)
- [`packages/contracts/concepts.json`](../../packages/contracts/concepts.json)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/runner.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/runner.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/values.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/values.py)
- [`tests/test_eval_cli.py`](../../tests/test_eval_cli.py), [`tests/test_eval_live.py`](../../tests/test_eval_live.py), [`tests/test_eval_manifest.py`](../../tests/test_eval_manifest.py), [`tests/test_eval_sheets.py`](../../tests/test_eval_sheets.py), [`tests/test_eval_gold.py`](../../tests/test_eval_gold.py), [`tests/test_eval_scoring.py`](../../tests/test_eval_scoring.py), [`tests/test_eval_report.py`](../../tests/test_eval_report.py)
- [`tests/test_eval_xbrl_pair.py`](../../tests/test_eval_xbrl_pair.py), [`tests/test_eval_xbrl_read.py`](../../tests/test_eval_xbrl_read.py), [`tests/test_eval_xbrl_survey.py`](../../tests/test_eval_xbrl_survey.py), [`tests/test_eval_tags.py`](../../tests/test_eval_tags.py), [`tests/test_eval_cells.py`](../../tests/test_eval_cells.py), [`tests/test_eval_owners.py`](../../tests/test_eval_owners.py), [`tests/test_eval_periods.py`](../../tests/test_eval_periods.py), [`tests/test_eval_source_rule.py`](../../tests/test_eval_source_rule.py), [`tests/test_eval_sheet_concepts.py`](../../tests/test_eval_sheet_concepts.py), [`tests/test_eval_scoring_xbrl.py`](../../tests/test_eval_scoring_xbrl.py), [`tests/test_eval_compare.py`](../../tests/test_eval_compare.py), [`tests/test_eval_settle.py`](../../tests/test_eval_settle.py)
- [`.gitignore`](../../.gitignore)
- [`docs/superpowers/specs/2026-10-15-financial-data-layer-design.md`](../superpowers/specs/2026-10-15-financial-data-layer-design.md), section 9
- [`docs/superpowers/plans/2026-10-15-eval-baseline.md`](../superpowers/plans/2026-10-15-eval-baseline.md)
