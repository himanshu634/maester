# Maester evaluation harness: system description

This document describes the Python command-line application in `apps/eval`. For the full system, read the [Maester overview](maester.md). For the extraction workflow that the harness runs, read the [Extractor](extractor.md) description. For the design, read [financial data layer](../superpowers/specs/2026-10-15-financial-data-layer-design.md), section 9.

## Terms

| Term | Meaning in this document |
| --- | --- |
| harness | The Python command-line application in `apps/eval`. Its distribution name is `maester-eval`. Its command is `maester-eval`. |
| command | A subcommand of `maester-eval`. The harness has four commands: `live`, `export`, `freeze` and `report`. |
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
| run | One folder under `data/eval/runs`. It holds `run.json`, the artefacts and the report of one `live` command. |
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
| machine column | One of nine sheet columns that `freeze` can read again from the artefact: `statement`, `basis`, `section`, `label`, `period_label`, `period_end`, `printed`, `scale_factor` and `page`. |
| taxonomy | The file `packages/contracts/concepts.json`. It lists the concepts. |
| concept | An id in the taxonomy, for example `profit_after_tax`. |
| gold file | One JSON file under `data/eval/gold`. It holds the facts of one filing that a person checked against the PDF. |
| gold fact | One fact in a gold file. It has a concept. |
| expected check | A record in a gold file of what a person found by hand: a subtotal adds up (`yes`) or does not add up (`no`). |
| outcome | The result of the comparison of one gold fact with a run: `match`, `wrong_value`, `wrong_scale`, `wrong_status`, `ambiguous` or `missing`. |
| exact match | The outcome `match`. The read fact and the gold fact agree in the normalized value (value, sign and scale together), the basis and the period. |
| report | The files `report.md` and `report.json` in a run folder. |
| exit code | The number that a command gives to the shell when it stops. 0 means success. |

## Function

The harness measures how well the extraction workflow reads real filings. A person runs it on a local computer, in a terminal. It has four commands:

- `live` reads the filings of a set with the real model and keeps one artefact for each filing.
- `export` writes one sheet for each artefact of a run.
- `freeze` turns a sheet that a person checked into a gold file.
- `report` compares a run with the gold files and writes the result.

A person corrects each sheet against the PDF between `export` and `freeze`. The first report is the baseline. Each later report can show the change against an earlier run. The harness has no connection to the API, the worker, the extractor service or the database.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| Command line | `apps/eval/src/maester_eval/cli.py` | Defines the four commands and their options with Typer. Reads `.env` before each command. Shows filing ids, codes, counts and seconds. Shows no label and no value of a fact. |
| Entry point | `apps/eval/src/maester_eval/__main__.py`, `apps/eval/pyproject.toml` | `pyproject.toml` installs the command `maester-eval`. `__main__.py` starts the command line for `python -m maester_eval`. |
| Paths | `apps/eval/src/maester_eval/paths.py` | Gives the folders under `data/eval` and the path of the taxonomy. Makes a run folder. Finds a run from `latest`, a name or a path. |
| Manifest | `apps/eval/src/maester_eval/manifest.py` | Reads and checks the manifest. Selects the filings of a set. Lists the filings that are out of scope. |
| Taxonomy | `apps/eval/src/maester_eval/concepts.py` | Reads `packages/contracts/concepts.json`. |
| Runner | `apps/eval/src/maester_eval/runner.py` | `live`: builds the Gemini model and runs `run_extraction` with a model that counts its calls. |
| Artefacts | `apps/eval/src/maester_eval/artefacts.py` | Defines the artefact. Writes and reads the artefacts and `run.json`. |
| Sheets | `apps/eval/src/maester_eval/sheets.py` | `export`: writes the sheets. |
| Gold | `apps/eval/src/maester_eval/gold.py` | `freeze`: reads a sheet and writes a gold file. Reads the gold files. |
| Scorer | `apps/eval/src/maester_eval/scoring.py` | Finds each gold fact among the read facts, compares the values as exact decimals and counts the outcomes. |
| Report | `apps/eval/src/maester_eval/report.py` | Writes `report.md` and `report.json`. |
| Text helper | `apps/eval/src/maester_eval/text.py` | `normalise`: makes lower case, changes `&` to `and`, removes punctuation and joins spaces. It follows `normalise` in `apps/api/src/financials/stitch.ts`. |
| Engine functions | `packages/financial-engine/src/pdf_financial_qa/workflow/` | The harness calls `run_extraction`, `GeminiExtractionModel`, `PdfDocument`, `parse_reported`, `parse_label_date` and `format_decimal`. |
| Tests | `tests/test_eval_*.py`, `tests/test_concepts_json.py` | Offline tests. They make no model call. |

