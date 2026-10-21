# Extractor: system description

This document describes `apps/extractor`, the Python service that reads financial documents. It is for a developer who is new to this repository. For the full system, read the [Maester overview](maester.md). For the service that calls the extractor, read the [worker description](worker.md). For the shared code, read the [packages description](packages.md).

## Terms

| Term | Meaning |
| --- | --- |
| extractor | The Python HTTP service in `apps/extractor`. |
| worker | The TypeScript service in `apps/worker`. It sends requests to the extractor. |
| engine | The Python package in `packages/financial-engine`. Its import name is `pdf_financial_qa`. It holds the workflow, the classifier and the rules. |
| model | Gemini, a large language model from Google, on Vertex AI. The engine gets access to it through `langchain-google-genai`. |
| model call | One request from the engine to the model. |
| classification | The answer to the question "What type of document is this PDF?". The `/v1/classify` route returns it. |
| extraction | The values of the financial statements in a PDF, as facts. The `/v1/extract` route returns it. |
| workflow | The LangGraph graph that makes the extraction. The function `run_extraction` starts it. |
| branch | The part of the workflow that reads one statement. Each branch is a LangGraph subgraph. |
| coverage entry | One entry in the `coverage` list of an extraction result. It has a statement, its basis, its page indexes and the status `extracted` or `failed`. |
| transient error | An error that can go away if the engine tries again. The function `is_transient` in `errors.py` decides. |
| statement | One financial statement: `balance_sheet`, `income_statement` or `cash_flow`. |
| basis | The scope of a statement: `consolidated`, `standalone` or `unknown`. |
| excerpt | A new PDF that holds only some pages of the original PDF. |
| page index | The position of a page in the original PDF. The first page has the page index 0. |
| page number | The position of a page in the PDF that the model gets. The first page has the page number 1. |
| text layer | The text that `pypdf` can get from a page. |
| scanned page | A page with an empty text layer. |
| fact | One value of one line item for one period. |
| check | An arithmetic test on a statement. The two types are `subtotal` and `balance_identity`. |
| quote | The exact words on a page that show a classification answer. The maximum length is 300 characters. |
| evidence | A record of the source of one classification answer: the field, the source, the page index, the quote and the text-layer result. |
| event | One line of the NDJSON stream that `/v1/extract` returns. |
| result warning | One entry in the `warnings` list of a result. It has a `code` and a `message`. A result warning does not stop the request. |
| error | A response that has a `code`, a `retryable` value and a `message`, and no result. |
| classifier | The function `run_classification` in the engine. It makes the classification. |
| secret | The value of `EXTRACTOR_SECRET`. The worker sends it in the `x-extractor-secret` header. |
| XBRL instance | An XML file in the XBRL 2.1 format. Its facts are the numbers of a results filing. |
| format | The kind of an XBRL instance, as `<family>/<kind>`. The families are `in-capmkt` and `in-bse-fin`. The kinds are `ind_as`, `banking`, `nbfc`, `other_than_ind_as` and `unknown`. |
| element map | A reviewed JSON file in `pdf_financial_qa/xbrl/maps`. It says which element of a format is which line of which statement. |
| mapped format | A format that has an element map. Only `in-capmkt/ind_as` and `in-bse-fin/ind_as` are mapped. |
| XBRL mode | One of `classify`, `read` and `text`. The header `x-xbrl-mode` of `/v1/xbrl` names it. |
| PDF check | The `xbrl_in_pdf` check. It looks for each XBRL value on the statement pages of a results PDF. |

## Function

The extractor reads financial documents in PDF format for the worker. It does two tasks:

- Classification: it finds the type of document, the company, the company identifiers, the period and the statements.
- Extraction: it reads each statement into facts and does arithmetic checks on the facts.

The extractor also reads XBRL instances. This reading uses no model and costs nothing. It does three tasks:

- Classification: it finds the format, the company identifiers, the basis, the period and the statements from the elements of the instance.
- Reading: it writes each line of a mapped format as a fact, with its span, its period, its unit and its element. It also does the sum checks.
- Text: it turns the long notes of the instance into plain text for the index.

A fourth route compares the facts of an instance with a results PDF. It is the PDF check.

