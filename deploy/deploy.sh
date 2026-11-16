#!/usr/bin/env bash
# Build and deploy the NSIN API to Cloud Run. Run in Google Cloud Shell after deploy/setup.sh:
#   bash deploy/deploy.sh                # API on Cloud Run
#   DEPLOY_WEB=1 bash deploy/deploy.sh   # also publish the bare web app to Firebase Hosting
# The public site (landing page + the web app at /app/) is deployed from the nsin-google-landing repo.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-south1}"
SQL_INSTANCE="${SQL_INSTANCE:-nsin-db}"
SERVICE="${SERVICE:-nsin-api}"
CONNECTION_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
WEB_ORIGINS="https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

echo "==> Building and deploying the API to Cloud Run (${REGION})"
gcloud builds submit --config cloudbuild.yaml \
  --substitutions="^;^_REGION=${REGION};_SERVICE=${SERVICE};_SQL_INSTANCE=${CONNECTION_NAME};_CORS_ORIGINS=${WEB_ORIGINS}"

API_URL="$(gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.url)')"
echo "==> API live at ${API_URL}"
curl -fsS "${API_URL}/health" | head -c 400 || true
echo

if [[ "${DEPLOY_WEB:-0}" != "1" ]]; then
  echo "Next: deploy the site with the web app at /app/:"
  echo "  git clone https://github.com/YagnikSharma/nsin-google-landing.git && cd nsin-google-landing && bash deploy.sh"
  exit 0
fi

echo "==> Building the web app against ${API_URL}"
(cd src/web-app && npm ci --no-audit --no-fund && VITE_API_BASE_URL="${API_URL}" npm run build)
# The Android app reads the API URL from here (see src/android/app/build.gradle.kts).
printf '{"apiUrl": "%s"}\n' "${API_URL}" > src/web-app/dist/live.json

echo "==> Deploying the web app to Firebase Hosting"
firebase projects:addfirebase "${PROJECT_ID}" >/dev/null 2>&1 || true   # once per project; ignored if already added
firebase deploy --only hosting --project "${PROJECT_ID}"
echo
echo "Done. Web app: https://${PROJECT_ID}.web.app   API: ${API_URL}/docs"
