# Infra

## Prerequisites

You need `gcloud` authenticated (`gcloud auth login`) against a Google Cloud account with `roles/owner` (or an equivalent superset of IAM, Artifact Registry, Cloud SQL, Cloud Tasks, Storage, and Secret Manager admin roles) on the target project, and a local Docker daemon able to build and push images.

## First-time setup

Run the bootstrap script once per project to provision the shared infrastructure (APIs, Artifact Registry repo, the `maester-api`/`maester-worker`/`maester-migrate` service accounts, a Cloud SQL Postgres 16 instance and database, a private versioned Cloud Storage bucket with CORS for browser `PUT` uploads, the `maester-jobs` Cloud Tasks queue, and the IAM bindings and Secret Manager placeholders those pieces need):

```bash
PROJECT=your-gcp-project ALLOWED_ORIGINS=https://app.example ./infra/bootstrap.sh
```

The script is idempotent — safe to re-run after infra changes. At the end it prints two commands to populate the secret values it created empty; run both, filling in the real Cloud SQL user/password:

```bash
printf '%s' 'postgres://USER:PASS@localhost/maester?host=/cloudsql/PROJECT:REGION:maester-pg' | gcloud secrets versions add DATABASE_URL --data-file=-
openssl rand -base64 48 | gcloud secrets versions add BETTER_AUTH_SECRET --data-file=-
```

## Deploying

Once the secrets have real values, build and ship the images, run migrations, and deploy both Cloud Run services:

```bash
PROJECT=your-gcp-project ALLOWED_ORIGINS=https://app.example ./infra/deploy.sh
```

This builds and pushes the `api` and `worker` images to Artifact Registry, runs the `maester-migrate` Cloud Run job against the new API image (same image, `dist/migrate.js` instead of `dist/server.js`), then deploys `maester-worker` (internal ingress, invokable only by the API service account) followed by `maester-api` (public). `WORKER_URL` and `BETTER_AUTH_URL` are computed up front from the project number and region (Cloud Run's default `https://<service>-<project-number>.<region>.run.app` URL format) and passed in each service's `--set-env-vars` on its first deploy, so both services boot with the env vars their `env.ts` schemas require instead of being patched in afterwards.

Cloud Tasks delivering to the internal-ingress worker works without extra networking configuration: Cloud Run treats traffic from Cloud Tasks (carrying an OIDC token minted for an authorized invoker) as internal, so `--ingress=internal` on `maester-worker` still accepts task dispatches from the API's Cloud Tasks queue while rejecting direct public requests.

## CI/CD

`.github/workflows/ts.yml` lints, typechecks, tests, and builds the TypeScript workspace on every push and pull request, and on `main` runs `infra/deploy.sh` via Workload Identity Federation — no service account keys are stored in the repo. The deploy job needs these repository secrets and variable configured in GitHub before it can run: `GCP_WIF_PROVIDER` (the Workload Identity Federation provider resource name), `GCP_DEPLOY_SA` (the service account the workflow impersonates), `GCP_PROJECT` (the target GCP project id), and the repository variable `ALLOWED_ORIGINS`. Until all four exist, the `deploy` job fails on pushes to `main` — the `check` job (lint/typecheck/test/build) still runs and is unaffected.

The `GCP_DEPLOY_SA` service account needs at least these IAM roles on the project:

- `roles/run.admin`
- `roles/iam.serviceAccountUser` on `maester-api`, `maester-worker`, and `maester-migrate`
- `roles/artifactregistry.writer`
- `roles/cloudsql.viewer`
- `roles/secretmanager.viewer`
- `roles/viewer` on the project (needed for `gcloud projects describe`, which `deploy.sh` uses to compute the Cloud Run service URLs)

Note: `bootstrap.sh` sets the `maester-jobs` queue to unlimited delivery attempts (`--max-attempts=unlimited`), so a job's own `max_attempts` column is what actually bounds retries, not the queue.