For each answer and each fact from a PDF, the extractor records the page index of its source. The extractor stores nothing. It has no access to the database or to object storage. The worker sends the PDF in the request body and writes the result to the database.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| HTTP app | `apps/extractor/src/maester_extractor/app.py` | Defines the routes, the secret comparison, the body limit and the event stream. |
| Settings | `apps/extractor/src/maester_extractor/settings.py` | Reads the configuration from environment variables. |
| Entry point | `apps/extractor/src/maester_extractor/__main__.py` | Starts `uvicorn`. The command `maester-extractor` runs it. |
| Container | `apps/extractor/Dockerfile` | Builds an image with Python 3.12. The image runs `maester-extractor` as the user `app` on port 8790. |
| Workflow | `packages/financial-engine/src/pdf_financial_qa/workflow/runner.py` | Holds the LangGraph graph, the model call budget and `run_extraction`. |
| Extraction model | `pdf_financial_qa/workflow/model.py` | Holds `GeminiExtractionModel` with its three model calls: `locate`, `extract` and `correct`. |
| Extraction prompts | `pdf_financial_qa/workflow/prompts.py` | Holds the prompt texts and `PROMPT_VERSION`. |
| PDF access | `pdf_financial_qa/workflow/pdf.py` | Opens the PDF, gets the text layer of each page and makes excerpts. |
| Value rules | `pdf_financial_qa/workflow/values.py` | Parses printed values, unit labels and dates. Compares a value with the text layer. |
| Checks | `pdf_financial_qa/workflow/drafts.py` | Does the `subtotal` and `balance_identity` checks. |
| Errors | `pdf_financial_qa/workflow/errors.py` | Defines `ExtractionError` and the list of transient errors. |
| Wire format | `pdf_financial_qa/workflow/contracts.py`, `pdf_financial_qa/classify/contracts.py` | Pydantic classes of the events, the results and the errors. |
| Classifier | `pdf_financial_qa/classify/runner.py` | Holds `run_classification`. It uses the rules first and the model for open questions. |
| Classification rules | `pdf_financial_qa/classify/rules.py` | Regular expressions that find answers in the text layer. |
| Classification model | `pdf_financial_qa/classify/model.py`, `pdf_financial_qa/classify/prompts.py` | Holds `GeminiClassificationModel` and its prompt. |
| XBRL parser | `pdf_financial_qa/xbrl/parser.py` | Reads an instance with `lxml` and hard limits. It refuses a DOCTYPE. |
| XBRL format | `pdf_financial_qa/xbrl/formats.py`, `formats.json` | Finds the family and the kind of an instance from its elements. |
| XBRL classification | `pdf_financial_qa/xbrl/classify.py`, `identity.py` | Answers the classification questions from the identity facts. |
| XBRL read | `pdf_financial_qa/xbrl/read.py`, `units.py`, `periods.py` | Writes the facts of a mapped format. Sets the unit, the span and the period of each fact. |
| XBRL maps | `pdf_financial_qa/xbrl/maps.py`, `maps/*.json`, `maps/README.md` | Loads the element maps. The README says how each map was made and checked. |
| XBRL checks | `pdf_financial_qa/xbrl/checks.py` | Checks each sum of the map and the balance identity. |
| XBRL text | `pdf_financial_qa/xbrl/text.py` | Turns the text blocks of an instance into plain text. |
| XBRL PDF check | `pdf_financial_qa/xbrl/pdf_check.py` | Runs `check_xbrl_in_pdf`. |
| XBRL wire format | `pdf_financial_qa/xbrl/contracts.py` | Pydantic classes of the XBRL events and of the PDF check. The Zod twin is `packages/contracts/src/xbrl.ts`. |
| Tests | `tests/test_extractor_xbrl.py`, `tests/test_xbrl_*.py`, `tests/test_extractor_service.py`, `tests/test_extraction_*.py`, `tests/test_classification_*.py` | Offline unit tests for the extractor and the engine. |

## Operation

### Start

1. The command `maester-extractor` runs `main`. `main` loads the `.env` file, sets the log level to `INFO` and starts `uvicorn` on `0.0.0.0` and `PORT`.
2. `create_app` reads the settings with `Settings.from_env`.
3. `create_app` sets `LANGSMITH_TRACING` and `LANGCHAIN_TRACING_V2` to `false`. Thus no document content goes to LangSmith.
4. If `EXTRACTOR_SECRET` has no value, the extractor writes a log message at the level `WARNING`. Then it accepts all requests without a secret.
5. The extractor does not connect to the model at start. It makes the model object at the first request that needs it, and keeps it for later requests.
6. Before it makes the model object, `_vertex_factory` looks for `GOOGLE_CLOUD_PROJECT` and the Application Default Credentials of Google. If one of the two is not available, it raises `ExtractionError` with the code `EXTRACTOR_NOT_CONFIGURED`.

### Routes

| Route | Request | Response |
| --- | --- | --- |
| `GET /healthz` | No body. | `200` with `{"status":"ok"}`. |
| `POST /v1/classify` | The PDF as the body. Optional header `x-document-id`. | `200` with one JSON body: `{"type":"result","result":{…}}` or `{"type":"error",…}`. |
| `POST /v1/extract` | The PDF as the body. Optional headers `x-document-id` and `x-company-name`. | `200` with an `application/x-ndjson` stream of events. |
| `POST /v1/xbrl` | The XBRL instance as the body. The header `x-xbrl-mode` is `classify`, `read` or `text`. Optional header `x-document-id`. | `200` with an `application/x-ndjson` stream of events. |
| `POST /v1/xbrl/pdf-check` | `multipart/form-data` with a `pdf` file and a `request` JSON part. Optional header `x-document-id`. | `200` with one JSON body: the check result, or `{"type":"error",…}`. |

The three `POST` routes of the PDF and the two XBRL routes do the first step before their own work. The PDF routes also do the two other steps:

1. The `authenticate` dependency compares `x-extractor-secret` with the secret. It uses `hmac.compare_digest`. If the secret has a value and the two values are different, the response is `401` with the code `EXTRACTOR_UNAUTHORIZED`.
2. The `pdf_body` dependency reads the body. If `content-length` or the body is larger than `EXTRACT_MAX_BYTES`, the response is `413` with the code `TOO_LARGE_FOR_EXTRACTION`.
3. If the body is empty, the response is `400` with the code `EMPTY_BODY`.

