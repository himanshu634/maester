# Infra

## Prerequisites

You need `gcloud` authenticated (`gcloud auth login`) against a Google Cloud account with `roles/owner` (or an equivalent superset of IAM, Artifact Registry, Cloud SQL, Cloud Tasks, Storage, and Secret Manager admin roles) on the target project, and a local Docker daemon able to build and push images.

## First-time setup

Run the bootstrap script once per project to provision the shared infrastructure (APIs, Artifact Registry repo, the `maester-api`/`maester-worker`/`maester-migrate` service accounts, a Cloud SQL Postgres 16 instance and database, a private versioned Cloud Storage bucket with CORS for browser `PUT` uploads, the `maester-jobs` Cloud Tasks queue, and the IAM bindings and Secret Manager placeholders those pieces need):

```bash
PROJECT=your-gcp-project ALLOWED_ORIGINS=https://maester-web-PROJECT_NUMBER.asia-south1.run.app ./infra/bootstrap.sh
```

`ALLOWED_ORIGINS` here is the web service's URL (or your custom domain for it): the browser uploads straight to the bucket from that origin, so it is the only origin the bucket's CORS rule needs. `deploy.sh` sets the same value on the API.

The script is idempotent — safe to re-run after infra changes. At the end it prints the commands to populate the secret values it created empty; run all four, filling in the real Cloud SQL user/password, the Google OAuth client secret and the Resend API key:

```bash
printf '%s' 'postgres://USER:PASS@localhost/maester?host=/cloudsql/PROJECT:REGION:maester-pg' | gcloud secrets versions add DATABASE_URL --data-file=-
openssl rand -base64 48 | gcloud secrets versions add BETTER_AUTH_SECRET --data-file=-
printf %s "<client secret>" | gcloud secrets versions add GOOGLE_CLIENT_SECRET --data-file=-
printf %s "<Resend API key>" | gcloud secrets versions add RESEND_API_KEY --data-file=-
```

### Google and Resend, by hand

Sign-in needs two things that no script here can create. Do them once, before the first deploy; the steps are in [sign-in](../docs/SIGN_IN.md) section 6:

1. The Google Cloud OAuth consent screen, published to Production (in Testing only listed test users can sign in), and a Web application OAuth client whose redirect URI is `<web URL>/api/auth/callback/google`. Its client id is the `GOOGLE_CLIENT_ID` repository variable below; its secret goes into `GOOGLE_CLIENT_SECRET`.
2. A Resend sending domain with SPF and DKIM on a domain you own, and an API key in `RESEND_API_KEY`. `MAIL_FROM` is an address on that domain.

## Deploying

Once the secrets have real values, build and ship the images, run migrations, and deploy the three Cloud Run services:

```bash
PROJECT=your-gcp-project GOOGLE_CLIENT_ID=1234-abcd.apps.googleusercontent.com MAIL_FROM='Maester <hello@your-domain>' ./infra/deploy.sh
```

