# 0002. Web client on SvelteKit with a brutalist black and off-white design system

Status: accepted, 10 September 2026.

## Context

Until now no JavaScript existed in the repository. The architecture document and the web application README described a proposed Next.js/React/TypeScript client, and the UI specification proposed a colour and typography token set (blue action colour, 8px radius, system sans-serif). [ADR 0001](0001-platform-monorepo.md) records that application choices remain proposals until implemented and that the TypeScript workspace should be added only when real web code arrives.

The first web deliverable is a static index page that explains the portfolio workflow and the accuracy approach. The product owner set the visual direction: brutalist, black and off-white only, followed by every later page. The chosen front-end framework is Svelte.

## Decision

- `apps/web` is a SvelteKit 2 application using Svelte 5 runes, TypeScript and `@sveltejs/adapter-static`. The index page, `/terminal` and `/login` are prerendered. No server runtime is required to host the site.
- It is a standalone pnpm project with its own `pnpm-lock.yaml`, pinned to Node 22 and pnpm 11 through `package.json` and `.nvmrc`. It is not a uv workspace member. A root pnpm workspace file is added only when a second TypeScript package exists.
- The visual system is specified in [DESIGN.md](../DESIGN.md): three colour tokens, one self-hosted type family (Archivo), 2px rules, zero radius, no shadows, hard-inversion hover states, one load-time motion moment. Tokens are CSS custom properties in one file.
- A vitest test, `design-guard.test.ts`, fails the build on any colour literal outside the token file, any radius, any shadow, any foreign font, or any motion over 300ms. This is the enforcement mechanism for "follow that design only".
- `svelte-check` runs with `--fail-on-warnings` so the compiler's accessibility warnings block merges.
- The "Enter the terminal" action links to `/terminal`, which hands off to `/login` when no session cookie is present. Sign-in is not connected until workspace identity (F01) exists, and the login page says so.
- CI gains a Node job beside the Python job. The web client is driven with its own pnpm scripts; the root Makefile stays Python-only.

## Alternatives considered

- Next.js/React as originally proposed: rejected by the product owner in favour of Svelte; nothing had been built on it.
- Astro for a static page: fewer moving parts today, but the same repository will host the interactive terminal, and SvelteKit covers both without a second framework.
- Tailwind or a component library: rejected. The design system is deliberately small and enforced by a test; a utility framework would multiply the ways to express a value and weaken the guard.
- Stylelint instead of a vitest guard: deferred. The test needs no dependencies and also inspects inline `style` attributes; stylelint can be added if the CSS surface grows.

## Consequences

- Node 22 and pnpm 11 are required only for work under `apps/web`. The CLI and engine remain pure Python.
- `packages/ui`, when it exists, becomes a Svelte component library rather than React.
- `scripts/check_workspace.py` now skips `node_modules`, `.svelte-kit`, `build` and `dist` so local checks survive a dependency install.
- The root README states that a static index page exists and that investor journeys are still planned. That wording must not be upgraded until the primary journey is implemented and tested.
- The proposed token table in the UI specification is marked superseded but kept for traceability.
