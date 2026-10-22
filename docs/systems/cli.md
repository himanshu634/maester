# Maester CLI: system description

This document describes the Python command-line application in `apps/cli`. For the full system, read the [Maester overview](maester.md). For the shared Python package, read [Packages](packages.md).

## Terms

| Term | Meaning in this document |
| --- | --- |
| CLI | The Python command-line application in `apps/cli`. Its distribution name is `maester-cli`. |
| command | A program or subcommand that you start from a terminal. The CLI has three commands: `ingest`, `ask` and `list-docs`. |
| engine | The Python package in `packages/financial-engine`. Its distribution name is `maester-financial-engine`. Its import name is `pdf_financial_qa`. |
| model | The Gemini model on Vertex AI that the engine calls. The `GEMINI_MODEL` variable gives its name. |
| settings | The `Settings` object of the engine. It holds the Google Cloud project, the Vertex AI location and the name of the model. |
| hash | The first 16 hexadecimal characters of the SHA-256 digest of the PDF bytes. |
| statement | One `FinancialStatement` object: the line items of the financial statements, with the periods, the units and a scale factor. |
| full text | The `full_text` field: a Markdown copy of the full PDF that the model writes. |
| consistency warning | One line of text from `validate_statement` that tells about a failed arithmetic check. The code keeps these lines in `validation_warnings`. |
| result | One `ExtractionResult` object. It holds the hash, the file name, the statement, the full text and the consistency warnings. |
| cache | The folder `data/cache` and its JSON files. Each file holds one result. |
| exit code | The number that a command gives to the shell when it stops. 0 means success. |

## Function

The CLI gets structured data from the PDF of a company's financial statements, and then answers questions about that PDF. A person runs it on a local computer, in a terminal. It gives three commands:

- `ingest` sends a PDF to the model, checks the result and saves the result in the cache.
- `ask` sends one result and a question to the model, and shows the answer. It first writes a warning on standard error. The warning tells you to use the MCP server.
- `list-docs` shows the results in the cache.

The CLI owns only the command arguments and the terminal output. The engine does the extraction, the arithmetic checks, the cache and the questions. The CLI has no connection to the API, the worker or the database of the TypeScript platform.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| `app` (a Typer application) | `apps/cli/src/maester_cli/cli.py` | Defines the three commands and their options. Writes all output to the terminal with Rich. |
| `__main__` module | `apps/cli/src/maester_cli/__main__.py` | Starts `app` when you run `python -m maester_cli`. |
| Console scripts | `apps/cli/pyproject.toml` | Installs two shell commands, `maester` and `pdf-financial-qa`. Both start the same `app`. |
| `Settings` and constants | `packages/financial-engine/src/pdf_financial_qa/config.py` | Reads the environment variables. Holds `CACHE_DIR` (`data/cache`) and `MAX_INLINE_PDF_BYTES` (15 MiB). |
| `extract` | `packages/financial-engine/src/pdf_financial_qa/extraction.py` | Sends the PDF to the model. Gets the statement and the full text. Then calls `validate_statement`. |
| `validate_statement` | `packages/financial-engine/src/pdf_financial_qa/validation.py` | Does arithmetic checks on the statement. Returns the consistency warnings. |
| `ask` (in the engine) | `packages/financial-engine/src/pdf_financial_qa/qa.py` | Sends one result and the question to the model. Returns the text of the answer. |
| `hash_pdf`, `load`, `save`, `list_cached` | `packages/financial-engine/src/pdf_financial_qa/storage.py` | Calculate the hash. Read and write the cache. |
| Pydantic classes | `packages/financial-engine/src/pdf_financial_qa/schema.py` | Define the fields of the result and the statement. |
| Tests | `tests/test_monorepo.py` | 17 offline tests for the CLI and for the engine parts in this table. |

## Operation

### The `ingest` command

Usage: `maester ingest <pdf_path> [--force]`.

1. The CLI checks that the file at `pdf_path` exists. If the file does not exist, the CLI stops with exit code 1 (`cli.py:38-40`).
2. The CLI loads the settings. If `GOOGLE_CLOUD_PROJECT` has no value, the CLI shows the error and stops with exit code 1 (`cli.py:27-32`, `config.py:25-34`).
3. If you do not give `--force`, the CLI calculates the hash of the file and reads `data/cache/<hash>.json` (`cli.py:44-52`).
4. If that cache file exists, the CLI shows `Already ingested as <hash>` and the consistency warnings of that result. Then it stops with exit code 0 and does not call the model.
5. The `extract` function of the engine reads the PDF. If the PDF is larger than 15 MiB, it raises `ValueError` (`extraction.py:40-48`).
6. `extract` sends the PDF bytes and a system instruction to the model in one request. The terminal shows `Extracting <file> via <model>...` until the model replies (`cli.py:54-55`).
7. The model returns the statement and the full text as JSON, in the shape of `GeminiExtractionOutput` (`extraction.py:57-70`).
8. `validate_statement` does two checks on each period of the statement (`validation.py:25-95`):
   - Each subtotal is equal to the sum of its component line items.
   - Total assets are equal to total liabilities plus total equity.

   If a subtotal names a line item that is not in its section, `validate_statement` gives a consistency warning. If it finds total assets but no total liabilities or no total equity, it also gives a consistency warning. If it finds no total assets, it does not do the second check.