The extractor uses `x-document-id` only in log messages. The JSON field names on the wire are camelCase, for example `pageIndex` and `textLayerMatch`.

### Classification

1. `classify` runs `run_classification` in a separate thread.
2. `PdfDocument.load` opens the PDF and gets the text layer of each page.
3. `classify_text` applies the rules to the text layers. The rules look for these answers:
   - The CIN, the BSE code and the NSE symbol.
   - The company name, on one of the first 5 pages.
   - The statements and their pages.
   - The type of document, from a title on one of the first 5 pages.
   - The period. For financial results, also the results span.
4. Each rule hit records the rule ID, the page index and a quote. If two rules give different types of document, the rules leave the type open.
5. `_questions` makes a list of the questions that the rules did not answer. If the rules found a statement, the model can only answer `annual_report` or `financial_results` for the type.
6. If the list has questions, the classifier makes an excerpt. The excerpt holds the first 5 pages and the pages with rule evidence, with a maximum of 10 pages.
7. The classifier sends the excerpt and the questions to the model in one model call. The model is `GEMINI_CLASSIFY_MODEL`.
8. If the model call fails with a transient error, the classifier waits 1 second and tries one more time.
9. `_apply` keeps a model answer only if all of these conditions are true:
   - The classifier asked the question, and no earlier answer settled the same field.
   - The value is one of the permitted values, or the question accepts free text.
   - The page number is in the excerpt.
   - The quote is on that page, or the page is a scanned page. The comparison ignores case and whitespace.
   - For `company` and `period`, the value is in the quote.
10. If `_apply` drops one or more answers, the classifier adds the result warning `MODEL_ANSWER_DROPPED`.
11. If the model is not available or the model call fails, the classifier keeps only the rule answers. It adds the result warning `MODEL_UNAVAILABLE`. A model failure does not stop the classification.
12. If no answer gives the type, the type is `not_sure`. If the type is `other` and no answer gives `other_type`, `other_type` is `unlisted_type`.
13. The extractor returns the `ClassificationResult` in one JSON body.

### Extraction

The function `extract` in `app.py` is the route for `/v1/extract`. This section calls it "the route". It is not the `extract` node of the workflow.

1. The route decodes the URI-encoded `x-company-name` header, if the request has it.
2. The route gets the model object. If the route cannot get it, the route sends a `started` event and an `error` event, and stops.
3. The route sends a `started` event with `pipelineVersion`, `model` and `promptVersion`.
4. The route runs `run_extraction` in a separate thread.
5. When a workflow node finishes, the route sends a `progress` event with the stage and a percent value.
6. If no `progress` event and no result come in `EXTRACT_HEARTBEAT_SECONDS`, the route sends a `heartbeat` event.
7. At the end, the route sends one `result` event or one `error` event. Then the stream stops.
8. When the stream stops for any cause, the route sets a cancel signal. The workflow then stops before its next model call.

The percent values are: `prepare` 5, `locate` 20, each `statement` from 20 to 90, and `assemble` 100.

### Workflow

The workflow has two levels. The main graph is `prepare`, `locate`, one `statement` branch for each statement, and `assemble`. Each `statement` branch is a subgraph: `extract`, `check`, and then `correct` and `check` again, if a check failed.

1. `prepare` opens the PDF with `pypdf` and gets the text layer of each page. If `pypdf` cannot get the text of a page, the workflow uses an empty text layer for that page.
2. The workflow stops with the error `UNREADABLE_PDF` in these conditions:
   - `pypdf` cannot open the PDF.
   - An empty password does not decrypt the PDF.
   - The PDF has no pages.
3. `locate` sends the PDF to the model. The model returns the statements, their basis, their page numbers and the company name as printed.
4. If the PDF is larger than 15 MiB or has more than 60 pages, `locate` sends excerpts of 30 pages, one after the other.
5. `locate` changes each page number to a page index. It ignores a page number outside the excerpt and adds the result warning `LOCATE_PAGE_OUT_OF_RANGE`.
6. If `locate` finds no statement, the workflow stops with the error `NO_STATEMENTS_FOUND`.
7. The workflow does not extract a statement on more than 6 pages. The coverage entry of that statement gets the status `failed`.
8. The workflow starts one `statement` branch for each other statement. The branches run in parallel.
9. `extract` sends an excerpt with only the pages of the statement. The model returns the currency, the unit label, the sections and the line items. The model copies each value as text, exactly as printed. The prompt also asks for the earnings per share lines, basic and diluted, when the statement prints them.
10. `check` parses each value to a `Decimal` and does the checks. A dash or "nil" gets the status `dash` and no value. It is not zero.
11. Each check has two limits: 1.0 in the units of the statement, and 0.5% of the larger value. A check passes if the difference is not more than the larger limit.
12. If a check fails, `correct` sends the failed section back to the model. It also sends the problems and the previous output of the model.
13. The workflow accepts a corrected section only if each changed value is on the text layer of its page. A changed value on a scanned page does not stop the correction. If the workflow does not accept the section, it keeps the original section and adds the result warning `CORRECTION_REJECTED`.
14. If the `correct` model call fails, the workflow keeps the original section and adds the result warning `CORRECTION_FAILED`.
15. The branch does `correct` a maximum of 2 times (`max_corrections`).
16. If a branch fails, the coverage entry of its statement gets the status `failed`. The other branches continue.
17. `assemble` makes the `ExtractionResult`. The state is `complete` if all statements have the status `extracted`. If not, the state is `partial`.
18. If no statement has the status `extracted`, the workflow stops with the error `EXTRACTION_FAILED` or `NO_STATEMENTS_EXTRACTED`.
19. If `assemble` does not know the unit label, it adds the result warning `UNKNOWN_UNIT`. The facts of that statement then have no `scaleFactor` and no `normalizedValue`. A per-share line is the exception. Its fact has the `scaleFactor` 1.
20. If the printed company name and `x-company-name` do not agree, `assemble` adds the result warning `COMPANY_NAME_MISMATCH`.

