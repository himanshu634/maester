# Financial engine

Implemented Python library, distributed as `maester-financial-engine`. The import namespace remains `pdf_financial_qa`.

Contains the existing PDF extraction, financial-statement models, heuristic validation, local cache and one-document Q&A. It has no portfolio ledger, page-level source contract or hosted storage yet. See [development and limitations](../../docs/DEVELOPMENT.md) and the [planned domain model](../../docs/DATA_MODEL.md).

Application entry points must import this library; this library must not import application modules. Typer and Rich are CLI dependencies and are not required by this library's declared interface.
