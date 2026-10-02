# Sign-in: Google, email and the waitlist

Status: proposed 2 October 2026. Design direction A ("Google first, one panel") picked on the [sign-in canvas](https://claude.ai/artifact/VZmn6QA8rBpLuMJ4bWXY1r), round 2. This document is the spec for feature F01's sign-in half ([FEATURE_ROADMAP.md](FEATURE_ROADMAP.md)); ownership enforcement for documents, facts and jobs already exists in `apps/api`.

## 1. Outcome

An investor opens `/login`, signs in with Google or with an email and password, and lands in `/terminal` with a real session and a personal workspace. Maester is invite-only for now: an email that is not approved gets no account and is recorded on a waitlist, and the person is told so plainly.

Success means:

- An approved Google account reaches `/terminal` in one round trip; an unapproved one sees the waitlist message and no account, session or workspace is created.
- An approved email can create an account, confirm the address, sign in, and reset a forgotten password.
- `/terminal` recognises the session (today it cannot, see section 3.5).
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
| Topology | nginx in the web container proxies `/api/auth/*` and `/v1/*` to the API | The browser sees one origin, so the session cookie is first-party; the option [contracts README](../packages/contracts/README.md) section 1 recommends |
| Google mark | The official four-colour G under a guarded token exception | Google's branding rules forbid a monochrome G or a text-only button |

This resolves "Identity provider: not selected" in DELIVERY_PLAN.md; record it as ADR 0005 in the same change.

## 3. Architecture

### 3.1 Topology

```
browser ──▶ web origin (nginx, static files)
              ├─ /api/auth/*, /v1/*  ──▶ maester-api (Cloud Run, *.run.app)
              └─ everything else     ──▶ static files
dev:  vite :5173 ── server.proxy /api/auth, /v1 ──▶ api :8787
```

- `BETTER_AUTH_URL` is the **web** origin in every environment (`http://localhost:5173` in development). The callback is therefore `<web-origin>/api/auth/callback/google`, the same shape locally and in production.
- `ALLOWED_ORIGINS` and Better Auth's `trustedOrigins` hold the web origin only.
- nginx proxy requirements: `proxy_set_header Host <api run.app host>`; `proxy_ssl_server_name on`; a `resolver` with the upstream in a variable so DNS is re-resolved; `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` passed; for `/v1/workspaces/*/jobs/*/events` (SSE) `proxy_buffering off` and `proxy_read_timeout` above the stream's longest silence. The upstream comes from `API_PROXY_TARGET` through the nginx image's `/etc/nginx/templates` substitution.
- The API is already deployed `--allow-unauthenticated`, so nginx needs no IAM token.
- Better Auth reads the client IP from `X-Forwarded-For` (`advanced.ipAddress.ipAddressHeaders`) so rate limits and session IPs are the browser's, not nginx's.

### 3.2 Google sign-in

1. `/login` calls `authClient.signIn.social({ provider: "google", callbackURL: safeNext(next), errorCallbackURL: "/login?next=<next>" })`; the browser goes to Google.
2. Google returns to `/api/auth/callback/google` through the proxy.
3. Better Auth finds the user by email:
   - **Existing user**: Google is linked (`account.accountLinking.trustedProviders: ["google"]`) and a session is issued. See 3.4 for the takeover guard.
   - **New email**: the `user.create.before` hook runs the waitlist gate (3.3). Approved: the user is created, the existing `user.create.after` hook creates the personal workspace, a session is issued. Not approved: the hook throws `APIError` with code `WAITLISTED`; Better Auth forwards the code to `errorCallbackURL` as `?error=WAITLISTED`.
4. The browser lands on `callbackURL`. If the user cancels at Google, it lands on `/login?error=access_denied`.

Scopes: `openid email profile`, nothing more.

### 3.3 The waitlist gate

One function, `admitOrWaitlist(db, { email, source })`, called from `databaseHooks.user.create.before`, so it covers Google and email sign-up alike:

- email normalised (trimmed, lower-cased) before lookup;
- `approved` → returns, creation continues;
- otherwise upserts a `pending` row (never downgrades an `approved` row, never duplicates) and throws `APIError("FORBIDDEN", { code: "WAITLISTED", message: "…" })`.

Email sign-up therefore answers `WAITLISTED` in JSON; Google answers with the redirect. Approval is a script, `pnpm --filter @maester/db waitlist:approve <email>`, which upserts the row as `approved` and sets `approved_at`. Nothing is emailed on approval.

### 3.4 Email and password

- `emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 8 }`.
- `emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true, expiresIn: 3600, sendVerificationEmail }`; the link's `callbackURL` is `/verify-email?next=<next>`.
- `sendResetPassword` sends a link that lands on `/reset-password?token=…`; `resetPasswordTokenExpiresIn: 3600`; `revokeSessionsOnPasswordReset: true`.
- Mail is sent without awaiting it inside the request, so response time does not reveal whether an account exists.
- Option names above are Better Auth's as documented; check each against the installed version (`better-auth` ^1.7) while implementing.
- Sign-in with an unconfirmed email is refused (`403 EMAIL_NOT_VERIFIED`) and a fresh link is sent.
- **Takeover guard.** The attack: someone registers a victim's approved email with a password and never confirms it; later the victim signs in with Google and the accounts link. Defence: an `account.create.after` hook — when a `google` account is created for a user whose `emailVerified` was false, delete that user's `credential` account, revoke all of their other sessions and set `emailVerified` true. The attacker's password then no longer exists. A test covers exactly this.

### 3.5 Session detection on the web

`apps/web/src/lib/session.ts` looks for a `maester_session` cookie. The API sets `maester.session_token`, `HttpOnly`, which script can never read, so `/terminal` can never see a session. Replace it: `getSession()` through the `better-auth/svelte` client (`GET /api/auth/get-session`, same origin). `/terminal` and `/login` use it; `/login` with a session goes straight to `next`. Sign-out is `authClient.signOut()` then `/`.

### 3.6 Data

One new table, `waitlist_entry`, plus `rate_limit` for Better Auth's database-backed limiter. No change to `user`, `session`, `account` or `verification`.

| Column | Type | Notes |
| --- | --- | --- |
| `email` | `text`, primary key | Stored lower-cased; the gate normalises before every read and write |
| `status` | `text`, `check (status in ('pending', 'approved'))` | |
| `source` | `text`, `check (source in ('google', 'email', 'admin'))` | How the email first arrived |
| `requested_at` | `timestamptz not null default now()` | First request; later requests do not move it |
| `approved_at` | `timestamptz` | Set by the approve script |

Migration `0002` in `packages/db/drizzle`, following the existing grant and role conventions (the runtime role reads and writes both tables, owns neither). Recorded in [DATA_MODEL.md](DATA_MODEL.md).

### 3.7 Mail

`apps/api/src/mail/`: a `Mailer` interface (`send({ to, subject, text, html })`) with two drivers. `console` logs the message, including the link, through pino (development and tests). `resend` posts to Resend's API. Two templates, confirm-email and reset-password, plain text plus minimal HTML, in the product's voice: what the link does, that it works once for one hour, and that the person can ignore it if they did not ask.

## 4. Pages and states (direction A)

The canvas is the visual reference; this section is the contract. Every page uses `/login`'s anatomy today: masthead, a 480px panel with a 2px rule, and on `/login` the sign-in illustration filling the right column from 1024px and stacking under the panel below it. The secondary pages drop the illustration. All routes stay prerendered; `next`, `error` and `token` are read on the client.

| Route | Content | States |
| --- | --- | --- |
| `/login` (changed) | "Sign in to the terminal", lede, **Continue with Google** (filled, the one primary action), "or use your email" rule, Email, Password with Show, Sign in (outline), "Forgot your password?", "New to Maester? Create an account", "Back to the index page" | default · Google opening · waitlisted (`?error=WAITLISTED`) · Google cancelled (`?error=access_denied`) · email not confirmed (offer to resend) · wrong email or password · too many attempts · already signed in (go to `next`) · any other `?error` (generic, with "try again") |
| `/signup` (new) | "Create your account", "Maester is open to invited investors for now. Use the email your invitation went to.", **Sign up with Google**, rule, Name, Email, Password with Show and "At least 8 characters.", Create account (outline), "Already have an account? Sign in" | default · field errors · waitlisted · sent (go to `/verify-email`) |
| `/verify-email` (new) | "Check your email", the address, "It works for one hour", Send it again, "Use a different email" | link sent · link worked (go to `next`) · link expired or used (email field, Send a new link) |
| `/forgot-password` (new) | "Reset your password", Email, Send reset link | default · sent (same message whether or not the account exists) |
| `/reset-password` (new) | "Set a new password", New password with Show, Set new password | default · field error · done (go to `/login` with a "Password changed" note) · link expired (Request a new one) |
| Terminal shell (changed) | Rail foot: "Signed in as", the email, Sign out (outline); the same block at the foot of the phone drawer | signing out · signed out (go to `/`) |

Waitlisted, both paths: "You're on the list" / "Maester is open to invited investors for now. We've added `<email>` to the list." / "Nothing else to do. Your Google account was not connected and no workspace was created." (Google path) / "Signed in with the wrong Google account? Use another account". It promises no email and no date.

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
| `API_PROXY_TARGET` | web (Vite and the nginx template) | `http://localhost:8787` in development; the API's run.app URL in production |

Secrets (`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`) live in Secret Manager beside `BETTER_AUTH_SECRET`. `infra/deploy.sh` gains a `maester-web` Cloud Run service and sets the API's `BETTER_AUTH_URL` to the web URL. Better Auth's rate limiter is on with `storage: "database"`.

Setup the owner does by hand (documented in DEVELOPMENT.md):

1. Google Cloud OAuth consent screen: External, scopes `openid email profile`, published to Production (in Testing only listed test users can sign in).
2. OAuth client, Web application: origins `http://localhost:5173` and the web URL; redirect URIs `<each origin>/api/auth/callback/google`.
3. Resend: a verified sending domain (SPF and DKIM on a domain you own) and an API key in Secret Manager.

## 7. Testing

- **API**, vitest against real Postgres (the existing pattern):
  - the waitlist gate: pending refused, approved created with a workspace, repeat requests not duplicated, an approved row never downgraded;
  - email sign-up blocked until confirmed; confirm and reset links captured from the console mailer and followed; reset revokes sessions;
  - Google through undici `MockAgent` at the token and userinfo endpoints: new approved user, waitlisted (redirect carries `error=WAITLISTED`), returning user, `access_denied`;
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