### Retries and budget

1. The `locate` and `extract` nodes have a LangGraph retry policy. `correct` uses `_call_with_retries` with the same values.
2. The retry policy makes a maximum of 3 tries. The first wait is 1 second. Each wait is two times the wait before it.
3. The workflow tries again only after a transient error. These errors are transient:
   - `ModelOutputError`, for example a line on a page outside the excerpt.
   - `TimeoutError` and `ConnectionError`.
   - A Gemini server error, or a Gemini client error with the code 429.
   - `OutputParserException` from LangChain.
   - A timeout or transport error from `httpx`.
4. Before each model call, `_Budget` examines three conditions:
   - If the cancel signal is on, the workflow stops with the error `CANCELLED`.
   - If the time since the start is more than `EXTRACT_DEADLINE_SECONDS`, the workflow stops with the error `DEADLINE_EXCEEDED`.
   - If the request needs more than 40 model calls, the workflow stops with the error `MODEL_CALL_BUDGET_EXCEEDED`.
5. These three errors stop the full workflow, not only one branch.

### Model calls

The extractor uses one model provider: Gemini on Vertex AI, in the region `VERTEX_LOCATION`. Both model classes use `ChatGoogleGenerativeAI` with `vertexai=True` and the temperature 0. The PDF goes to the model as a base64 file block in one human message. The model returns structured output that a Pydantic schema validates (`with_structured_output`).

| Use | Model | Timeout for one call | Client setting |
| --- | --- | --- | --- |
| Extraction (`locate`, `extract`, `correct`) | `GEMINI_MODEL`, default `gemini-2.5-pro` | 300 seconds | `max_retries=1` |
| Classification | `GEMINI_CLASSIFY_MODEL`, default `gemini-2.5-flash` | `CLASSIFY_MODEL_TIMEOUT_SECONDS`, default 60 seconds | `max_retries=0` |

`PROMPT_VERSION` is a hash of the prompt texts. Thus it changes when a prompt changes. `PIPELINE_VERSION` is the constant `extract-2`. The classification result has `rulesVersion`, which is `classify-rules-2`.

### Page provenance

1. Each fact has a `pageIndex`. The model gives a page number in the excerpt, and `_map_page` changes it to the page index.
2. If the excerpt has one page, `_map_page` uses that page for all lines. If a page number is outside a larger excerpt, `_map_page` raises `ModelOutputError`.
3. Each fact has a `textLayerMatch` value:
   - `true`: the parsed value, without its sign, is one of the numbers in the text layer of its page.
   - `false`: the parsed value is not in the text layer of its page.
   - `null`: the page is a scanned page, or the fact has no parsed value.
4. A fact has no quote. Its provenance is the page index and `textLayerMatch` only.
5. Each coverage entry has `pages`, a list of page indexes.
6. Each item of classification evidence has `pageIndex`, `quote`, `source` (`rule` or `model`), `ruleId` and `textLayerMatch`.
7. For rule evidence, `textLayerMatch` is always `true`, because the rules read only the text layer.
8. For model evidence, `textLayerMatch` is `true` if the quote is on the page. It is `null` if the page is a scanned page.
9. Each item of `statementsFound` has `pages`, a list of page indexes.

### XBRL instances

The route `/v1/xbrl` answers with an `application/x-ndjson` stream, as `/v1/extract` does. The routes `/v1/classify` and `/v1/extract` read a PDF. This route reads an XBRL instance and calls no model.

1. The `authenticate` dependency does the secret check. If the header `x-xbrl-mode` is not `classify`, `read` or `text`, the response is `400` with the code `BAD_REQUEST`.
2. The `xbrl_body` dependency reads the body. If the body is empty, the response is `400` with the code `EMPTY_BODY`.
3. If the body is larger than `XBRL_MAX_BYTES`, the dependency stops reading. The route still answers `200`. The stream has a `started` event and an `error` event with the code `XBRL_UNREADABLE` and the message `TOO_LARGE`.
4. The route sends a `started` event with `parserVersion`, `mapVersion` and `mode`.
5. The route runs `read_xbrl` in a separate thread. If the thread does not finish in `EXTRACT_HEARTBEAT_SECONDS`, the route sends a `heartbeat` event. It does this again each time that period passes.
6. `parse_instance` reads the instance. It refuses a DOCTYPE, a file over `XBRL_MAX_BYTES`, a file with more than `XBRL_MAX_FACTS` facts, and a parse that takes more than `XBRL_DEADLINE_SECONDS`. The parser never resolves an entity and never opens the network.
7. The route sends one last event. The type of the event depends on the mode.