## Operation

### The `live` command

Usage: `maester-eval live [--set <set>] [--only <filing id>] [--label <word>]`. You can repeat `--only`.

1. The harness loads `.env` and checks `--set`. The default is `dev`. If the value is not `dev`, `heldout` or `all`, the harness stops.
2. It reads the manifest and selects the filings of the set, in the order of the manifest. With `--only`, it selects only the filings that you name.
3. If a name is not in the manifest, or the filing is in another set than `--set`, the harness stops.
4. Without `--only`, it does not select a filing that is out of scope. If the set has such filings, it shows `left out as out of scope: <n>`.
5. With `--only`, the harness reads a named filing also when the filing is out of scope.
6. If the corpus does not hold a selected PDF, the harness stops and names the files. If the selection is empty, it stops.
7. It builds the model from `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` and `GEMINI_MODEL`, as the extractor does. If `GOOGLE_CLOUD_PROJECT` has no value, it stops.
8. It reads `EXTRACT_DEADLINE_SECONDS`. If the value is not a number, the harness stops. Thus a wrong value leaves no empty run folder.
9. It makes the run folder in `data/eval/runs`. The name is the UTC start time as `YYYYMMDDTHHMMSSZ`, then `-<label>` if you give `--label`.
10. A label has letters, digits, dots, dashes and underscores only. With any other character the harness stops and makes no folder.
11. The harness shows `run <name>: <n> filing(s), set <set>`. It writes `run.json`.
12. For each filing, in order, it reads the PDF and runs `run_extraction`. It gives the company name of the manifest to the workflow.
13. It shows `<filing id>: reading…` before the workflow starts. After the workflow stops, it shows `<filing id>: <state> in <n>s, <m> model calls`. The state is `complete` or `partial`, or the error code.
14. It writes the artefact before it starts the next filing. If the workflow fails, the artefact holds the error code and no result. The run continues. If the harness cannot write `run.json` or an artefact, it shows `cannot write <path>: <reason>` and stops. The run folder keeps the artefacts that it wrote before.
15. At the end, the harness adds `finished_at` and `model` to `run.json`. It shows `done: <n> read, <m> failed → <run folder>`.

The harness counts the model calls of each kind, and the artefact stores the counts. `locate` finds the pages of the statements. It makes one call for each part of 30 pages if the PDF has more than 60 pages or more than 15 MiB. `extract` reads one statement of one basis. `correct` reads a section again after a failed check.

The workflow limits the work for each filing. If a filing needs more than 40 model calls, the workflow stops with the error `MODEL_CALL_BUDGET_EXCEEDED`. If the time since the start is more than `EXTRACT_DEADLINE_SECONDS`, the workflow stops with the error `DEADLINE_EXCEEDED`.

### The `export` command

Usage: `maester-eval export [--run <run>] [--only <filing id>] [--force]`. You can repeat `--only`.

1. The harness finds the run. The default is `latest`. It reads the artefacts of the run, in the order of the filing ids.
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
3. With `--run`, it finds the run and reads `run.json` and the artefact of the filing. If one of them does not exist, it stops.
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
14. It shows `froze <n> fact(s), <m> expected check(s); <k> row(s) not verified → <path>`.

A sheet row number is the row number in a spreadsheet application. The header is row 1.

A kept row with `yes` or `no` in `adds_up` gives one expected check in the gold file.

### The `report` command

