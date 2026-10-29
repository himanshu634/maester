# Maester documentation

Maester's product plan connects portfolio tracking with company research and verifiable financial evidence. These documents are the implementation brief for that platform.

## Reading guide

| Document | Purpose | Primary audience |
| --- | --- | --- |
| [PRD](PRD.md) | Product scope, users, journeys, requirements, success measures | Product, design, engineering |
| [UI specification](UI_SPECIFICATION.md) | Navigation, screen layouts, components, responsive and failure states | Design and frontend |
| [Feature roadmap](FEATURE_ROADMAP.md) | Ordered backlog, investor value, dependencies and acceptance | Product and delivery |
| [Research](RESEARCH.md) | Comparable products, data sources, evidence and limitations | Product and founders |
| [Architecture](ARCHITECTURE.md) | Monorepo boundaries, applications, services and scale path | Engineering |
| [Data model](DATA_MODEL.md) | Domain entities, money, provenance, accounting and API contracts | Backend and data |
| [Quality and measurement](QUALITY.md) | Test matrix, product metrics and release criteria | Engineering, product, QA |
| [Delivery plan](DELIVERY_PLAN.md) | Milestones, initial build sequence, dependencies and decisions | Delivery team |
| [Building Maester](ENGINEERING.md) | Where the build stands, what each roadmap step contains, and where to run, change and deploy it | Contributors |
| [Development](DEVELOPMENT.md) | Running the stack locally, configuration, checks, troubleshooting and current limitations | Contributors |
| [Document extraction](EXTRACTION.md) | Company records and versioned fact extraction with page provenance (F03, F05) | Backend, data and platform |
| [Sign-in](SIGN_IN.md) | Google, email and password, and the waitlist: topology, flows, pages, configuration, known limits | Engineering and design |
| [Design specification](DESIGN.md) | The visual contract for every web page: colour, type, structure, motion, copy, enforcement | Design and frontend |
| [System: overview](systems/maester.md) | The whole system in Simplified Technical English: apps, flows, data, how to run it | Engineering |
| [System: API](systems/api.md) | The Hono API: routes, sign-in, documents, jobs, Research, market mood, Settings connections, configuration | Backend |
| [System: worker](systems/worker.md) | The job worker: verify, classify, extract, index, leases and retries, and the market data refresher | Backend |
| [System: extractor](systems/extractor.md) | The Python extraction service: workflow, model calls, page provenance | Backend and data |
| [System: indexer](systems/indexer.md) | The Python page reader and chunker: routes, events, settings, weights | Backend and data |
| [System: web](systems/web.md) | The SvelteKit web app: routes, API client, build and serving, checks | Frontend |
| [System: CLI](systems/cli.md) | The command-line tool: commands, cache, model calls | Engineering |
| [System: MCP server](systems/mcp.md) | The read-only MCP server for agents: tools, settings, answer rules, connecting Claude | Engineering |
| [System: shared packages](systems/packages.md) | Config, contracts, database, financial engines, jobs, market data and storage | Engineering |
| [System: evaluation harness](systems/eval.md) | The `maester-eval` app: live runs over real filings, XBRL reads, labelling sheets, the gold set, the report, compare and settle | Engineering and data |
| [Monorepo decision](decisions/0001-platform-monorepo.md) | Rationale and consequences of the package split | Engineering |
| [Web client decision](decisions/0002-web-sveltekit-brutalist-design-system.md) | SvelteKit, the brutalist design system and how it is enforced | Engineering and design |
| [TypeScript backend decision](decisions/0003-typescript-backend.md) | Hono API and worker on Cloud Run, Zod contracts, Drizzle | Engineering |
| [Extraction sidecar decision](decisions/0004-python-extraction-sidecar.md) | Python extraction service with LangGraph behind the TypeScript worker | Engineering |
| [Sign-in decision](decisions/0005-sign-in-google-email-waitlist.md) | Better Auth with Google and email, a waitlist gate, Resend and the web-origin proxy | Engineering and product |
| [Financial data layer decision](decisions/0006-concepts-calculations-agent-access.md) | Concepts over as-printed facts, two readers, calculations in TypeScript, a read-only MCP server, evaluation before change | Engineering and data |
| [Ingestion pipeline decision](decisions/0007-ingestion-pipeline.md) | XBRL alone for a filing's numbers, a local text index, and a bounded job runner | Engineering and data |
| [Broker plugins decision](decisions/0009-broker-plugins.md) | Brokers as compiled-in code plugins with host-enforced safety; Zerodha now, Angel One next | Engineering |