| Mode | Last event | Content |
| --- | --- | --- |
| `classify` | `classification` | The format, the kind, the span, the period end, the company name as printed, the BSE code, the NSE symbol, the ISIN, the basis, the audit flag, the statements found, the evidence and the warnings. |
| `read` | `read` | The format, the basis, the state, the declared rounding, the facts, the sum checks and the warnings. |
| `text` | `text` | The text blocks of the instance, each with its element, its context, a heading and its plain text. |

The classification rules for an instance use only its own elements:

1. The family comes from the namespace of the facts. The kind comes from the numeric elements that the instance holds. The first rule of `formats.json` that matches gives the kind.
2. The period comes from the dates `DateOfStartOfReportingPeriod` and `DateOfEndOfReportingPeriod`. The span comes from these dates only. The word in `ReportingQuarter` is never read, because it disagrees with the dates in 106 of the 807 instances on hand.
3. The basis comes from `NatureOfReportStandaloneConsolidated`. If the instance states both bases, or neither, the classification has the kind `not_sure` and the warning `XBRL_MIXED_BASIS`.
4. A shape check rejects an identifier that has the wrong shape. A BSE code is six digits. The symbol `NOTLISTED` is not a symbol.
5. `statementsFound` lists each statement that has a figure for a line of the element map. It has no pages. A format that has no map finds no statement.

The read has these rules:

1. The read writes a fact for each numeric fact that meets three conditions. Its context has no member. Its element is a line of the map. Its unit is money or money per share.
2. The unit comes from the rounding word that the instance declares in `LevelOfRounding` or `LevelOfRoundingUsedInFinancialStatements`. The word `Crores` gives `₹ crore` and the scale 10000000. The word `Lakhs` gives `₹ lakh` and 100000. The word `Millions` gives `₹ million` and 1000000.
3. A per-share fact has the unit `₹ a share` and the scale 1.
4. Each fact has two values. `normalizedValue` is in full rupees, as the file writes it. `reportedValue` is in the declared unit. It has at least as many places as the finest `decimals` of the instance needs, and the read never rounds it.
5. A fact that the file marks nil has the status `unparsed` and no value. The warning `XBRL_NIL` names its element. A nil fact is unknown, not zero.
6. The span comes from the dates of the context. Some durations start on the first of a month and end on the last day of a month. Their spans are `quarter`, `half_year`, `nine_months` and `year`, for 3, 6, 9 and 12 months. Any other duration has the span `other`. An instant has no span.
7. `CashAndCashEquivalentsCashFlowStatement` is an instant. The read writes it into each cash-flow duration that it opens or closes, with an opening label and a closing label.
8. Each fact has the concept of its element in the map. The read stores the concept with the fact. The concept is `null` for an "Others" line.
9. The checks follow each sum of the map for each period in which its total has a fact. The tolerance is n × ½ × 10^(−finest decimals). The number n counts the total and the parts that are present. A sum with no part present, or with a nil value, has the status `not_checked`.
10. The balance identity compares `Assets` with `EquityAndLiabilities`.
11. If the instance declares no rounding, the read adds the warning `XBRL_ROUNDING_MISSING` and the state is `partial`. A monetary fact then has no `reportedValue`. If the declared rounding is not the coarsest `decimals`, the read adds `XBRL_ROUNDING_MISMATCH` and the state is `partial`.
12. An element that is not a line of the map and not in its `ignored` list gives the warning `XBRL_ELEMENT_UNMAPPED`. A mapped element in a unit that is neither money nor money per share gives `XBRL_UNIT_UNSUPPORTED`, and the read writes no fact for it.
13. A format with no map gives the warning `XBRL_FORMAT_UNMAPPED` and no fact.

The text mode finds the facts that have no unit and an element name that ends in `TextBlock` or `Explanatory`, with or without a member. It turns the escaped HTML of each fact into plain text. It keeps the lines and the table rows.

### The PDF check

The route `/v1/xbrl/pdf-check` tells if each XBRL value is on the statement pages of a results PDF. It calls no model.

1. The `pdf_check_parts` dependency reads the multipart body. The body can hold a PDF of `EXTRACT_MAX_BYTES` and a `request` part of 16 MiB. A larger body gets the response `413` with the code `TOO_LARGE_FOR_EXTRACTION`. A body that is not `multipart/form-data` gets `400` with the code `BAD_REQUEST`.
2. The request has `scale`, `places`, `statementPages` and `facts`. A fact has an ID, a value in full rupees, a flag for a per-share value, a statement and a basis.
3. `check_xbrl_in_pdf` opens the PDF and reads its text layer. It looks for each value on the pages that the request gives for the statement and the basis of the fact.
4. For a monetary value, the check looks for the value divided by `scale`. If `places` has a value, the check also tries that number rounded to `places`. For a per-share value, the check looks for the value as it is.
5. A page that has a match gives the status `passed` and the page index. The check compares the absolute value. It does not compare the sign.
6. If no page has a match, and every page has a text layer, the status is `failed`.
7. If a page has no text layer, and no other page has a match, the status is `not_checked` with the reason `scanned`.
8. The other reasons that the extractor gives are `no_value`, `no_unit` and `no_statement_pages`. A fact with no value or no unit gets its reason before the extractor looks at a page. The API gives `no_pdf`, `disabled` and `not_yet` when it has no check row to show.
9. The result has `checkVersion`, the number `XBRL_PDF_CHECK_VERSION`. The extractor refuses a check of another version.

