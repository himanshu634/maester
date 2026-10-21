# Financial engine

Implemented Python library, distributed as `maester-financial-engine`. The import namespace remains `pdf_financial_qa`.

Three readers live here:

- `pdf_financial_qa.workflow` — the hosted, multi-step workflow built with LangGraph and Gemini on Vertex AI (`langchain-google-genai`). It locates statements, extracts each from its own pages with page provenance, checks the arithmetic with `Decimal`, and re-reads only failing sections. `apps/extractor` serves it over HTTP; the design is in [document extraction](../../docs/EXTRACTION.md). Model calls sit behind the `ExtractionModel` interface, so the offline tests drive it with a scripted model.
- `pdf_financial_qa.xbrl` — the reader of XBRL instances (XML). It uses no model and calls no network. `parse_instance` reads an instance with `lxml` and hard limits, `classify_instance` finds the company, the basis and the period from its elements, and `read_instance` writes the facts of the formats that have an element map (`xbrl/maps`) with their span, unit and element, and checks each sum of the map. `check_xbrl_in_pdf` looks for each XBRL value on the statement pages of the results PDF. `apps/extractor` serves all of it at `/v1/xbrl` and `/v1/xbrl/pdf-check`. A change to a map, the parser, a sum or the check bumps its version in `xbrl/__init__.py` and ships with a `maester-eval xbrl-map` report in `docs/eval/` (see [extractor](../../docs/systems/extractor.md) and [document extraction](../../docs/EXTRACTION.md), section 8).
- The original single-call extraction, financial-statement models, heuristic validation, local cache and one-document Q&A that the CLI uses, kept as reference behaviour.

It has no portfolio ledger or hosted storage. See [development and limitations](../../docs/DEVELOPMENT.md) and the [planned domain model](../../docs/DATA_MODEL.md).

Application entry points must import this library; this library must not import application modules. Typer and Rich are CLI dependencies and are not required by this library's declared interface.
