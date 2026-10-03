# ADR 0005: Sign-in with Google, email and a waitlist

## Status

Accepted on 2 October 2026. Resolves "Identity provider: not selected" in [DELIVERY_PLAN.md](../DELIVERY_PLAN.md). Supersedes the note in [ADR 0002](0002-web-sveltekit-brutalist-design-system.md) that sign-in is not connected. The spec and the as-built behaviour are in [SIGN_IN.md](../SIGN_IN.md).

## Context

[DELIVERY_PLAN.md](../DELIVERY_PLAN.md) left the identity provider unselected. `apps/api` already ran Better Auth with email and password, Postgres sessions and a personal workspace per user (ADR 0003), but nothing in `apps/web` could use it: the web client could not see the `HttpOnly` session cookie, and the API's origin was a different site from the web origin. Maester is for an invited cohort for now, so anyone may ask for an account but only approved people get one.

## Decision

- Better Auth stays the identity library. Its Google provider (redirect flow, scopes `openid email profile`) and email and password with email confirmation are the two sign-in methods.
- A waitlist gate runs in Better Auth's `user.create.before` hook, so it covers Google and email sign-up alike. An approved email gets an account and a personal workspace; any other email is recorded as pending and gets no user, session or workspace. Approval is a script, `pnpm --filter @maester/db waitlist:approve <email>`, and nothing is emailed on approval.
- Email sign-up does not reveal the waitlist. Better Auth answers a waitlisted sign-up with the same 200 as an approved one, and `/signup` always goes on to `/verify-email`, whose copy covers both cases. Only the Google path says "waitlisted", because Google has already shown who the person is.
- Google sign-in refuses a Google account whose email Google has not verified (`user.validateUserInfo`). Linking Google to an existing account sets `requireLocalEmailVerified: false`, which is safe because a takeover guard (`account.create.before`) removes an unconfirmed password and that account's sessions when Google links.
- Resend delivers confirmation and reset mail; a console driver logs it in development and tests, and is refused in production.
- The web container's nginx proxies `/api/auth`, `/v1` and `/dev` to the API, in `vite dev`, `vite preview` and the deployed image alike. The browser sees one origin, so the session cookie is first-party. `BETTER_AUTH_URL` and `ALLOWED_ORIGINS` are the web origin, and the Google callback is `<web origin>/api/auth/callback/google`.
- The official four-colour Google G is the one colour exception, held in four `--brand-google-*` tokens and used only inside the Google button (Google's branding rules forbid a monochrome G). [DESIGN.md](../DESIGN.md) records it.
- A database-backed rate limiter protects the auth endpoints. It is on in production and off elsewhere unless `AUTH_RATE_LIMIT=on`.

## Alternatives considered

A hosted identity provider in place of Better Auth: not pursued, because Better Auth already owns the users, sessions and the workspace-creating hook in Postgres, and Google is the only other method the product owner asked for. Google One Tap or Google's script on the page: rejected, because it puts a third-party script and iframe on `/login`. Calling the API's own origin from the browser: rejected, because the `SameSite=Lax` session cookie would not be sent from a different site (see the [contracts README](../../packages/contracts/README.md)). Revealing the waitlist on email sign-up with a clear "you're on the list" answer: rejected, because it lets anyone probe which emails are approved.

## Consequences

- The web container now proxies the API, so it is a second public Cloud Run service (`maester-web`) that `infra/deploy.sh` builds and deploys, and the API's `BETTER_AUTH_URL` and `ALLOWED_ORIGINS` are the web URL.
- There are new secrets, `GOOGLE_CLIENT_SECRET` and `RESEND_API_KEY`, in Secret Manager, and new variables, `GOOGLE_CLIENT_ID`, `MAIL_FROM` and `TRUSTED_PROXIES`. A Resend sending domain with SPF and DKIM is a prerequisite.
- Google's consent screen must be published to Production. In Testing, only listed test users can sign in.
- Two tables are added in migration `0002`: `waitlist_entry` and `rate_limit`.
- The rate limiter keys on `X-Forwarded-For`, and a client can prefix that header. Cloud Run appends the real address, so the first entries are client-controlled; the API reads from the right and skips `TRUSTED_PROXIES`, but a determined client can still spread its attempts across many buckets. This is a known limit. The per-account protections (email confirmation, a reset that revokes sessions) do not depend on the limiter. `TRUSTED_PROXIES` is required in production, and the smoke test in [infra/README.md](../../infra/README.md) checks it rather than assuming it.
- **Known limit: pre-registration through the email link.** Someone who knows an approved person's email address can sign up with it first, choosing a password. If the real owner then opens the confirmation email, the impostor's password works on the confirmed account, and the Google takeover guard no longer applies, because the address is now confirmed. Today's mitigation is the wording of the confirmation email: it says someone asked to open an account with this address and tells the reader not to open the link if it was not them, and it carries no name the signer typed. A structural fix, tying the password to whoever confirms the address, is future work.
- Confirmation links are signed tokens that keep working for their hour; reset links work once. Copy never says a confirmation link works once.