### The element maps

An element map is a mapping rule. A change to a map, to the parser or to a sum changes `XBRL_MAP_VERSION` or `XBRL_PARSER_VERSION`. A change to the PDF check changes `XBRL_PDF_CHECK_VERSION`. Each change ships with an evaluation report in `docs/eval`.

1. Edit the file in `pdf_financial_qa/xbrl/maps`. Add the new lines to the table of `maps/README.md` and say why.
2. Change the version number in `pdf_financial_qa/xbrl/__init__.py` and in `packages/contracts`.
3. Run `maester-eval xbrl-map` over the instances. The [eval description](eval.md) says how.
4. Put the report in `docs/eval`. Read its first section. A sum that fails is a fault of the map or of the filer. The map README lists each filer fault with the page of the PDF that shows it.

## States and errors

The extraction stream sends an error as an `error` event. The classification route sends an error as a JSON body with `"type":"error"`. The worker uses `retryable` to find if the same request can succeed later.

| State or error | Cause | Result |
| --- | --- | --- |
| `401` `EXTRACTOR_UNAUTHORIZED` | The secret has a value, and `x-extractor-secret` is different or not there. | HTTP error. No stream. |
| `413` `TOO_LARGE_FOR_EXTRACTION` | The body is larger than `EXTRACT_MAX_BYTES`. | HTTP error. No stream. |
| `400` `EMPTY_BODY` | The body is empty. | HTTP error. No stream. |
| `EXTRACTOR_NOT_CONFIGURED` | `GOOGLE_CLOUD_PROJECT` has no value, or no Application Default Credentials are available. | Extraction: a `started` event, then an error with `retryable` `false`. Classification: a result with only the rule answers and `MODEL_UNAVAILABLE`. |
| `UNREADABLE_PDF` | `pypdf` cannot open the PDF, the PDF has no pages, or an empty password does not decrypt the PDF. | Error, `retryable` `false`, on both routes. |
| `NO_STATEMENTS_FOUND` | `locate` finds no statement. | Error, `retryable` `false`. |
| `NO_STATEMENTS_EXTRACTED` | No statement has the status `extracted`, and no branch failed with a transient error. | Error, `retryable` `false`. |
| `EXTRACTION_FAILED` | No statement has the status `extracted`, and a branch failed with a transient error. Or the workflow raised an unexpected exception. | Error, `retryable` `true`. |
| `MODEL_UNAVAILABLE` (error) | A transient error continues after all tries, outside a `statement` branch. | Error, `retryable` `true`. |
| `MODEL_REQUEST_REJECTED` | In `locate`, Gemini returns a client error other than 429. Examples: a wrong project, a permission problem, an unknown model. | Error, `retryable` `false`. |
| `MODEL_CALL_BUDGET_EXCEEDED` | The request needs more than 40 model calls. | Error, `retryable` `false`. |
| `DEADLINE_EXCEEDED` | The time since the start is more than `EXTRACT_DEADLINE_SECONDS` before a model call. | Error, `retryable` `false`. |
| `CANCELLED` | The stream stopped before the workflow finished. | Error, `retryable` `true`. |
| `CLASSIFICATION_FAILED` | `run_classification` raised an unexpected exception. | Error, `retryable` `true`. |
| `complete` | All located statements have the status `extracted`. | A `result` event. |
| `400` `BAD_REQUEST` | The header `x-xbrl-mode` is not one of the three modes, or the PDF check body is not a valid multipart body. | HTTP error. No stream. |
| `XBRL_UNREADABLE` | `parse_instance` refuses the instance. The message is a reason code: `TOO_LARGE`, `DOCTYPE`, `MALFORMED`, `NOT_AN_INSTANCE`, `TOO_MANY_FACTS` or `TIMED_OUT`. A fact that names a context or a unit that the file does not declare gives `MALFORMED`. | Error event, `retryable` `false`. The message holds no document text. |
| `XBRL_FAILED` | The XBRL thread raised an unexpected exception. | Error event, `retryable` `true`. The message holds only the type of the exception. |
| `XBRL_PDF_CHECK_FAILED` | The PDF check raised an unexpected exception. | JSON error, `retryable` `true`. |
| `XBRL_FORMAT_UNMAPPED` | The format has no element map. | Result warning on a read and on a classification. The read has no fact. |
| `XBRL_MIXED_BASIS` | The instance states both bases, or neither. | Result warning on a classification. The kind is `not_sure`. |
| `XBRL_ROUNDING_MISSING` | The instance declares no level of rounding, or a word that Maester cannot name. | Result warning. The state is `partial`. A monetary fact has no `reportedValue`. |
| `XBRL_ROUNDING_MISMATCH` | The declared level of rounding is not the coarsest `decimals` of the monetary facts. | Result warning. The state is `partial`. |
| `XBRL_UNIT_UNSUPPORTED` | A mapped element has a unit that is neither money nor money per share. | Result warning. The read writes no fact for that element. |
| `XBRL_ELEMENT_UNMAPPED` | A numeric element is neither a line of the map nor in its `ignored` list. | Result warning. The read writes no fact for it. |
| `XBRL_NIL` | A mapped fact is nil. | Result warning. The fact has the status `unparsed` and no value. |
| `partial` | Some statements have the status `extracted`, and some have the status `failed`. | A `result` event. |
| `LOCATE_PAGE_OUT_OF_RANGE` | The model gave a page number outside the PDF. | Result warning. The workflow ignores that page. |
| `CORRECTION_REJECTED` | A corrected value is not on the text layer of its page, or the correction has no line items. | Result warning. The workflow keeps the original section. |
| `CORRECTION_FAILED` | The `correct` model call failed. | Result warning. The workflow keeps the original section. |
| `UNKNOWN_UNIT` | The unit label has no known scale, or it has two scales. | Result warning. No `scaleFactor` and no `normalizedValue`, except for a per-share line. |
| `COMPANY_NAME_MISMATCH` | The printed company name and `x-company-name` do not agree. | Result warning. |
| `MODEL_UNAVAILABLE` (result warning) | The classification model is not available or failed. | Result warning. The classification keeps only the rule answers. |
| `MODEL_ANSWER_DROPPED` | `_apply` dropped one or more model answers. | Result warning. The fields of those answers stay open. |