9. The checks ignore a difference of 1.0 or less. They also ignore a difference of 0.5% or less of the larger value (`validation.py:13-18`).
10. `save` writes the result to `data/cache/<hash>.json`. It makes the folder if necessary and replaces a file that has the same name (`storage.py:25-29`).
11. The CLI shows the path of the cache file and the hash. Then it shows each consistency warning (`cli.py:57-59`).
12. If there are no consistency warnings, the CLI shows `Consistency checks passed (balance sheet identity, subtotals).` (`cli.py:116-122`).

### The `ask` command

Usage: `maester ask "<question>" [--doc <hash>]`.

1. The CLI writes the deprecation warning to standard error, in yellow (`cli.py:19-24`, `cli.py:70-71`). It is the first output of the command, before the settings load. The text of the warning is in the code block after this list.
2. The CLI loads the settings. If `GOOGLE_CLOUD_PROJECT` has no value, the CLI stops with exit code 1 (`cli.py:72`).
3. `list_cached` reads and parses each JSON file in the cache (`storage.py:32-39`). If the cache is empty, the CLI stops with exit code 1 (`cli.py:74-77`).
4. The CLI selects one result (`cli.py:79-91`):
   - If you give `--doc`, the CLI loads the result with that hash. If no cache file has that hash, the CLI stops with exit code 1.
   - If you do not give `--doc` and the cache has one result, the CLI uses that result.
   - If you do not give `--doc` and the cache has two or more results, the CLI shows the table of results. Then it stops with exit code 1.
5. The `ask` function of the engine sends one request to the model (`qa.py:28-42`). The request contains the statement as JSON, the consistency warnings, the full text and the question.
6. The system instruction of the request tells the model to use only this data. It also tells the model to say when the data has no answer (`qa.py:9-25`).
7. The terminal shows `Thinking...` until the model replies. Then the CLI shows the text of the answer (`cli.py:93-96`).

The text of the deprecation warning is:

```text
`maester ask` is deprecated: connect an agent to Maester's MCP server instead (see docs/DEVELOPMENT.md). It is removed once the server calculates.
```

### The `list-docs` command

Usage: `maester list-docs`.

1. `list_cached` reads each JSON file in the cache, in the order of the file names (`storage.py:32-39`).
2. If the cache is empty, the CLI shows `No documents ingested yet.` and stops with exit code 0 (`cli.py:102-105`).
3. If the cache has results, the CLI shows a table with three columns: `Hash`, `File` and `Warnings`. The `Warnings` column gives the number of consistency warnings (`cli.py:109-113`).

The `list-docs` command does not load the settings. Thus it operates without a Google Cloud project (`tests/test_monorepo.py:93-97`).

## States and errors

The CLI shows an error in red, a consistency warning in yellow and a success message in green. The words of the message give the state. The CLI catches only the errors in this table that have an exit code.

| State or error | Cause | Result |
| --- | --- | --- |
| `No such file: <path>` | The `pdf_path` of `ingest` does not exist. | Exit code 1. The CLI does not load the settings. |
| `GOOGLE_CLOUD_PROJECT is not set. …` | You run `ingest` or `ask`, and `GOOGLE_CLOUD_PROJECT` has no value. | Exit code 1. In `ask`, this check comes before the check of the cache. |
| `Already ingested as <hash> — use --force to re-extract.` | The cache has a result with the same hash, and you did not give `--force`. | Exit code 0. The CLI does not call the model. It shows the consistency warnings from the cache. |
| The deprecation warning | You run `ask`. | The CLI writes the warning to standard error before all other output. The command then continues as before. The warning does not change the exit code. |
| `No documents ingested yet. Run …` | You run `ask`, and the cache is empty. | Exit code 1. |
| `No cached document with hash '<hash>'.` | The value of `--doc` is not a hash in the cache. | Exit code 1. |
| `Multiple documents are cached — pass --doc <hash> to pick one.` | You run `ask` without `--doc`, and the cache has two or more results. | Exit code 1. The CLI shows the table of results. |
| `No documents ingested yet.` | You run `list-docs`, and the cache is empty. | Exit code 0. |
| `<n> consistency warning(s):` | `validate_statement` finds one or more failed checks. | The CLI shows each consistency warning. The result goes into the cache with its consistency warnings. The `ask` request also sends them to the model. |
| `ValueError: PDF is … over the 15 MB inline limit …` | The PDF is larger than 15 MiB (15 × 1024 × 1024 bytes). | The CLI does not catch the error. Python shows a traceback. No request goes to the model. |
| An error from Vertex AI or from the network | Not known. The code of the CLI and the engine names no such error. | The CLI does not catch the error. Python shows a traceback. |
| A cache file that does not parse | `model_validate_json` cannot read a JSON file in the cache as a result. | The CLI does not catch the error. `ask` and `list-docs` stop with a traceback, also when you give `--doc`. |