Usage: `maester-eval report [--run <run>] [--set <set>] [--against <run>] [--to <path>]`.

1. The harness loads `.env` and checks `--set`. The default is `all`.
2. It reads the manifest, finds the run, with `latest` as the default, and reads `run.json`. If the manifest, the run or `run.json` does not exist, it stops and writes nothing.
3. It reads the artefacts and the gold files. A run with no artefact gives a report with no filing.
4. It keeps the artefacts and the gold files of the set. It scores each artefact that has a gold file. See "How the harness scores a gold fact".
5. The harness lists a filing under "Not run" if all of these are true:
   - The filing is in the set, it has a gold file and the manifest lists it.
   - The filing is not out of scope.
   - The run has no artefact for the filing.
6. It lists a filing under "No gold yet" if the run has its artefact but no gold file exists. It does not score the filings in these two lists.
7. The harness lists each filing of the set that is out of scope, with the reason of the manifest. It never counts such a filing as not run. If the run read one anyway, and it has a gold file, the harness scores it.
8. With `--against`, it reads and scores the earlier run in the same way. It uses the gold files as they are now. It does this before it writes anything.
9. It writes `report.md` and `report.json` in the run folder. It replaces the files of an earlier report. If it cannot write a file, it shows `cannot write <path>: <reason>` and stops.
10. It shows `<run> (<set>): <n> filing(s), <m> gold fact(s), exact match <rate>, missing <rate>`.
11. If there are filings not run or with no gold yet, it shows `not run: <n>; no gold yet: <m>`. If there are filings out of scope, it shows `out of scope: <n>`. Then it shows `report → <path>`.
12. With `--to`, it copies `report.md` to the path and makes the folders of the path. It shows `published → <path>`.
13. If the copy fails, it shows `cannot write <path>: <reason>` and stops. The report is already written.

### How the harness finds a run

The commands `export`, `freeze` and `report` take a run in `--run`. The command `report` also takes one in `--against`.

- `latest` is the last folder in `data/eval/runs` with a name of the form `YYYYMMDDTHHMMSSZ`, with or without `-<label>`. The harness ignores other folders, for example `archive`.
- A bare name is a folder in `data/eval/runs`. A folder with the same name in the current folder does not count.
- A path is absolute or has a folder part, for example `archive/20261016T093005Z`. It is relative to the current folder, and it can lead to any folder.
- If the harness finds no run, it stops and shows `no runs under <path>` or `no run '<name>' under <path>`.

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

## States and errors

The harness shows an error in red and stops with exit code 1. A message names a filing id, a sheet row, a column, a count or a path. It never shows the label or the value of a fact, because the files hold them. The first table lists the states. The second table lists the errors by command.

| State | Cause | Result |
| --- | --- | --- |
| Outcome `match` | The normalized values agree. Or the gold fact and the read fact are both a dash. | Counted as an exact match. |
| Outcome `wrong_value` | Neither the normalized values nor the values agree. | Listed under Mismatches. |
| Outcome `wrong_scale` | The values agree, but the normalized values differ or the read fact has no scale. | Listed under Mismatches. |
| Outcome `wrong_status` | Only one of the two facts is a dash, or the engine could not read the printed text of the read fact. | Listed under Mismatches. |
| Outcome `ambiguous` | Read facts that fit the gold fact have different values. | Listed under Mismatches. The report shows no read value. Not counted as a match. |
| Outcome `missing` | No read fact fits the gold fact. | Listed under Mismatches. |
| Filing failed | The artefact holds an error code and no result. | Each gold fact of the filing is `missing`. The report shows the error code in the Outcome column. |
| Not run | The filing is in the set, has a gold file and has a manifest entry. It is not out of scope, and the run has no artefact for it. | Listed under Not run. Not scored. |
| No gold yet | The run has an artefact of the set, but no gold file exists. | Listed under No gold yet. Not scored. |
| Out of scope | The manifest gives the filing the field `out_of_scope`. | `live` does not read it unless `--only` names it. `report` lists it under Out of scope. It scores the filing if the run read it. |
| Run stopped early | A person stops `live`, or the computer stops. | The run folder keeps the artefacts that `live` wrote. `run.json` has no `finished_at` and no `model`. The report shows the model as `unknown`. |
| Sheet exists | `export` finds a sheet for the filing. | The harness keeps the sheet. `--force` replaces it. |
| Gold file exists | `freeze` finds a gold file for the filing. | The harness stops. `--force` replaces the file. |