For an unexpected exception, the error message and the log message contain only the type of the exception. The text of the exception can contain document text.

## Data

The extractor reads:

- The PDF in the request body.
- The headers `x-extractor-secret`, `x-document-id`, `x-company-name` and `content-length`.
- The environment variables in the table below. `main` also loads the `.env` file of the repository with `load_dotenv`, if the file is there.
- The Application Default Credentials of Google.

The extractor writes:

- The response, to the client.
- Log messages, to the standard output. A log message contains the document ID, the codes, the counts, the time in seconds, and the state or the type of document. It does not contain document text.

An XBRL read sends nothing to Vertex AI. The extractor sends PDF pages to Vertex AI for each model call of a classification or an extraction. It writes no files and has no database connection.

| Variable | Default | Function |
| --- | --- | --- |
| `PORT` | `8790` | The port of the HTTP server. |
| `EXTRACTOR_SECRET` | No value | The secret. With no value, the extractor accepts all requests. |
| `GOOGLE_CLOUD_PROJECT` | No value | The Vertex AI project. With no value, the model is not available. |
| `VERTEX_LOCATION` | `us-central1` | The Vertex AI region. |
| `GEMINI_MODEL` | `gemini-2.5-pro` | The model for extraction. |
| `GEMINI_CLASSIFY_MODEL` | `gemini-2.5-flash` | The model for classification. |
| `CLASSIFY_MODEL_TIMEOUT_SECONDS` | `60` | The timeout for one classification model call. |
| `EXTRACT_MAX_BYTES` | 52428800 (50 MiB) | The largest body that the extractor accepts. |
| `EXTRACT_HEARTBEAT_SECONDS` | `15` | The time without events before a `heartbeat` event. |
| `EXTRACT_DEADLINE_SECONDS` | `840` | The time limit of one extraction. The workflow compares the time with this limit before each model call. |
| `XBRL_MAX_BYTES` | 20971520 (20 MiB) | The largest XBRL instance that the extractor reads. |
| `XBRL_MAX_FACTS` | `100000` | The largest number of facts in one instance. |
| `XBRL_DEADLINE_SECONDS` | `30` | The time limit of one parse. |

The extractor depends on the engine, `fastapi` and `uvicorn` (`apps/extractor/pyproject.toml`). The engine depends on `langgraph`, `langchain-google-genai`, `google-genai`, `pydantic` and `pypdf`. The wire format in the engine mirrors the Zod schemas in `packages/contracts/src/extraction.ts` and `packages/contracts/src/classification.ts`.

## Procedures

### To run the tests

1. Go to the root of the repository.
2. Run this command:

   ```bash
   make test
   ```

3. Make sure that the last line of the output is `OK`.

The tests make no model calls. They use scripted replacements of the model and synthetic PDFs from `tests/pdf_fixtures.py`.

### To run the extractor as a local process

1. Set `GOOGLE_CLOUD_PROJECT` in the `.env` file at the root of the repository.
2. Get Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

3. Set `EXTRACTOR_SECRET` in the `.env` file to the same value as the worker.
4. Go to the root of the repository.
5. Start the extractor:

   ```bash
   uv run --locked maester-extractor
   ```

6. Send a request to the health route:

   ```bash
   curl http://localhost:8790/healthz
   ```

7. Make sure that the response is `{"status":"ok"}`.

### To run the extractor with Docker Compose

1. Set `GOOGLE_CLOUD_PROJECT` in the `.env` file at the root of the repository.
2. Set `GCLOUD_CONFIG_DIR` in the `.env` file to the absolute path of your gcloud configuration directory.
3. Start the service:

   ```bash
   docker compose up --build extractor
   ```