## Designs, research and reports

Each feature's design is a dated spec in [`superpowers/specs/`](superpowers/specs/), with its step-by-step build plan beside it in [`superpowers/plans/`](superpowers/plans/). Each spec's status line says whether it is built. A spec is the design as approved; where the build moved on, the system descriptions above are current.

| Document | Purpose | Primary audience |
| --- | --- | --- |
| [Financial data layer design](superpowers/specs/2026-10-15-financial-data-layer-design.md) | The extraction pipeline's gaps, the concept and period model, checks, the metric registry, agent access, evaluation and phases | Backend, data and platform |
| [Ingestion pipeline design](superpowers/specs/2026-10-19-ingestion-pipeline-design.md) | Numbers from XBRL or the PDF, every page's text indexed, the job runner and how accuracy is measured | Backend, data and platform |
| [Documents by filing design](superpowers/specs/2026-10-19-documents-filings-design.md) | The Documents screen: filings, not files, with their Numbers and Text tracks | Design, frontend and backend |
| [MCP server design](superpowers/specs/2026-10-21-mcp-server-design.md) | The read-only MCP server for agents: M1 facts and search, M2 metrics | Engineering |
| [Broker plugins design](superpowers/specs/2026-10-27-broker-plugins-design.md) | Each broker a typed plugin with a host-locked toolkit and a conformance suite; Zerodha first; not built | Engineering |
| [Company financials design](superpowers/specs/2026-10-13-company-financials-design.md) | The Research page: the stock summary, statement tables and figure panel | Design, frontend and backend |
| [Market mood design](superpowers/specs/2026-10-06-market-mood-design.md) | The market mood score, its readings and the Settings connections | Design, frontend and backend |
| [Document intake design](superpowers/specs/2026-10-05-document-intake-classification-design.md) | Working out what an uploaded PDF is and which company it belongs to | Backend and data |
| [Maester for macOS design](superpowers/specs/2026-10-13-macos-desktop-app-design.md) | A desktop app for the terminal; approved for planning, not built | Engineering |
| [Research notes](research/) | Market mood measurement, market data vendors, the Dhan and FRED APIs, broker APIs (Angel One's publisher login), and the ingestion research | Product and engineering |
| [Evaluation reports](eval/) | Reports from the evaluation harness, starting with the XBRL element maps over 807 filings | Engineering and data |
| [Brand guide](brand/LOGO.md) | The wordmark, the mark and how to use them | Design |
| [Diagrams](diagrams/) | How the codebase fits together and how a filing moves through it, as Excalidraw files | Engineering |

## Document status

Planning baseline: 9 September 2026. The PRD, UI specification, feature roadmap, data model and delivery plan are the product direction set then; features tagged P0–P3 describe planned releases. What is built today, and what is not, is in [Building Maester](ENGINEERING.md).

Assumptions: self-directed long-term investors; India-first discovery; desktop-first responsive web; cash equities and cash first; one personal workspace initially; no order execution in initial releases. Currency, exchange and security models must accommodate later global expansion. Audience and geography have not been confirmed by customer research.

The earlier conversation mockup was exploratory. This specification supersedes its invented product name, uncalibrated confidence badges, unlabeled performance illustration, and document-count headline metric. Product naming here uses **Maester** as a working name. Any mock financial values used in future designs must be labeled synthetic.

## How to use the requirements

Start with the release outcome in the PRD, then select feature IDs from the roadmap. Use the UI specification for the interaction contract and the data model for meaning. Define acceptance tests before implementing money or evidence behavior. Update the corresponding documents when a decision changes.

P0 is the first investor-facing release, not everything required for the eventual platform. P1 adds a distinct accounting milestone. P2 and P3 should be re-ranked with usage evidence. Research observations are sourced; priorities, design dimensions, adoption targets and effort estimates are planning judgments.
