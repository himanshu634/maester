#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-south1}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
REPO="${REPO:-maester}"
BUCKET="${BUCKET:-maester-private-${PROJECT}}"
QUEUE="${QUEUE:-maester-jobs}"
SQL_INSTANCE="${SQL_INSTANCE:-maester-pg}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:?set ALLOWED_ORIGINS}"
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/$REPO"
API_SA="maester-api@$PROJECT.iam.gserviceaccount.com"
WORKER_SA="maester-worker@$PROJECT.iam.gserviceaccount.com"
MIGRATE_SA="maester-migrate@$PROJECT.iam.gserviceaccount.com"
SQL_CONN="$PROJECT:$REGION:$SQL_INSTANCE"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
WORKER_URL="https://maester-worker-${PROJECT_NUMBER}.${REGION}.run.app"
API_URL="https://maester-api-${PROJECT_NUMBER}.${REGION}.run.app"

gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker build -f apps/api/Dockerfile -t "$REGISTRY/api:$TAG" .
docker build -f apps/worker/Dockerfile -t "$REGISTRY/worker:$TAG" .
docker push "$REGISTRY/api:$TAG"
docker push "$REGISTRY/worker:$TAG"

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

# 3. api (public)
gcloud run deploy maester-api --region="$REGION" --image="$REGISTRY/api:$TAG" \
  --service-account="$API_SA" --allow-unauthenticated \
  --set-cloudsql-instances="$SQL_CONN" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest \
  --set-env-vars="NODE_ENV=production,GCS_BUCKET=$BUCKET,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=$REGION,DISPATCH_MODE=cloud-tasks,CLOUD_TASKS_QUEUE=$QUEUE,WORKER_URL=$WORKER_URL,WORKER_INVOKER_SA=$API_SA,ALLOWED_ORIGINS=$ALLOWED_ORIGINS,BETTER_AUTH_URL=$API_URL" \
  --timeout=1800 --concurrency=80 --min-instances=0 --max-instances=10
echo "api: $API_URL"
echo "worker: $WORKER_URL"