| Error | Cause | Result |
| --- | --- | --- |
| `--set must be dev, heldout or all` | `--set` of `live` or `report` has another value. | Exit code 1. |
| A manifest message | The manifest does not exist (`no manifest at <path>`), is not valid JSON, has a wrong or unknown field, repeats a filing id (`duplicate filing ids: …`), or puts one company or folder in two sets (`each company and corpus folder must be in one set only: …`). | Exit code 1. The message names the problem. |
| `not in the manifest: <ids>` | `--only` of `live` names an id that the manifest does not list. | Exit code 1. |
| `<id> is in set <a>, not <b>` | `--only` of `live` names a filing of another set than `--set`. | Exit code 1. |
| `missing under data/eval/corpus: <files>` | The corpus does not hold a selected PDF. | Exit code 1. No run folder. |
| `nothing to read: the selection is empty` | The set has no filing that is in scope. | Exit code 1. No run folder. |
| `GOOGLE_CLOUD_PROJECT is not set; …` | `live` runs and the variable has no value. | Exit code 1. No run folder. |
| `EXTRACT_DEADLINE_SECONDS: <reason>` | The value is not a number. | Exit code 1. No run folder. |
| `run label '<label>': use letters, digits, dot, dash or underscore` | `--label` has another character. | Exit code 1. No run folder. |
| `no runs under <path>` or `no run '<name>' under <path>` | `--run` or `--against` does not lead to a run. | Exit code 1. |
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
| `cannot write <path>: <reason>` | The harness cannot write a file: `run.json` or an artefact (`live`), a sheet (`export`), a gold file (`freeze`), `report.md` or `report.json` (`report`), or the copy of `report --to`. For example, a file is where the folder must be, you do not have permission, or the disk is full. | Exit code 1. The path is the file that the harness tried to write. The files that the command wrote before stay. A file that it could not replace stays as it was. If the copy of `report --to` fails, the report in the run folder exists. |
| The reason and the path, as the system gives them | The harness cannot read a file, for example the taxonomy or a PDF of the corpus. Or `live` cannot make the run folder. | Exit code 1. |
| A file that does not parse | An artefact, `run.json`, a gold file or the taxonomy is not valid JSON. Or an artefact or a gold file has a field that the harness does not know. | The harness does not catch the error. Python shows a traceback. |

## Data

### What the harness reads

- The file `.env`. The command line loads it with `load_dotenv()` before each command.
- The manifest, for `live`, `freeze` and `report`.
- The PDFs under `data/eval/corpus`, for `live`.
- The run folders under `data/eval/runs`, for `export`, `freeze` and `report`.
- The sheets under `data/eval/sheets`, for `freeze`.
- The gold files under `data/eval/gold`, for `report`.
- The taxonomy, for `freeze`.
- The environment variables in this table:

| Variable | Default | Use |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | No default. `live` stops without it. | The Google Cloud project for Vertex AI. |
| `VERTEX_LOCATION` | `us-central1` | The Vertex AI location. |
| `GEMINI_MODEL` | `gemini-2.5-pro` | The name of the model. |
| `EXTRACT_DEADLINE_SECONDS` | `840` | The time in seconds that the workflow can use for one filing. |

These are the variables of the extractor, with the same defaults. Thus a run measures the configuration that the product runs. The model uses the Application Default Credentials of Google. If the model finds no credentials, each filing fails with the error `EXTRACTOR_NOT_CONFIGURED`.

### What the harness writes

- `run.json` and `artefacts/<filing id>.json` in the run folder, for `live`.
- `data/eval/sheets/<filing id>.csv`, for `export`. The file is UTF-8 text with a byte order mark, so that spreadsheet applications read the text correctly.
- `data/eval/gold/<filing id>.json`, for `freeze`.
- `report.md` and `report.json` in the run folder, for `report`. With `--to`, also a copy of `report.md` at the path that you give.