This builds and pushes the `api`, `worker` and `web` images to Artifact Registry, runs the `maester-migrate` Cloud Run job against the new API image (same image, `dist/migrate.js` instead of `dist/server.js`), then deploys `maester-worker` (internal ingress, invokable only by the API service account), `maester-api` (public) and `maester-web` (public). `WORKER_URL`, `API_URL` and `WEB_URL` are computed up front from the project number and region (Cloud Run's default `https://<service>-<project-number>.<region>.run.app` URL format) and passed to the services that need them on their first deploy (the worker and the API get `WORKER_URL`; the API gets `WEB_URL` as `BETTER_AUTH_URL` and `ALLOWED_ORIGINS`; the web service gets `API_URL` as `API_PROXY_TARGET` and `API_PROXY_HOST`), so every service boots with the env vars its `env.ts` schema requires instead of being patched in afterwards. Set `WEB_URL` yourself if the web service is served from a custom domain.

The browser only ever talks to the web service. Its nginx serves the static pages and proxies `/api/auth`, `/v1` and `/dev` to the API (`API_PROXY_TARGET` and `API_PROXY_HOST`, set by `deploy.sh`; the defaults baked into the web image are local placeholders). So the API's `BETTER_AUTH_URL` and `ALLOWED_ORIGINS` are the web URL, not the API's, and the Google callback is `<web URL>/api/auth/callback/google`. The API does not mount `/dev` in production, so that proxied path answers 404 there.

The API's environment in production, beyond the storage and dispatch settings: `GOOGLE_CLIENT_ID` (a variable), `GOOGLE_CLIENT_SECRET` and `RESEND_API_KEY` (mounted from Secret Manager), `MAIL_DRIVER=resend` (the `console` driver is refused in production), `MAIL_FROM` and `TRUSTED_PROXIES`. `MAIL_FROM` has spaces and angle brackets and `TRUSTED_PROXIES` has commas, so `deploy.sh` passes the API's variables with gcloud's `^#^` alternate delimiter; keep `#` out of any value you add. `deploy.sh` stops before building if `MAIL_FROM`, `TRUSTED_PROXIES` or `GOOGLE_CLIENT_ID` contains one.

### TRUSTED_PROXIES

The auth rate limiter counts attempts per client address, which the API reads from `X-Forwarded-For`. The API refuses to boot in production without `TRUSTED_PROXIES`, a comma-separated list of proxy addresses and ranges that the API skips when it reads the header from the right. `deploy.sh` defaults it to `35.191.0.0/16,130.211.0.0/22,169.254.0.0/16` (Google's front-end ranges and Cloud Run's link-local range). Those ranges are a starting point that the smoke test below checks; they are not assumed to be right. Override them with `TRUSTED_PROXIES=… ./infra/deploy.sh`. The limiter is on in production; outside it, `AUTH_RATE_LIMIT=on` turns it on (the default is `off`).

Better Auth walks the header from the right, skips every address in `TRUSTED_PROXIES` and takes the first one that is not a trusted proxy. Whatever a client puts at the front of `X-Forwarded-For` is never reached, so it cannot open a new bucket. The real risk is the opposite: the browser reaches the API through `maester-web`, and if the address the API takes for the client is the web service's shared egress address, every client lands in one bucket, and five wrong passwords from anyone block sign-in for everyone for a minute. The smoke test below catches this, and the remedy follows it. The per-account protections (email confirmation, a reset that revokes sessions) do not depend on the limiter; see [ADR 0005](../docs/decisions/0005-sign-in-google-email-waitlist.md).

Reset and confirmation tokens travel in query strings, so for their one-hour life they appear in `maester-web`'s and `maester-api`'s request logs and in nginx's access log. An unused confirmation link in a log signs in whoever opens it: restrict who can read those logs.

### Smoke test after a deploy

Run this from your own machine against the web URL. It sends six wrong-password sign-ins for an address that does not exist:

```bash
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " -X POST "$WEB_URL/api/auth/sign-in/email" -H "content-type: application/json" -H "origin: $WEB_URL" -d '{"email":"nobody@example.com","password":"wrong-password"}'; done; echo
```

Expected: five `401`s then `429`. All `401`s means the limiter cannot see the browser's address, so `TRUSTED_PROXIES` needs adjusting.

That result does not prove `TRUSTED_PROXIES` is right. If the API keys every request to one address, the six requests above also end in `429`, and so would everyone else's. One address can be shared like this when the API sees the web container's own egress address instead of the browser's: nginx forwards the browser's address, but the hop from the web service to the API's public URL may add the web container's egress address to the header, and if `TRUSTED_PROXIES` does not cover it, it can be taken for the client. So run a second check from a different network, for example Cloud Shell, within the same minute as the first. After the five failures, one attempt from that network must still answer `401`, not `429`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WEB_URL/api/auth/sign-in/email" -H "content-type: application/json" -H "origin: $WEB_URL" -d '{"email":"nobody@example.com","password":"wrong-password"}'
```

If it answers `429`, all clients share one bucket. Cloud Run's default egress has no fixed address, so there is no range to add. The remedy is to give `maester-web` a fixed one: route its egress through a VPC with Direct VPC egress (`--network`, `--subnet`, `--vpc-egress=all-traffic`), put Cloud NAT with a reserved static IP on that subnet's router, then add that address as a `/32` to `TRUSTED_PROXIES` and deploy again with `TRUSTED_PROXIES=…,<static-ip>/32 ./infra/deploy.sh`. Wait a minute between runs, because the first check fills the bucket for the address it came from, and repeat both checks. Sign-in must not open to users until the second-network check answers `401`.

Cloud Tasks delivering to the internal-ingress worker works without extra networking configuration: Cloud Run treats traffic from Cloud Tasks (carrying an OIDC token minted for an authorized invoker) as internal, so `--ingress=internal` on `maester-worker` still accepts task dispatches from the API's Cloud Tasks queue while rejecting direct public requests.

## CI/CD

`.github/workflows/ts.yml` lints, typechecks, tests, and builds the TypeScript workspace on every push and pull request, and on `main` runs `infra/deploy.sh` via Workload Identity Federation — no service account keys are stored in the repo. The deploy job needs these repository secrets and variables configured in GitHub before it can run: `GCP_WIF_PROVIDER` (the Workload Identity Federation provider resource name), `GCP_DEPLOY_SA` (the service account the workflow impersonates), `GCP_PROJECT` (the target GCP project id), and the repository variables `GOOGLE_CLIENT_ID` (the OAuth client id) and `MAIL_FROM` (the sender, for example `Maester <hello@your-domain>`). The workflow no longer sets `ALLOWED_ORIGINS`: `deploy.sh` derives it from the web URL. Until all five exist, the `deploy` job fails on pushes to `main` — the `check` job (lint/typecheck/test/build) still runs and is unaffected.

The `GCP_DEPLOY_SA` service account needs at least these IAM roles on the project:

- `roles/run.admin`
- `roles/iam.serviceAccountUser` on `maester-api`, `maester-worker`, and `maester-migrate`
- `roles/artifactregistry.writer`
- `roles/cloudsql.viewer`
- `roles/secretmanager.viewer`
- `roles/viewer` on the project (needed for `gcloud projects describe`, which `deploy.sh` uses to compute the Cloud Run service URLs)
- `roles/iam.serviceAccountUser` on the account `maester-web` runs as. `deploy.sh` passes no `--service-account` for the web service, so it runs as the project's default Cloud Run runtime account; grant the role on that account, or create a dedicated service account for the web service and pass it

Note: `bootstrap.sh` sets the `maester-jobs` queue to unlimited delivery attempts (`--max-attempts=unlimited`), so a job's own `max_attempts` column is what actually bounds retries, not the queue.

## Extraction is not deployed yet

`deploy.sh` does not deploy `apps/extractor`, and the deployed worker has no `EXTRACTOR_URL`, so production documents are verified but not extracted. Enabling it needs a `maester-extractor` Cloud Run service (internal ingress, a `--timeout` above 15 minutes, a service account with Vertex AI access), the worker's service account as its invoker, permission for the worker to enqueue Cloud Tasks as the invoker service account, the worker variables listed in [document extraction](../docs/EXTRACTION.md) section 7, a worker `--timeout` above its 900 s extractor timeout, and a dispatch deadline on the tasks the API enqueues for `POST …/extract`.
