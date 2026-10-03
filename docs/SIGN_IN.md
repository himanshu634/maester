# Sign-in: Google, email and the waitlist

Status: built 2026-10-03 on `feat/sign-in`. Design direction A ("Google first, one panel") picked on the [sign-in canvas](https://claude.ai/artifact/VZmn6QA8rBpLuMJ4bWXY1r), round 2. This document is the spec for feature F01's sign-in half ([FEATURE_ROADMAP.md](FEATURE_ROADMAP.md)), amended to describe what was built; the decision is recorded in [ADR 0005](decisions/0005-sign-in-google-email-waitlist.md). Ownership enforcement for documents, facts and jobs already exists in `apps/api`. Section 3.8 lists the known limits.

## 1. Outcome

An investor opens `/login`, signs in with Google or with an email and password, and lands in `/terminal` with a real session and a personal workspace. Maester is invite-only for now: an email that is not approved gets no account and is recorded on a waitlist, and the person is told so plainly.

Success means:

- An approved Google account reaches `/terminal` in one round trip; an unapproved one sees the waitlist message and no account, session or workspace is created.
- An approved email can create an account, confirm the address, sign in, and reset a forgotten password. Email sign-up looks the same to an approved and an unapproved email, so the page cannot be used to probe the list.
- `/terminal` recognises the session (before this work it could not, see section 3.5).
- It works the same locally and in production.

Out of scope: an account or settings page, linking Google from settings, a waitlist admin screen, remember-me, a password strength meter, magic links, any other identity provider.

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Methods | Google and email/password | Chosen by the product owner |
| Library | Better Auth's built-in Google provider, in the existing `createAuth` | Reuses the session, cookie, tables and workspace hook already in `apps/api`; no schema change for Google |
| Google flow | Redirect (`signIn.social`), no One Tap or Google script on the page | No third-party iframe or script on `/login`; works with the static web app |
| Access | Waitlist capture: approved emails get accounts, others are recorded | Matches the invited cohort in [DELIVERY_PLAN.md](DELIVERY_PLAN.md) |
| Email delivery | Resend; a console driver in development | Simple API; local development sends nothing |
| Topology | nginx in the web container proxies `/api/auth/*`, `/v1/*` and `/dev/*` to the API (`vite dev` and `vite preview` do the same) | The browser sees one origin, so the session cookie is first-party; the option [contracts README](../packages/contracts/README.md) section 1 recommends |
| Google mark | The official four-colour G under a guarded token exception | Google's branding rules forbid a monochrome G or a text-only button |

This resolves "Identity provider: not selected" in DELIVERY_PLAN.md; record it as ADR 0005 in the same change.

## 3. Architecture

### 3.1 Topology

```
browser ──▶ web origin (nginx, static files)
              ├─ /api/auth/*, /v1/*, /dev/*  ──▶ maester-api (Cloud Run, *.run.app)
              └─ everything else             ──▶ static files
dev:  vite :5173 ── server.proxy /api/auth, /v1, /dev ──▶ api :8787
```

- `BETTER_AUTH_URL` is the **web** origin in every environment (`http://localhost:5173` in development). The callback is therefore `<web-origin>/api/auth/callback/google`, the same shape locally and in production. Local work happens at `http://localhost:5173`; port 8787 is the API behind the proxy, still fine for direct health checks.
- `ALLOWED_ORIGINS` and Better Auth's `trustedOrigins` hold the web origin only.
- `/dev/*` is proxied too so the local dev upload page and signed local blob URLs work from the web origin. It is for development only: the API does not mount `/dev` in production.
- nginx proxy requirements: `proxy_set_header Host <api run.app host>`; `proxy_ssl_server_name on`; a `resolver` with the upstream in a variable so DNS is re-resolved; `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` passed; for `/v1/workspaces/*/jobs/*/events` (SSE) `proxy_buffering off` and `proxy_read_timeout` above the stream's longest silence. The upstream comes from `API_PROXY_TARGET` through the nginx image's `/etc/nginx/templates` substitution. The defaults in the web image are local placeholders that `infra/deploy.sh` overrides.
- The API is already deployed `--allow-unauthenticated`, so nginx needs no IAM token.
- Better Auth reads the client IP from `X-Forwarded-For` (`advanced.ipAddress.ipAddressHeaders`) so rate limits and session IPs are the browser's, not nginx's. With more than one address in the header it walks from the right, past `TRUSTED_PROXIES`. `TRUSTED_PROXIES` is required in production: the API refuses to boot without it, because without it every client can fall into one rate-limit bucket. See section 3.8 for what the header does not guarantee.

### 3.2 Google sign-in

1. `/login` calls `authClient.signIn.social({ provider: "google", callbackURL: safeNext(next), errorCallbackURL: "/login?next=<next>" })`; the browser goes to Google.
2. Google returns to `/api/auth/callback/google` through the proxy.
3. Before anything else, the `user.validateUserInfo` hook refuses a Google account whose email Google has not verified (`email_verified` is not true). Better Auth redirects to `errorCallbackURL` with `?error=GOOGLE_EMAIL_NOT_VERIFIED`, so the page shows "Google hasn’t confirmed this email". Nothing is linked or created.
4. Better Auth finds the user by email:
   - **Existing user**: Google is linked (`account.accountLinking.trustedProviders: ["google"]`, with `requireLocalEmailVerified: false`; see 3.4 for why that is safe) and a session is issued.
   - **New email**: the `user.create.before` hook runs the waitlist gate (3.3). Approved: the user is created, the existing `user.create.after` hook creates the personal workspace, a session is issued. Not approved: the hook throws `APIError` with code `WAITLISTED`; Better Auth forwards the code to `errorCallbackURL` as `?error=WAITLISTED`.
5. The browser lands on `callbackURL`. If the user cancels at Google, it lands on `/login?error=access_denied`.

The error codes the Google path can send to the page are `WAITLISTED`, `GOOGLE_EMAIL_NOT_VERIFIED` and `access_denied`. Any other value shows the generic message, never the raw string.

Scopes: `openid email profile`, nothing more.

### 3.3 The waitlist gate

One function, `admitOrWaitlist(db, { email, source })`, called from `databaseHooks.user.create.before`, so it covers Google and email sign-up alike:

- email normalised (trimmed, lower-cased) before lookup;
- `approved` → returns, creation continues;
- otherwise upserts a `pending` row (never downgrades an `approved` row, never duplicates) and throws `APIError("FORBIDDEN", { code: "WAITLISTED", message: "…" })`.

The two paths differ in what the person is told, on purpose:

- **Google** redirects with `?error=WAITLISTED`, and `/login` or `/signup` says "You’re on the list". Google has already shown who the person is, so nothing is revealed.
- **Email sign-up never reveals the waitlist.** With `requireEmailVerification` on, Better Auth answers a sign-up the gate refused with the same 200 it gives an approved one: the gate records a pending waitlist row and creates no user, so there is no JSON `WAITLISTED` error. `/signup` therefore always goes on to `/verify-email`, whose copy covers both cases ("If `<email>` is on the invitation list, we sent it a link… If it isn’t on the list yet, we’ve added it."). An approved address gets the confirmation link; a waitlisted one gets nothing. The page cannot be used to probe the list.

Approval is a script, `pnpm --filter @maester/db waitlist:approve <email>`, which upserts the row as `approved` and sets `approved_at`. Nothing is emailed on approval.

### 3.4 Email and password

- `emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 8 }`.
- `emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true, expiresIn: 3600, sendVerificationEmail }`; the link's `callbackURL` is `/verify-email?next=<next>`.
- `sendResetPassword` sends a link that lands on `/reset-password?token=…`; `resetPasswordTokenExpiresIn: 3600`; `revokeSessionsOnPasswordReset: true`.
- Mail is sent without awaiting it inside the request, so response time does not reveal whether an account exists.
- Option names above are Better Auth's as documented, checked against the installed version (`better-auth` ^1.7).
- Sign-in with an unconfirmed email is refused (`403 EMAIL_NOT_VERIFIED`) and a fresh link is sent.
- **Takeover guard.** The attack: someone registers a victim's approved email with a password and never confirms it; later the victim signs in with Google and the accounts link. Defence: an `account.create.before` hook — when a `google` account is about to be created for a user whose `emailVerified` is false, delete that user's `credential` account, delete all of their sessions and set `emailVerified` true. The attacker's password then no longer exists. A test covers exactly this.
- **Why `requireLocalEmailVerified: false` is safe.** Better Auth, by default, refuses to link Google to a user whose local email is unconfirmed. The takeover guard needs that link to happen so that it can remove the unconfirmed password and its sessions, so linking is allowed. Two things make that safe: the guard runs in `account.create.before`, before the link exists, and `user.validateUserInfo` has already refused any Google profile whose email Google has not confirmed (3.2), so the guard can rely on Google's confirmation.

### 3.5 Session detection on the web

`apps/web/src/lib/session.ts` used to look for a `maester_session` cookie. The API sets `maester.session_token`, `HttpOnly`, which script can never read, so `/terminal` could never see a session. It was replaced: `getSession()` through the `better-auth/svelte` client (`GET /api/auth/get-session`, same origin). `/terminal` and `/login` use it; `/login` and `/signup` with a session go straight to `next`. Sign-out is `authClient.signOut()` then `/`. As built, the check is `readSession(authClient())` in `apps/web/src/lib/session.ts`, run in `onMount` so prerendering never calls the API.

### 3.6 Data

One new table, `waitlist_entry`, plus `rate_limit` for Better Auth's database-backed limiter. No change to `user`, `session`, `account` or `verification`.

| Column | Type | Notes |
| --- | --- | --- |
| `email` | `text`, primary key | Stored lower-cased; the gate normalises before every read and write |
| `status` | `text`, `check (status in ('pending', 'approved'))` | |
| `source` | `text`, `check (source in ('google', 'email', 'admin'))` | How the email first arrived |
| `requested_at` | `timestamptz not null default now()` | First request; later requests do not move it |
| `approved_at` | `timestamptz` | Set by the approve script |

Migration `0002` in `packages/db/drizzle`, an ordinary Drizzle migration (the repository has no grant or role conventions yet). Recorded in [DATA_MODEL.md](DATA_MODEL.md).

### 3.7 Mail

`apps/api/src/mail/`: a `Mailer` interface (`send({ to, subject, text, html })`) with two drivers. `console` logs the message, including the link, through pino (development and tests; the API log is where a local confirmation link appears). `resend` posts to Resend's API. Two templates, confirm-email and reset-password, plain text plus minimal HTML, in the product's voice: what the link does, how long it lasts, and that the person can ignore it if they did not ask. A confirmation link lasts one hour: it is a signed token, so it keeps working within that hour. A reset link works once, for one hour. Neither template carries the name the signer typed, because whoever signs up chooses it and it must not reach someone else's inbox. The confirmation email says someone asked to open an account with this address and tells the reader not to open the link if it was not them (see 3.8).

### 3.8 Known limits

Recorded here and in [ADR 0005](decisions/0005-sign-in-google-email-waitlist.md), not hidden.

- **Pre-registration through the email link.** Someone who knows an approved person's email address can sign up with it first, choosing a password. If the real owner then opens the confirmation email, the impostor's password works on the confirmed account. The Google takeover guard (3.4) no longer applies, because the address is already confirmed. Today's mitigation is the confirmation email: it says someone asked to open an account with this address, tells the reader not to open the link if it was not them, and carries no name the signer typed. A structural fix, tying the password to whoever confirms the address, is future work.
- **The rate limiter trusts `X-Forwarded-For` only as far as `TRUSTED_PROXIES` reaches.** A client can prefix the header, and Cloud Run appends the real address, so the first entries are client-controlled. A determined client can spread its attempts over many buckets. The per-account protections (email confirmation, a reset that revokes sessions) do not depend on the limiter. [infra/README.md](../infra/README.md) has a smoke test that checks `TRUSTED_PROXIES` instead of assuming it.
- **The reset token reaches the static host once.** `/reset-password?token=…` is an emailed query-string link, so the first request, which loads the page, is in the host's access log with the token. The page then strips the token from the address bar with `replaceState` after reading it and sets `<meta name="referrer" content="no-referrer">`, so it does not stay in the address bar or history or leak through a `Referer` header. The log entry is inherent to a link of this kind. The token is single-use and expires after an hour.
- **Submitting before the page has loaded.** Every auth form uses `method="post"`, so a submit before hydration never puts credentials in a URL. Signing in still needs JavaScript; `/login` and `/signup` say so in a `<noscript>` note.

## 4. Pages and states (direction A)

The canvas is the visual reference; this section is the contract. Every page uses `/login`'s anatomy today: masthead, a 480px panel with a 2px rule, and on `/login` the sign-in illustration filling the right column from 1024px and stacking under the panel below it. The secondary pages drop the illustration. All routes stay prerendered; `next`, `error` and `token` are read on the client.

| Route | Content | States |
| --- | --- | --- |
| `/login` (changed) | "Sign in to the terminal", lede, **Continue with Google** (filled, the one primary action), "or use your email" rule, Email, Password with Show, Sign in (outline), "Forgot your password?", "New to Maester? Create an account", "Back to the index page" | default · Google opening · waitlisted (`?error=WAITLISTED`) · Google cancelled (`?error=access_denied`) · Google email not confirmed (`?error=GOOGLE_EMAIL_NOT_VERIFIED`, "Google hasn’t confirmed this email") · email not confirmed (offer to resend) · wrong email or password · too many attempts · already signed in (go to `next`) · any other `?error` (generic, with "try again") |
| `/signup` (new) | "Create your account", "Maester is open to invited investors for now. Use the email your invitation went to.", **Sign up with Google**, rule, Name, Email, Password with Show and "At least 8 characters.", Create account (outline), "Already have an account? Sign in" | default · field errors · Google waitlisted (`?error=WAITLISTED`) · too many attempts · done (always go to `/verify-email`, whether or not the email is approved) |
| `/verify-email` (new) | "Check your email", the address, "If `<email>` is on the invitation list, we sent it a link… If it isn’t on the list yet, we’ve added it.", "It works for one hour", Send it again, "Use a different email" | link sent · link worked (go to `next`) · link expired (email field, Send a new link) |
| `/forgot-password` (new) | "Reset your password", Email, Send reset link | default · sent (same message whether or not the account exists) |
| `/reset-password` (new) | "Set a new password", New password with Show, Set new password | default · field error · done (go to `/login` with a "Password changed" note) · link expired (Request a new one; reset links work once, for one hour). The page strips the token from the address bar after reading it and sets `referrer` to `no-referrer` (3.8) |
| Terminal shell (changed) | Rail foot: "Signed in as", the email, Sign out (outline); the same block at the foot of the phone drawer | signing out · signed out (go to `/`) |

Waitlisted, Google path: "You’re on the list" / "Maester is open to invited investors for now. We’ve added your Google email address to the list." (the redirect carries no email, so the message names "your Google email address" rather than the address) / "Nothing else to do. No account or workspace was created, and nothing was kept from Google but your email address." / "Signed in with the wrong Google account? Use another account". It promises no email and no date. Email sign-up has no waitlisted state of its own: see 3.3 and `/verify-email`.

Confirmation links last one hour (they are signed tokens, reusable within the hour), so copy says "It works for one hour" and never "once". Reset links work once, for one hour, and copy says so.

Messages are a 2px box with a bold first line. A field error is a 3px border on the input plus bold text under it that says the fix. State is never colour. Errors never name a code, Better Auth or OAuth. Copy is in `apps/web/src/lib/content/`, and `content.login.notConnected` and the "Sending you to /terminal" line are removed.

Accessibility (DESIGN.md section 8, UI_SPECIFICATION sections 13–14): visible labels; `autocomplete` `email`, `name`, `current-password`, `new-password`; status in `aria-live="polite"`; a failed submit moves focus to the first invalid field; the Google control is a real `<button>`, disabled while it redirects and pointing at the status line through `aria-describedby`; the Show control is a 44px `<button>` with `aria-pressed`; `<noscript>` says sign-in needs JavaScript.

## 5. Design-system changes

- DESIGN.md section 2: `--brand-google-blue #4285F4`, `--brand-google-red #EA4335`, `--brand-google-yellow #FBBC05`, `--brand-google-green #34A853` in `tokens.css`, each line `design-guard: allow`, used only inside the Google mark.
- DESIGN.md section 5: **Google button** — 48px, 2px border, square, Archivo 700, the mark at 18px on a 28px paper chip; filled ink when it is the primary action, outline otherwise; hover inverts the button and the chip keeps the mark on paper. **Or rule** — 1px `--ink-muted` lines either side of a 14px muted label. **Notice** — a 2px box with a bold first line, for form-level messages. **Password field** — a form field with an attached 44px Show button.
- `design-guard.test.ts` keeps failing any other colour literal outside `tokens.css`.

## 6. Configuration

| Variable | Service | Rule |
| --- | --- | --- |
| `BETTER_AUTH_URL` | api | The web origin |
| `ALLOWED_ORIGINS` | api | The web origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | Both or neither; required in production |
| `MAIL_DRIVER` | api | `console` (default; refused in production) or `resend` |
| `RESEND_API_KEY`, `MAIL_FROM` | api | Required when `MAIL_DRIVER=resend` |
| `AUTH_RATE_LIMIT` | api | `on` or `off` (default `off`). The limiter is always on in production; `on` turns it on elsewhere |
| `TRUSTED_PROXIES` | api | Comma-separated proxy addresses or CIDR ranges skipped when the client address is read from `X-Forwarded-For`. Required in production (the API refuses to boot without it); unneeded locally |
| `API_PROXY_TARGET` | web (Vite and the nginx template) | `http://localhost:8787` in development; the API's run.app URL in production |
| `API_PROXY_HOST`, `NGINX_RESOLVER` | web (nginx template only) | The Host header sent to the API and the DNS resolver; the image defaults are local placeholders that `infra/deploy.sh` overrides |

Secrets (`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`) live in Secret Manager beside `BETTER_AUTH_SECRET`. `infra/deploy.sh` deploys a `maester-web` Cloud Run service and sets the API's `BETTER_AUTH_URL` and `ALLOWED_ORIGINS` to the web URL. Better Auth's rate limiter uses `storage: "database"` (the `rate_limit` table) and is on in production, or with `AUTH_RATE_LIMIT=on`; the stricter rules are five attempts a minute for sign-in and sign-up and three for password-reset and confirmation-email requests.

Setup the owner does by hand (documented in DEVELOPMENT.md):

1. Google Cloud OAuth consent screen: External, scopes `openid email profile`, published to Production (in Testing only listed test users can sign in).
2. OAuth client, Web application: origins `http://localhost:5173` and the web URL; redirect URIs `<each origin>/api/auth/callback/google`.
3. Resend: a verified sending domain (SPF and DKIM on a domain you own) and an API key in Secret Manager.

## 7. Testing

- **API**, vitest against real Postgres (the existing pattern):
  - the waitlist gate: pending refused, approved created with a workspace, repeat requests not duplicated, an approved row never downgraded; an email sign-up answers a waitlisted address with the same 200 as an approved one;
  - email sign-up blocked until confirmed; confirm and reset links captured from the console mailer and followed; reset revokes sessions;
  - Google through undici `MockAgent` at the token and userinfo endpoints: new approved user, waitlisted (redirect carries `error=WAITLISTED`), returning user, `access_denied`, and a Google account whose email Google has not verified (redirect carries `error=GOOGLE_EMAIL_NOT_VERIFIED`);
  - the takeover test from 3.4: afterwards the attacker's password fails, the attacker's sessions are gone and the victim is in;
  - the rate limit returns 429.
- **Web**: unit tests for `safeNext`, the error-code-to-copy map and the session helper; `pnpm --dir apps/web verify` (design guard, svelte-check with accessibility warnings as errors, lint, build); every state in the browser at 360, 768 and 1280, error states driven by `?error=` URLs.
- **nginx**: `nginx -t` in the image build; a compose smoke test that `GET /api/auth/get-session` answers through the proxy.

## 8. Delivery

Branch `feat/sign-in` from `staging`; commits merge back into `staging`. Three phases, each working on its own:

1. **Plumbing.** Vite and nginx proxies, `BETTER_AUTH_URL` and `ALLOWED_ORIGINS` moved to the web origin, the auth client, real session detection, the terminal rail's account block and sign-out. Done when signing in on the API's dev page and opening `/terminal` on `:5173` shows the session.
2. **Google and the waitlist.** Migration, gate, approve script, Google provider, the Google button and token exception, `/login`'s Google states. Done when an approved Google account reaches `/terminal` and an unapproved one sees the waitlist message.
3. **Email.** Mailer, the email form on `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, the takeover guard. Done when sign-up, confirm, sign-in and reset all work with the console mailer.

Documentation updated in the same change: ADR 0005, DESIGN.md (sections 2 and 5), DATA_MODEL.md, DEVELOPMENT.md (variables and the Google and Resend setup), ARCHITECTURE.md (the R0.5 notes), the contracts README (section 1: the proxy is the setup; the auth endpoints), and the web and API READMEs.