The harness finds `data/eval` from the repository root, from whichever folder you run it. A path that you give to `--run`, `--against` or `--to` is relative to the current folder.

Git ignores `data/eval/corpus` and `data/eval/runs` (`.gitignore`). It does not ignore the other files. You commit the manifest, the gold files and the reports in `docs/eval`. You decide if you commit the sheets.

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

These rules hold for the whole manifest:

- Each filing id is different.
- A company is in one set only. The harness tells companies apart by `company` after `normalise`, and by the corpus folder, the first part of `file`. Filings with the same company or the same folder must have the same set.
- A manifest that is not valid JSON, or is not UTF-8 text, gives a message and not a traceback.

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

### The run folder

`run.json` holds `run`, `started_at`, `set`, `pipeline_version`, `prompt_version`, `settings` and `filings`. At the end of the run it also holds `finished_at` and `model`. `settings` holds `deadline_seconds` and `max_model_calls`. `filings` lists the ids of the filings that `live` selected.

An artefact holds these fields:

- `filing_id`, `file`, `company`, `kind`, `period_end`, `set`, `stratum` and `printed_pages_per_page`, from the manifest.
- `pipeline_version`, `prompt_version` and `model`: the versions of the workflow and of the prompts, and the name of the model.
- `started_at`, `seconds` and `bytes`: the start time, the time in seconds and the size of the PDF.
- `model_calls`, with the counts `locate`, `extract` and `correct`.
- `pages_without_text`, the page indexes of the pages that have no text layer. It is empty if the PDF does not open.
- `result`, the result of the workflow in the wire format of the extractor, with camelCase names. It is empty if the filing failed.
- `error`, with `code`, `retryable` and `message`. It is empty if the workflow read the filing.

### The gold file

A gold file holds these fields:

- `filing_id`, `file`, `company`, `kind`, `period_end`, `set`, `stratum` and `printed_pages_per_page`, from the manifest.
- `taxonomy_version`, from the taxonomy, and `frozen_at`, the UTC time of the freeze.
- `exported_from`: with `--run`, the `run`, `pipeline_version`, `prompt_version` and `model` of `run.json`. Else it is empty.
- `facts`, the gold facts.
- `expected_checks`: one entry with `concept`, `basis`, `period_label` and `adds_up` for each kept row that has `yes` or `no` in `adds_up`.

A gold fact holds `concept`, `statement`, `basis`, `section`, `label`, `period_label`, `period_end`, `printed`, `value_status`, `value`, `scale`, `normalized_value`, `page_index`, `span`, `dimensions` and `origin`. `period_end` is the date that places the fact: the period end, or the as-at date of a row of the balance sheet. It can be empty. `value_status` is `value` or `dash`. `page_index` counts from 0.

`span` is `gold_span`, or else the `span` of the sheet row. It is empty for a row of the balance sheet. `dimensions` has no entry in this version. `origin` is `sheet` or `settled`. The default is `sheet`: a person labelled the fact from a sheet. `freeze` writes `sheet` only.

### The report

`report.md` has these parts, in this order:

1. The title `Evaluation report: <run>`, and a line with the set, the UTC time, and the pipeline version, the prompt version and the model of the run. The line shows `unknown` for a version that `run.json` does not hold.
2. Summary: the count and the rate of each measure. The measures are Filings, Read, Failed, Gold facts, the six outcomes, Page match, Checks passed, Checks failed and Checks not checked. The median and the maximum of the seconds and of the model calls for each filing follow.
3. `Against <run>`, only with `--against`: a table with nine rows, the six outcomes, Page match, Checks passed and Checks failed. Each row gives the rate for this run, the rate for the earlier run and the change in percentage points.
4. By kind, By scanned, By basis, By statement and By stratum. Each table has the columns Filings, Gold facts, Exact match, Missing and Page match. The harness leaves out a table that has no row.
5. Filings: one row for each scored filing, with the columns Kind, Scanned, Outcome, Gold facts, Exact match, Seconds, Model calls, Size (MB) and Stratum.
6. Not run, No gold yet and Out of scope: a list for each, only if it has an entry. An out-of-scope entry shows the reason of the manifest.
7. Mismatches: one row for each gold fact that is not an exact match, or `None.`

