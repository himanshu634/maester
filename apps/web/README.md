# Web application

Status: a static index page is implemented at `/`, with `/terminal` and `/login` as entry points. The investor journeys (research workspace, holdings snapshot, evidence review) are still planned; see the [delivery plan](../../docs/DELIVERY_PLAN.md).

Stack: SvelteKit 2, Svelte 5 (runes), TypeScript, `@sveltejs/adapter-static`, pnpm 11, Node 22. The visual system is specified in [DESIGN.md](../../docs/DESIGN.md) and enforced by `src/lib/styles/design-guard.test.ts`. The decision record is [ADR 0002](../../docs/decisions/0002-web-sveltekit-brutalist-design-system.md).

## Commands

Run from this directory (or add `--dir apps/web` to run from the repository root):

```bash
pnpm install --frozen-lockfile   # install locked dependencies
pnpm dev                         # dev server on http://localhost:5173
pnpm check                       # svelte-check, fails on accessibility warnings
pnpm lint                        # prettier and eslint
pnpm test                        # design guard and unit tests
pnpm build                       # static build into build/
pnpm preview                     # serve the build on http://localhost:4173
pnpm verify                      # check, lint, test and build in one go
```

## Layout

```text
src/app.css                          global styles, reset, the reduced-motion kill switch
src/app.html                         document shell
src/lib/styles/tokens.css            the only file allowed to hold colours and font names
src/lib/styles/design-guard.test.ts  fails the build when code drifts from docs/DESIGN.md
src/lib/content/index.ts             all copy for the public pages, typed; business language only
src/lib/session.ts                   session-cookie check used by /terminal
src/lib/components/                  Register, Masthead, Hero, Problem, EvidenceTrace, Ledger,
                                     Comparison, AccuracySpec, StatusBoard, SiteFooter
src/routes/+page.svelte              index page
src/routes/terminal/+page.svelte     hands off to /login when no session cookie exists
src/routes/login/+page.svelte        sign-in form; not connected until workspace identity (F01) ships
```

## Notes

- Every route is prerendered (`src/routes/+layout.ts`). `trailingSlash` is `never`, so a future `/about` route emits `about.html`; switch to `always` if the host cannot map extensionless paths.
- Archivo is self-hosted through `@fontsource-variable/archivo`; the build makes no request to a font CDN.
- Sign-in posts nowhere. The form tells the visitor that sign-in is not connected. Do not change that wording until the API exists and the primary journey is tested ([development guide](../../docs/DEVELOPMENT.md)).
- This project is not a uv workspace member. Node and pnpm are needed only for work in this directory.