## Data

### What the CLI reads

- The PDF file at `pdf_path`, for the `ingest` command.
- The JSON files in `data/cache`, for all three commands.
- The `.env` file. When Python imports `config.py`, `config.py` calls `load_dotenv()` from `python-dotenv`. This occurs before each command runs (`config.py:6-8`).
- The environment variables in this table (`config.py:25-34`):

| Variable | Default | Use |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | No default. `ingest` and `ask` stop without it. | The Google Cloud project for Vertex AI. |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | The Vertex AI location. |
| `GEMINI_MODEL` | `gemini-2.5-pro` | The name of the model. |

The engine gives no key to `genai.Client` (`extraction.py:55`, `qa.py:29`). The repository docs tell you to use Application Default Credentials, or a key file in `GOOGLE_APPLICATION_CREDENTIALS` (`.env.example`).

### What the CLI writes

- One file for each result: `data/cache/<hash>.json`. The path is relative to the folder where you run the command (`config.py:15`, `storage.py:14-15`).
- The JSON fields are `source_pdf_hash`, `source_pdf_name`, `statement`, `full_text` and `validation_warnings`, with an indent of 2 (`schema.py:48-55`).
- A cache file without `validation_warnings` is also valid. The engine reads it as a result with no consistency warnings (`tests/test_monorepo.py:86-91`).
- Git ignores `data/cache/*`, but it keeps `data/cache/.gitkeep`. Git also ignores `.env` (`.gitignore:1-5`).

The hash comes from the bytes of the file only. Thus two files with the same bytes get the same hash, and the same cache file.

### What the CLI sends to Google

- `ingest` sends the full PDF bytes to the `generate_content` function of Vertex AI (`extraction.py:55-68`).
- `ask` sends the statement, the consistency warnings, the full text and the question (`qa.py:31-41`).

## Procedures

Run all the commands from the repository root. The path of the cache is relative to the current folder.

### To install the CLI with uv

1. Install Python 3.11 or a later version.
2. Install uv.
3. Open a terminal in the repository root.
4. Install the workspace from the lock file:

   ```bash
   uv sync --locked
   ```

Note: `make sync` runs the same command. The `Makefile` also sets `UV_CACHE_DIR` to `.uv-cache` in the repository, if it has no value.

### To install the CLI without uv

1. If your environment has an older `pdf-financial-qa` distribution, uninstall it.
2. Make a virtual environment:

   ```bash
   python -m venv .venv
   ```

3. Activate the virtual environment:

   ```bash
   source .venv/bin/activate
   ```

4. Install the engine and the CLI:

   ```bash
   python -m pip install -e ./packages/financial-engine -e ./apps/cli
   ```

Note: this path does not use `uv.lock`.

### To prepare the Google Cloud settings

You must do this procedure before you use `ingest` or `ask`.

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. In `.env`, set `GOOGLE_CLOUD_PROJECT` to the ID of your Google Cloud project.
3. If your project cannot use `gemini-2.5-pro`, set `GEMINI_MODEL` to a different model name.
4. Log in with Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

### To show the help

1. Show the list of commands:

   ```bash
   uv run --locked maester --help
   ```

2. To see the options of one command, add the command name before `--help`:

   ```bash
   uv run --locked maester ingest --help
   ```

Note: `make cli` runs `uv run --locked maester --help`. The `pdf-financial-qa` command and `python -m maester_cli` start the same CLI.

### To get the data from a PDF

WARNING: Use only a PDF that you can send to Google. The `ingest` and `ask` commands send private data to Vertex AI. Each call can cause charges.

1. Do the procedure "To prepare the Google Cloud settings".
2. Run the `ingest` command with the path of the PDF:

   ```bash
   uv run --locked maester ingest path/to/statement.pdf
   ```