A rate is a count divided by its own total, as a percentage rounded down to one decimal. Thus only 100.0% means that all agree. A rate with no total shows `—`.

The outcomes use the gold facts as the total. Read and Failed use the filings. Page match uses the found facts. The checks use all checks. The tables By basis and By statement count facts, thus their Filings cell shows `—`.

The report marks a filing as scanned if a page where the workflow found a statement has no text layer. For a filing that failed, it marks the filing as scanned if any page has no text layer. The column Outcome of the Filings table is different: it shows the `state` of the result of the filing, or its error code. A fact that is `missing` or `ambiguous` shows `—` as the read text in Mismatches.

`report.json` holds `generated_at`, `against`, `summary`, `strata` and `score`.

### What the harness sends to Google

`live` sends the bytes of each selected PDF to the model, in the requests of the workflow. The other commands send nothing.

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

5. Read the state or the error code in the line of each filing.

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
7. To replace a gold file, run the command again with `--force`.

### To make a report

1. Run `report` for a run and a set:

   ```bash
   uv run --locked maester-eval report --run latest --set dev
   ```

2. Open `report.md` in the run folder.
3. To see the change against an earlier run, add `--against` and the name of that run.
4. To copy the report to a path, add `--to` and the path:

   ```bash
   uv run --locked maester-eval report --run latest --set dev --to docs/eval/2026-10-16-baseline.md
   ```

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

WARNING: Use `--only` to read one filing first. `live` can cause charges to your Google Cloud project.

CAUTION: Use `export --force` only to replace a sheet on purpose. It writes over the sheet, and you lose the corrections in it.

CAUTION: Use `freeze --force` only to replace a gold file on purpose. It writes over the file, and you lose the earlier facts.

CAUTION: Do not tune a prompt or a rule on the `heldout` set. Run it only to decide if a change lands.

## Limits

- The harness finds a gold fact by its printed words: the statement, the basis, the section, the label and the period label. A read fact with another label is `missing`, also when its value is right. It does not use the concept or the date. Phase 1 adds a way to find a gold fact by its concept.
- A gold fact has a `span`, but it has no `dimensions` yet. The gold files hold facts of the three statements only.
- `freeze` writes `adds_up` as an expected check. The report does not use the expected checks. It counts the checks that the workflow ran.
- The harness has the `live` mode only. It has no `replay` mode, thus every run calls the model. Phase 1 adds `replay`.
- The harness does not run classification. The kind of a filing comes from the manifest.
- `live` reads the filings one at a time.

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
- [`apps/eval/pyproject.toml`](../../apps/eval/pyproject.toml)
- [`apps/eval/README.md`](../../apps/eval/README.md)
- [`packages/contracts/concepts.json`](../../packages/contracts/concepts.json)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/runner.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/runner.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/values.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/values.py)
- [`tests/test_eval_cli.py`](../../tests/test_eval_cli.py), [`tests/test_eval_live.py`](../../tests/test_eval_live.py), [`tests/test_eval_manifest.py`](../../tests/test_eval_manifest.py), [`tests/test_eval_sheets.py`](../../tests/test_eval_sheets.py), [`tests/test_eval_gold.py`](../../tests/test_eval_gold.py), [`tests/test_eval_scoring.py`](../../tests/test_eval_scoring.py), [`tests/test_eval_report.py`](../../tests/test_eval_report.py)
- [`.gitignore`](../../.gitignore)
- [`docs/superpowers/specs/2026-10-15-financial-data-layer-design.md`](../superpowers/specs/2026-10-15-financial-data-layer-design.md), section 9
- [`docs/superpowers/plans/2026-10-15-eval-baseline.md`](../superpowers/plans/2026-10-15-eval-baseline.md)
