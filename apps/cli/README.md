# Maester CLI

Implemented Python application. Provides `maester` and the compatibility command `pdf-financial-qa`, both with `ingest`, `ask` and `list-docs`. `ask` is deprecated: it prints a warning on stderr and is removed once the MCP server (`apps/mcp`) calculates. Connect an agent to the server instead; see the "Connect an agent" section of [development instructions](../../docs/DEVELOPMENT.md).

Run from the repository root. See [development instructions](../../docs/DEVELOPMENT.md) and the [contributing guide](../../CONTRIBUTING.md). Reusable document logic lives in `packages/financial-engine`; this application owns terminal presentation and command arguments.
