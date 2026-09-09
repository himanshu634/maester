# Worker application boundary

Status: planned; no queue consumer runs from this directory.

Workers will process durable document, import and recalculation jobs with bounded retries and idempotent publication. They will use the shared engines and private storage adapters. See [architecture](../../docs/ARCHITECTURE.md) and [quality requirements](../../docs/QUALITY.md). Add a package manifest and explicit uv workspace membership when implementation begins.