Docker Compose uses the secret `local-extractor-secret` and port 8790. It sends a request to `/healthz` each 5 seconds.

## Warnings and cautions

WARNING: Do not write document text, a quote or the message of an exception to a log. A log message can then show private data from the documents of an investor.

WARNING: Do not remove the lines in `create_app` that set `LANGSMITH_TRACING` and `LANGCHAIN_TRACING_V2` to `false`. If you remove them, LangSmith can get the content of the documents.

CAUTION: Set `EXTRACTOR_SECRET` on a host that other computers can connect to. With no secret, all clients can send requests, and each extraction can make 40 model calls on your Google Cloud project.

## Limits

- Extraction reads only three statements: the balance sheet, the income statement and the cash flow statement.
- The workflow does not extract a statement on more than 6 pages.
- A fact has no quote. The page index and `textLayerMatch` are its only provenance.
- On a scanned page, the extractor cannot compare a value or a quote with the page. `textLayerMatch` is then `null`.
- The classification model sees a maximum of 10 pages.
- The deadline and the cancel signal stop the workflow only before a model call. A model call that started can continue for 300 seconds. Thus a request can take more time than `EXTRACT_DEADLINE_SECONDS`.
- The extractor does not examine the `content-type` header of `/v1/classify` and `/v1/extract`. A body that is not a PDF gets the error `UNREADABLE_PDF`.
- Only two formats have an element map: `in-capmkt/ind_as` and `in-bse-fin/ind_as`. A banking, NBFC or "other than Ind AS" instance is classified and read, and the read has no fact.
- The PDF check compares absolute values. A negative XBRL value, or a cash-flow outflow that the PDF prints in brackets, matches the number without its sign.
- A match anywhere on a statement page counts. A number can match by chance. The [first report](../eval/2026-10-21-xbrl-map-v1.md) measures how often.
- The PDF check assumes that the PDF prints in the unit that the instance declares. When the PDF prints another unit, the check fails every fact of the pair.
- The PDF check reads the text layer only. A scanned page gives `scanned`, never a pass.
- The extractor reads no dimensional fact (a fact with a member) as a figure.
- `/healthz` does not examine the model or the credentials.
- The extractor publishes no OpenAPI schema.
- `infra/deploy.sh` does not deploy the extractor. The production host of the extractor: Not known.
- How the extractor identifies the worker in production when `EXTRACTOR_SECRET` has no value: Not known. A code comment in `settings.py` names Cloud Run IAM.

## Sources

- [apps/extractor/src/maester_extractor/app.py](../../apps/extractor/src/maester_extractor/app.py)
- [apps/extractor/src/maester_extractor/settings.py](../../apps/extractor/src/maester_extractor/settings.py)
- [apps/extractor/src/maester_extractor/\_\_main\_\_.py](../../apps/extractor/src/maester_extractor/__main__.py)
- [apps/extractor/pyproject.toml](../../apps/extractor/pyproject.toml)
- [apps/extractor/Dockerfile](../../apps/extractor/Dockerfile)
- [packages/financial-engine/pyproject.toml](../../packages/financial-engine/pyproject.toml)
- [packages/financial-engine/src/pdf_financial_qa/workflow/runner.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/runner.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/model.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/model.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/prompts.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/prompts.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/pdf.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/pdf.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/values.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/values.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/drafts.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/drafts.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/errors.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/errors.py)
- [packages/financial-engine/src/pdf_financial_qa/workflow/contracts.py](../../packages/financial-engine/src/pdf_financial_qa/workflow/contracts.py)
- [packages/financial-engine/src/pdf_financial_qa/classify/runner.py](../../packages/financial-engine/src/pdf_financial_qa/classify/runner.py)
- [packages/financial-engine/src/pdf_financial_qa/classify/rules.py](../../packages/financial-engine/src/pdf_financial_qa/classify/rules.py)
- [packages/financial-engine/src/pdf_financial_qa/classify/model.py](../../packages/financial-engine/src/pdf_financial_qa/classify/model.py)
- [packages/financial-engine/src/pdf_financial_qa/classify/prompts.py](../../packages/financial-engine/src/pdf_financial_qa/classify/prompts.py)
- [packages/financial-engine/src/pdf_financial_qa/classify/contracts.py](../../packages/financial-engine/src/pdf_financial_qa/classify/contracts.py)
- [packages/financial-engine/src/pdf_financial_qa/xbrl/](../../packages/financial-engine/src/pdf_financial_qa/xbrl/)
- [packages/financial-engine/src/pdf_financial_qa/xbrl/maps/README.md](../../packages/financial-engine/src/pdf_financial_qa/xbrl/maps/README.md)
- [tests/test_extractor_service.py](../../tests/test_extractor_service.py)
- [tests/test_extractor_xbrl.py](../../tests/test_extractor_xbrl.py)
- [tests/test_extraction_workflow.py](../../tests/test_extraction_workflow.py)
- [tests/test_classification_runner.py](../../tests/test_classification_runner.py)
- [tests/pdf_fixtures.py](../../tests/pdf_fixtures.py)
- [Makefile](../../Makefile)
- [docker-compose.yml](../../docker-compose.yml)
- [.env.example](../../.env.example)
- [infra/deploy.sh](../../infra/deploy.sh)
