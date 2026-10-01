# Financial engine

Implemented Python library, distributed as `maester-financial-engine`. The import namespace remains `pdf_financial_qa`.

Two extraction paths live here:

- `pdf_financial_qa.workflow` — the hosted, multi-step workflow built with LangGraph and Gemini on Vertex AI (`langchain-google-genai`). It locates statements, extracts each from its own pages with page provenance, checks the arithmetic with `Decimal`, and re-reads only failing sections. `apps/extractor` serves it over HTTP; the design is in [document extraction](../../docs/EXTRACTION.md). Model calls sit behind the `ExtractionModel` interface, so the offline tests drive it with a scripted model.
- The original single-call extraction, financial-statement models, heuristic validation, local cache and one-document Q&A that the CLI uses, kept as reference behaviour.

It has no portfolio ledger or hosted storage. See [development and limitations](../../docs/DEVELOPMENT.md) and the [planned domain model](../../docs/DATA_MODEL.md).

Application entry points must import this library; this library must not import application modules. Typer and Rich are CLI dependencies and are not required by this library's declared interface.
