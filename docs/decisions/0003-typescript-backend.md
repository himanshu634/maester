# ADR 0003: TypeScript backend on Cloud Run

## Status

Accepted on 10 September 2026. Supersedes the Python API/worker proposal in ADR 0001 and `ARCHITECTURE.md` sections 2–4. ADR 0002 (SvelteKit web client) already records the frontend choice.

## Context

The Python engine is small (about 250 lines: one Gemini call, a subtotal checker, a JSON cache). The project owner prefers TypeScript, the frontend is Svelte, and the hosted product needs an API, durable workers and shared request/response types. ADR 0001 planned to generate TypeScript from a Python OpenAPI document; that pipeline exists only because the languages would differ.

## Decision

- The hosted backend is TypeScript on Node 22: `apps/api` (Hono) and `apps/worker` (Hono, Cloud Tasks target), deployed as Cloud Run services on GCP. Vercel is not used for hosting anywhere.
- `packages/contracts` (Zod) is the single authority for API types. There is no OpenAPI code generation. The Svelte frontend imports contracts directly.
- Authentication is Better Auth with email/password, sessions in Postgres, cookies first-party to the API origin.
- PostgreSQL on Cloud SQL via Drizzle; private objects in GCS; durable job dispatch via Cloud Tasks with Postgres leasing; real-time delivery via Server-Sent Events.
- The frontend is the SvelteKit app in `apps/web` (ADR 0002), owned separately with its own lockfile; it can join the root pnpm workspace later by being added to `pnpm-workspace.yaml`.
- The Python CLI and engine are frozen as reference behaviour until the TypeScript extraction pipeline reproduces them, then retired.

## Alternatives considered

Python FastAPI plus OpenAPI codegen (rejected: two toolchains for one developer and an extra generation step). Vercel-hosted Next.js with Vercel Workflow (rejected: owner excludes Vercel). A single Node process with an in-process queue (rejected: Cloud Tasks gives retries and worker autoscaling with no queue to operate).

## Consequences

Financial arithmetic will use decimal.js instead of Python's Decimal. Heavy local PDF processing (OCR, layout analysis), if ever needed, becomes a Python sidecar behind HTTP rather than a rewrite. Two lockfiles remain intentional until the Python members are retired.
