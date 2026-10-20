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
| [System: shared packages](systems/packages.md) | Config, contracts, database, financial engines, jobs, market data and storage | Engineering |
| [System: evaluation harness](systems/eval.md) | The `maester-eval` app: live runs over real filings, labelling sheets, the gold set and the report | Engineering and data |
| [Monorepo decision](decisions/0001-platform-monorepo.md) | Rationale and consequences of the package split | Engineering |
| [Web client decision](decisions/0002-web-sveltekit-brutalist-design-system.md) | SvelteKit, the brutalist design system and how it is enforced | Engineering and design |
| [TypeScript backend decision](decisions/0003-typescript-backend.md) | Hono API and worker on Cloud Run, Zod contracts, Drizzle | Engineering |
| [Extraction sidecar decision](decisions/0004-python-extraction-sidecar.md) | Python extraction service with LangGraph behind the TypeScript worker | Engineering |
| [Sign-in decision](decisions/0005-sign-in-google-email-waitlist.md) | Better Auth with Google and email, a waitlist gate, Resend and the web-origin proxy | Engineering and product |
| [Financial data layer decision](decisions/0006-concepts-calculations-agent-access.md) | Concepts over as-printed facts, two readers, calculations in TypeScript, a read-only MCP server, evaluation before change | Engineering and data |
| [Financial data layer design](superpowers/specs/2026-10-15-financial-data-layer-design.md) | The extraction pipeline's gaps, the concept and period model, checks, the metric registry, agent access, evaluation and phases | Backend, data and platform |

## Document status

Planning baseline: 9 September 2026. Status: proposed product direction, ready for implementation refinement. Functional code currently covers the CLI, the shared financial-document engine, and the platform base of API, job worker and static web pages. Features tagged P0–P3 describe future releases unless explicitly marked existing.

Assumptions: self-directed long-term investors; India-first discovery; desktop-first responsive web; cash equities and cash first; one personal workspace initially; no order execution in initial releases. Currency, exchange and security models must accommodate later global expansion. Audience and geography have not been confirmed by customer research.

The earlier conversation mockup was exploratory. This specification supersedes its invented product name, uncalibrated confidence badges, unlabeled performance illustration, and document-count headline metric. Product naming here uses **Maester** as a working name. Any mock financial values used in future designs must be labeled synthetic.

## How to use the requirements

Start with the release outcome in the PRD, then select feature IDs from the roadmap. Use the UI specification for the interaction contract and the data model for meaning. Define acceptance tests before implementing money or evidence behavior. Update the corresponding documents when a decision changes.

P0 is the first investor-facing release, not everything required for the eventual platform. P1 adds a distinct accounting milestone. P2 and P3 should be re-ranked with usage evidence. Research observations are sourced; priorities, design dimensions, adoption targets and effort estimates are planning judgments.