3. Read each consistency warning in the output.

CAUTION: The `--force` option replaces the cache file of that PDF. You lose the earlier result.

4. To send the same PDF to the model again, add `--force`:

   ```bash
   uv run --locked maester ingest path/to/statement.pdf --force
   ```

### To list the results in the cache

1. Run the `list-docs` command:

   ```bash
   uv run --locked maester list-docs
   ```

### To ask a question

WARNING: Use only a PDF that you can send to Google. The `ingest` and `ask` commands send private data to Vertex AI. Each call can cause charges.

1. Do the procedure "To prepare the Google Cloud settings".
2. Run `list-docs`.
3. Copy the hash of the result that you want.
4. Run the `ask` command with the question and the hash:

   ```bash
   uv run --locked maester ask "What were total assets?" --doc <hash>
   ```

Note: if the cache has only one result, you can run `ask` without `--doc`.

### To run the tests

1. Run the tests for the CLI and its engine parts:

   ```bash
   uv run --locked python -m unittest tests.test_monorepo -v
   ```

2. Make sure that the output shows `OK`.

Note: these 17 tests do not call Vertex AI (`tests/test_monorepo.py:1`). `make test` runs all the Python tests in `tests/`. `make check` also runs `scripts/check_workspace.py` before the tests. The GitHub workflow runs the same commands on Python 3.11 and 3.14.

## Warnings and cautions

WARNING: Use only a PDF that you can send to Google. The `ingest` command sends the full PDF to Vertex AI. The `ask` command sends the full text of the PDF. Each call can cause charges to the Google Cloud project.

CAUTION: Use `--force` only when you want to replace the result. The `ingest --force` command writes over the cache file that has the same hash. You lose the earlier result.

## Limits

- The CLI sends a PDF in one request, and only up to 15 MiB. It cannot divide a PDF into batches of pages (`extraction.py:40-48`).
- The code does not measure if the full text is complete. A long PDF can be too large for the output limit of the model (`docs/DEVELOPMENT.md` section 14).
- The checks find line items through the words in their labels. A component with no value for a period counts as zero (`validation.py:1-9`, `validation.py:38-41`).
- A clean check is not proof that the extraction is correct (`validation.py:1-9`).
- The MCP server in [`apps/mcp`](mcp.md) replaces `ask`. The CLI loses `ask` when the server gets named calculations.
- The answers of `ask` come from the model, with no fixed calculation and no check of citations (`qa.py`, `docs/DEVELOPMENT.md` section 14).
- The `ask` command uses one result for each question. It cannot use two or more results together (`cli.py:79-91`).
- The hash has only 16 characters. The cache has no version field, no tenant boundary and no control of concurrent writes (`storage.py`, `docs/DEVELOPMENT.md` section 14).
- The CLI has no command to delete a result from the cache (`cli.py`).

## Sources

- [apps/cli/src/maester_cli/cli.py](../../apps/cli/src/maester_cli/cli.py)
- [apps/cli/src/maester_cli/\_\_main\_\_.py](../../apps/cli/src/maester_cli/__main__.py)
- [apps/cli/pyproject.toml](../../apps/cli/pyproject.toml)
- [apps/cli/README.md](../../apps/cli/README.md)
- [MCP server design](../superpowers/specs/2026-10-21-mcp-server-design.md)
- [packages/financial-engine/src/pdf_financial_qa/config.py](../../packages/financial-engine/src/pdf_financial_qa/config.py)
- [packages/financial-engine/src/pdf_financial_qa/extraction.py](../../packages/financial-engine/src/pdf_financial_qa/extraction.py)
- [packages/financial-engine/src/pdf_financial_qa/qa.py](../../packages/financial-engine/src/pdf_financial_qa/qa.py)
- [packages/financial-engine/src/pdf_financial_qa/storage.py](../../packages/financial-engine/src/pdf_financial_qa/storage.py)
- [packages/financial-engine/src/pdf_financial_qa/validation.py](../../packages/financial-engine/src/pdf_financial_qa/validation.py)
- [packages/financial-engine/src/pdf_financial_qa/schema.py](../../packages/financial-engine/src/pdf_financial_qa/schema.py)
- [tests/test_monorepo.py](../../tests/test_monorepo.py)
- [pyproject.toml](../../pyproject.toml)
- [Makefile](../../Makefile)
- [.env.example](../../.env.example)
- [.gitignore](../../.gitignore)
- [.github/workflows/check.yml](../../.github/workflows/check.yml)
- [docs/DEVELOPMENT.md](../DEVELOPMENT.md), sections 9, 12 and 14
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
