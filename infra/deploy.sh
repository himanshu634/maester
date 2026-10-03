#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-south1}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
REPO="${REPO:-maester}"
BUCKET="${BUCKET:-maester-private-${PROJECT}}"
QUEUE="${QUEUE:-maester-jobs}"
SQL_INSTANCE="${SQL_INSTANCE:-maester-pg}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}"
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/$REPO"
API_SA="maester-api@$PROJECT.iam.gserviceaccount.com"
WORKER_SA="maester-worker@$PROJECT.iam.gserviceaccount.com"
MIGRATE_SA="maester-migrate@$PROJECT.iam.gserviceaccount.com"
SQL_CONN="$PROJECT:$REGION:$SQL_INSTANCE"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
WORKER_URL="https://maester-worker-${PROJECT_NUMBER}.${REGION}.run.app"
API_URL="https://maester-api-${PROJECT_NUMBER}.${REGION}.run.app"
WEB_URL="${WEB_URL:-https://maester-web-${PROJECT_NUMBER}.${REGION}.run.app}"
MAIL_FROM="${MAIL_FROM:?set MAIL_FROM, e.g. Maester <hello@your-domain>}"
# The API reads the browser's address from X-Forwarded-For, skipping these proxy ranges
# (Google's front end and Cloud Run's link-local range). The smoke test in infra/README.md
# checks them; they are not assumed.
TRUSTED_PROXIES="${TRUSTED_PROXIES:-35.191.0.0/16,130.211.0.0/22,169.254.0.0/16}"
# The browser only talks to the web origin, so it is the only allowed origin.
ALLOWED_ORIGINS="$WEB_URL"

gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker build -f apps/api/Dockerfile -t "$REGISTRY/api:$TAG" .
docker build -f apps/worker/Dockerfile -t "$REGISTRY/worker:$TAG" .
docker build -f apps/web/Dockerfile -t "$REGISTRY/web:$TAG" .
docker push "$REGISTRY/api:$TAG"
docker push "$REGISTRY/worker:$TAG"
docker push "$REGISTRY/web:$TAG"

# 1. migrations (Cloud Run job, same API image, different command)
if gcloud run jobs describe maester-migrate --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update maester-migrate --region="$REGION" --image="$REGISTRY/api:$TAG" \
    --command=node --args=dist/migrate.js --service-account="$MIGRATE_SA" \
    --set-cloudsql-instances="$SQL_CONN" --set-secrets=DATABASE_URL=DATABASE_URL:latest
else
  gcloud run jobs create maester-migrate --region="$REGION" --image="$REGISTRY/api:$TAG" \
    --command=node --args=dist/migrate.js --service-account="$MIGRATE_SA" \
    --set-cloudsql-instances="$SQL_CONN" --set-secrets=DATABASE_URL=DATABASE_URL:latest
fi
gcloud run jobs execute maester-migrate --region="$REGION" --wait

# 2. worker (internal ingress; only the API SA may invoke)
gcloud run deploy maester-worker --region="$REGION" --image="$REGISTRY/worker:$TAG" \
  --service-account="$WORKER_SA" --no-allow-unauthenticated --ingress=internal \
  --set-cloudsql-instances="$SQL_CONN" --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-env-vars="NODE_ENV=production,GCS_BUCKET=$BUCKET,DISPATCH_MODE=cloud-tasks,API_SERVICE_ACCOUNT_EMAIL=$API_SA,WORKER_URL=$WORKER_URL" \
  --timeout=900 --concurrency=4 --min-instances=0 --max-instances=10
gcloud run services add-iam-policy-binding maester-worker --region="$REGION" --member="serviceAccount:$API_SA" --role="roles/run.invoker" >/dev/null

# 3. api (public). MAIL_FROM has spaces and angle brackets, and TRUSTED_PROXIES has commas, so
# the env vars use gcloud's alternate delimiter (#): none of the values contains one.
gcloud run deploy maester-api --region="$REGION" --image="$REGISTRY/api:$TAG" \
  --service-account="$API_SA" --allow-unauthenticated \
  --set-cloudsql-instances="$SQL_CONN" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,RESEND_API_KEY=RESEND_API_KEY:latest \
  --set-env-vars="^#^NODE_ENV=production#GCS_BUCKET=$BUCKET#GOOGLE_CLOUD_PROJECT=$PROJECT#GOOGLE_CLOUD_LOCATION=$REGION#DISPATCH_MODE=cloud-tasks#CLOUD_TASKS_QUEUE=$QUEUE#WORKER_URL=$WORKER_URL#WORKER_INVOKER_SA=$API_SA#ALLOWED_ORIGINS=$ALLOWED_ORIGINS#BETTER_AUTH_URL=$WEB_URL#GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID#MAIL_DRIVER=resend#MAIL_FROM=$MAIL_FROM#TRUSTED_PROXIES=$TRUSTED_PROXIES" \
  --timeout=1800 --concurrency=80 --min-instances=0 --max-instances=10

# 4. web (public): static pages, proxying /api/auth, /v1 and /dev to the API
API_HOST="${API_URL#https://}"
gcloud run deploy maester-web --region="$REGION" --image="$REGISTRY/web:$TAG" \
  --allow-unauthenticated --port=8080 \
  --set-env-vars="API_PROXY_TARGET=$API_URL,API_PROXY_HOST=$API_HOST,NGINX_RESOLVER=169.254.169.254" \
  --concurrency=200 --min-instances=0 --max-instances=10
echo "api: $API_URL"
echo "worker: $WORKER_URL"
echo "web: $WEB_URL"
