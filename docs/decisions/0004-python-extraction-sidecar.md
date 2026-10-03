# ADR 0004: Python extraction sidecar with LangGraph

## Status

Accepted on 1 October 2026. Partially supersedes [ADR 0003](0003-typescript-backend.md): the Python engine is no longer frozen for retirement.

## Context

ADR 0003 froze the Python engine as reference behaviour, to be retired once a TypeScript pipeline reproduced it, and allowed a Python sidecar behind HTTP for heavy document work. F05 needs a multi-step, self-correcting extraction workflow: locate statements, extract each from its own pages, check the arithmetic, and re-read only what failed. The Python ecosystem has the stronger PDF tooling (pypdf) and agent-workflow tooling (LangChain and LangGraph), and the existing engine already talks to Gemini on Vertex AI.

## Decision

- Document extraction runs in Python as `apps/extractor`, a FastAPI service over a LangGraph workflow in `packages/financial-engine`. LangChain (LangGraph for the workflow graph, `langchain-google-genai` for Gemini on Vertex AI) is the framework for agentic workflows.
- The extractor is stateless: the TypeScript worker sends the PDF in the request and receives a streamed NDJSON result. It never touches Postgres or object storage.
- TypeScript keeps everything else: the API, job state, leasing and retries, and every database write. Drizzle remains the only schema authority and `@maester/contracts` the authority for API types; the extractor's wire format is mirrored in Pydantic and Zod and pinned by shared golden fixtures.
- `packages/financial-engine-ts` stays a placeholder; there is no plan to port extraction to TypeScript.

## Alternatives considered

Port extraction to TypeScript (rejected for now: slower to a demoable Slice A, weaker PDF and workflow tooling). Python as a second job runner writing to Postgres (rejected: duplicates leasing and schema definitions in two languages). A long-running Python poller (rejected: does not fit Cloud Run request-based scaling and adds a second dispatch mechanism).

## Consequences

Two runtimes are deployed. The extractor needs Vertex AI credentials and its own Cloud Run service; the worker needs permission to invoke it. Long extractions rely on streamed heartbeats to keep HTTP connections and job leases alive. The CLI's single-call path remains as a reference until the workflow is measured against it.
