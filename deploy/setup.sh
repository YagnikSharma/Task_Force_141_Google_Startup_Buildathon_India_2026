#!/usr/bin/env bash
# One-time Google Cloud setup for NSIN. Run it in Google Cloud Shell (it has gcloud, docker, node
# and firebase preinstalled):   bash deploy/setup.sh
#
# What it creates (all in one region, asia-south1 / Mumbai by default):
#   * APIs: Cloud Run, Cloud Build, Artifact Registry, Cloud SQL Admin, Secret Manager
#   * Artifact Registry repository "nsin" for the container image
#   * Cloud SQL for PostgreSQL 16 instance "nsin-db" (smallest shared-core tier), database + user "nsin"
#   * Secrets: nsin-db-password, nsin-jwt-secret (random) and nsin-gemini-api-key (you paste it)
#   * IAM: lets Cloud Build deploy to Cloud Run, and Cloud Run read the secrets and reach Cloud SQL
# Safe to re-run: existing resources are kept.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-south1}"
SQL_INSTANCE="${SQL_INSTANCE:-nsin-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "No project selected. Run: gcloud config set project <your-project-id>" >&2
  exit 1
fi
echo "==> Project ${PROJECT_ID}, region ${REGION}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "==> Enabling APIs (takes a minute the first time)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com

echo "==> Artifact Registry repository"
gcloud artifacts repositories describe nsin --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create nsin --repository-format=docker --location="${REGION}" \
    --description="NSIN container images"

echo "==> Secrets"
secret() {  # secret <name> <value>
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    echo "    $1 exists (kept)"
  else
    printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=-
  fi
}
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)"
secret nsin-db-password "${DB_PASSWORD}"
secret nsin-jwt-secret "$(openssl rand -hex 32)"
if ! gcloud secrets describe nsin-gemini-api-key >/dev/null 2>&1; then
  read -r -s -p "Paste your Gemini API key from https://aistudio.google.com/apikey and press Enter: " GEMINI_KEY
  echo
  secret nsin-gemini-api-key "${GEMINI_KEY}"
fi
DB_PASSWORD="$(gcloud secrets versions access latest --secret=nsin-db-password)"

echo "==> Cloud SQL for PostgreSQL (creating an instance takes 5-10 minutes)"
if ! gcloud sql instances describe "${SQL_INSTANCE}" >/dev/null 2>&1; then
  gcloud sql instances create "${SQL_INSTANCE}" --database-version=POSTGRES_16 --edition=enterprise \
    --tier="${SQL_TIER}" --region="${REGION}" --storage-size=10 --storage-auto-increase
fi
gcloud sql databases describe nsin --instance="${SQL_INSTANCE}" >/dev/null 2>&1 || \
  gcloud sql databases create nsin --instance="${SQL_INSTANCE}"
if gcloud sql users list --instance="${SQL_INSTANCE}" --format='value(name)' | grep -qx nsin; then
  gcloud sql users set-password nsin --instance="${SQL_INSTANCE}" --password="${DB_PASSWORD}"
else
  gcloud sql users create nsin --instance="${SQL_INSTANCE}" --password="${DB_PASSWORD}"
fi

echo "==> IAM for Cloud Build and Cloud Run"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
for SA in "${COMPUTE_SA}" "${BUILD_SA}"; do
  for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer \
              roles/cloudsql.client roles/secretmanager.secretAccessor roles/logging.logWriter; do
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" --member="serviceAccount:${SA}" \
      --role="${ROLE}" --condition=None --quiet >/dev/null 2>&1 || true
  done
done

echo
echo "Setup complete. Next: bash deploy/deploy.sh"
