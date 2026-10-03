# Web application

Status: a static index page is implemented at `/`, with sign-in (`/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`) connected to the API and a signed-in `/terminal`. The investor journeys (research workspace, holdings snapshot, evidence review) are still planned; see the [delivery plan](../../docs/DELIVERY_PLAN.md). The sign-in design is in [SIGN_IN.md](../../docs/SIGN_IN.md).

Stack: SvelteKit 2, Svelte 5 (runes), TypeScript, `@sveltejs/adapter-static`, pnpm 11, Node 22. The visual system is specified in [DESIGN.md](../../docs/DESIGN.md) and enforced by `src/lib/styles/design-guard.test.ts`. The decision record is [ADR 0002](../../docs/decisions/0002-web-sveltekit-brutalist-design-system.md).

## Commands

Run from this directory (or add `--dir apps/web` to run from the repository root):

```bash
pnpm install --frozen-lockfile   # install locked dependencies
pnpm dev                         # dev server on http://localhost:5173, proxying the API (see Notes)
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
src/lib/session.ts                   readSession (asks the API who is signed in), safeNext, endSession
src/lib/auth/client.ts               the one Better Auth client, created in the browser on first use
src/lib/auth/messages.ts             Better Auth error code to copy; unknown codes get the generic message
src/lib/auth/validate.ts             field checks and focus-first-invalid for the auth forms
src/lib/content/auth.ts              copy for sign-in, sign-up, confirmation and reset
src/lib/components/auth/             AuthLayout, GoogleButton, Notice, OrRule, TextField, PasswordField
nginx.conf.template                  serves the build and proxies /api/auth, /v1 and /dev to the API
src/lib/components/                  Register, Masthead, Hero, Problem, EvidenceTrace, Ledger,
                                     Comparison, AccuracySpec, StatusBoard, SiteFooter
src/routes/+page.svelte              index page
src/routes/terminal/+page.svelte     reads the session; hands off to /login when there is none
src/routes/login/+page.svelte        Google and email sign-in
src/routes/signup/+page.svelte       create an account, then go on to /verify-email
src/routes/verify-email/+page.svelte check your email, resend, confirmed or expired link
src/routes/forgot-password/          request a reset link
src/routes/reset-password/           set a new password from the emailed link
```

## Notes

- Every route is prerendered (`src/routes/+layout.ts`). `trailingSlash` is `never`, so a future `/about` route emits `about.html`; switch to `always` if the host cannot map extensionless paths.
- Archivo is self-hosted through `@fontsource-variable/archivo`; the build makes no request to a font CDN.
- **The proxy.** The browser only talks to the web origin. `vite dev`, `vite preview` and the nginx image proxy `/api/auth`, `/v1` and `/dev` to the API (`API_PROXY_TARGET`, default `http://localhost:8787`; nginx also takes `API_PROXY_HOST` and `NGINX_RESOLVER`). So the session cookie is first-party and Better Auth's base URL is the web origin. Start the API first, and browse at `http://localhost:5173`, not at the API's port. The image's `API_PROXY_*` defaults are local placeholders that `infra/deploy.sh` overrides.
- **The auth client.** `src/lib/auth/client.ts` creates the single Better Auth client (`better-auth/svelte`, `baseURL` is the page's own origin) on first use in the browser, never while prerendering. The session cookie is `HttpOnly`, so `readSession` asks `GET /api/auth/get-session` instead of reading a cookie. Every route stays prerendered; `next`, `error` and `token` are read in `onMount`. `safeNext` accepts only a same-site relative path as a post-sign-in destination.
- **Auth forms use `method="post"`.** A submit before the page has hydrated therefore never puts an email or password in the URL. Signing in still needs JavaScript, and `/login` and `/signup` say so in a `<noscript>` note.
- `/reset-password` strips the token from the address bar after reading it and sets `referrer` to `no-referrer`. The first request still shows the token in the static host's access log, which is inherent to an emailed query-string link ([SIGN_IN.md](../../docs/SIGN_IN.md) section 3.8).
- Email sign-up answers the same way for an approved and an unapproved email and always goes on to `/verify-email`; only the Google path shows the "You’re on the list" message. Copy for all of it lives in `src/lib/content/auth.ts`, and errors never name a code or a library.
- The web app needs no environment variables of its own, apart from the proxy ones above (`BASE_PATH` for a sub-path host).
- This project is not a uv workspace member. Node and pnpm are needed only for work in this directory.
