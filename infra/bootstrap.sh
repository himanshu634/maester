#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-south1}"
BUCKET="${BUCKET:-maester-private-${PROJECT}}"
QUEUE="${QUEUE:-maester-jobs}"
SQL_INSTANCE="${SQL_INSTANCE:-maester-pg}"
DB_NAME="${DB_NAME:-maester}"
REPO="${REPO:-maester}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173}"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com sqladmin.googleapis.com storage.googleapis.com \
  cloudtasks.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com cloudbuild.googleapis.com

# Artifact Registry
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"

# Service accounts
for SA in maester-api maester-worker maester-migrate; do
  gcloud iam service-accounts describe "$SA@$PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$SA" --display-name="$SA"
done
API_SA="maester-api@$PROJECT.iam.gserviceaccount.com"
WORKER_SA="maester-worker@$PROJECT.iam.gserviceaccount.com"
MIGRATE_SA="maester-migrate@$PROJECT.iam.gserviceaccount.com"

# Cloud SQL (Postgres 16, smallest tier; resize later)
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --region="$REGION" \
    --tier=db-g1-small --storage-auto-increase --availability-type=zonal
gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
for SA in "$API_SA" "$WORKER_SA" "$MIGRATE_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/cloudsql.client" --condition=None >/dev/null
done

# Bucket: private, uniform access, versioning, CORS for browser PUTs
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --versioning
ORIGINS_JSON=$(printf '%s' "$ALLOWED_ORIGINS" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?",":""), $i}}')
cat > /tmp/cors.json <<EOF_CORS
[{"origin":[${ORIGINS_JSON}],"method":["PUT"],"responseHeader":["Content-Type","Content-Length"],"maxAgeSeconds":3600}]
EOF_CORS
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/cors.json
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$API_SA" --role="roles/storage.objectUser" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$WORKER_SA" --role="roles/storage.objectViewer" >/dev/null
# API signs V4 URLs via IAM signBlob on its own identity
gcloud iam service-accounts add-iam-policy-binding "$API_SA" --member="serviceAccount:$API_SA" --role="roles/iam.serviceAccountTokenCreator" >/dev/null

# Cloud Tasks queue
gcloud tasks queues describe "$QUEUE" --location="$REGION" >/dev/null 2>&1 || \
  gcloud tasks queues create "$QUEUE" --location="$REGION"
gcloud tasks queues update "$QUEUE" --location="$REGION" --max-attempts=5 --min-backoff=10s --max-backoff=300s --max-concurrent-dispatches=20
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$API_SA" --role="roles/cloudtasks.enqueuer" --condition=None >/dev/null
# API may mint OIDC tokens as the worker invoker (itself) when creating tasks
gcloud iam service-accounts add-iam-policy-binding "$API_SA" --member="serviceAccount:$API_SA" --role="roles/iam.serviceAccountUser" >/dev/null

# Secrets (values set manually afterwards)
for S in DATABASE_URL BETTER_AUTH_SECRET; do
  gcloud secrets describe "$S" >/dev/null 2>&1 || gcloud secrets create "$S" --replication-policy=automatic
done
for SA in "$API_SA" "$WORKER_SA" "$MIGRATE_SA"; do
  gcloud secrets add-iam-policy-binding DATABASE_URL --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null
done
gcloud secrets add-iam-policy-binding BETTER_AUTH_SECRET --member="serviceAccount:$API_SA" --role="roles/secretmanager.secretAccessor" >/dev/null

echo "bootstrap complete. Next: add secret versions:"
echo "  printf '%s' 'postgres://USER:PASS@localhost/$DB_NAME?host=/cloudsql/$PROJECT:$REGION:$SQL_INSTANCE' | gcloud secrets versions add DATABASE_URL --data-file=-"
echo "  openssl rand -base64 48 | gcloud secrets versions add BETTER_AUTH_SECRET --data-file=-"
