# Google setup, step by step (no prior experience needed)

This guide takes you from "never used Google Cloud" to NSIN running live. There are two parts:

| Part | What you get | Cost | Card needed? |
|---|---|---|---|
| **A. Gemini API key** (10 minutes) | Gemini triage, embeddings and briefings work on your PC and in the tests | Free tier | **No** |
| **B. Google Cloud deploy** (about 45 minutes) | The API on **Cloud Run**, the database on **Cloud SQL**, the web app on **Firebase Hosting** | New accounts get **US$300 free credit for 90 days**. After that, roughly US$10/month for the database; Cloud Run and Hosting are usually free at demo traffic | **Yes**, for identity checks (see B1) |

Do Part A first. It is enough to show Gemini working. Do Part B when you want a public URL.

---

## Part A: get a free Gemini API key

1. Open **https://aistudio.google.com** and sign in with your Google account.
2. Accept the terms if asked.
3. In the left menu, click **Get API key**, or open https://aistudio.google.com/apikey directly.
4. Click **Create API key**. If it asks for a project, choose **Create API key in new project**.
5. Copy the key. It looks like `AIza...` and is about 39 characters long.
   - **Treat it like a password.** Don't paste it in chats, screenshots or GitHub.
6. Put it on your PC, in the backend's private settings file:
   - Copy `.env.example` (in the repo root) to `src/backend/.env`.
   - Open `src/backend/.env` and set `GEMINI_API_KEY=` to your key, with no quotes and no spaces.
   - `src/backend/.env` is listed in `.gitignore`, so git will never upload it.
7. Check it works:
   ```bash
   docker compose up -d db
   python -m pytest tests -q      # the Gemini tests now run instead of being skipped
   ```

The free tier has per-minute and per-day limits. That's plenty for development and a demo. If you ever see `429 RESOURCE_EXHAUSTED`, wait a minute; NSIN falls back to its rule engine automatically, so nothing breaks.

---

## Part B: deploy to Google Cloud

### B1. Create a Google Cloud account and a billing account (one time)
1. Open **https://console.cloud.google.com** and sign in with the same Google account.
2. Click **Activate** or **Start free** (the banner at the top), and choose **India** as the country.
3. Enter your details and a **credit or debit card with online/international payments enabled**.
   - Google only uses the card to check you're a real person. It may hold a small amount and then refund it.
   - On the free trial **you aren't charged automatically**. When the US$300 credit or the 90 days run out, services pause until *you* choose to upgrade.
4. When it's done, you'll see the Google Cloud console with a project called **My First Project**.

### B2. Create a project for NSIN
1. At the top of the console, click the project picker (it says *My First Project*), then click **New project**.
2. Name: `nsin-buildathon`. Google adds a unique **Project ID** such as `nsin-buildathon-123456`. Note it down.
3. Click **Create**, wait a few seconds, then select the new project in the picker.

### B3. Set a budget alert (recommended, 2 minutes)
1. Menu (☰) → **Billing** → **Budgets & alerts** → **Create budget**.
2. Amount: **₹1,000** (or whatever you're comfortable with). Keep the default alerts at 50%, 90% and 100%.
3. You'll get an email long before anything becomes expensive.

### B4. Open Cloud Shell (a free Linux terminal in your browser)
1. Click the **>_** icon (**Activate Cloud Shell**) at the top right of the console.
2. A terminal opens at the bottom of the page. It already has `gcloud`, `docker`, `node`, `git` and `firebase`, so you install nothing.
3. Select your project (use your Project ID from B2):
   ```bash
   gcloud config set project nsin-buildathon-123456
   ```

### B5. Get the code and run the one-time setup
```bash
git clone https://github.com/YagnikSharma/Task_Force_141_Google_Startup_Buildathon_India_2026.git
cd Task_Force_141_Google_Startup_Buildathon_India_2026
bash deploy/setup.sh
```
- It enables the services, creates the container registry, a **Cloud SQL for PostgreSQL 16** instance, the database, the passwords (stored in **Secret Manager**) and the permissions.
- It asks you to **paste your Gemini API key** once. The key goes straight into Secret Manager.
- Creating the database takes **5–10 minutes**. That's normal.
- If Cloud Shell asks you to **Authorize**, click **Authorize**.

### B6. Deploy
```bash
bash deploy/deploy.sh
```
- **Cloud Build** builds the API container and deploys it to **Cloud Run** in Mumbai (`asia-south1`).
- The web app is built and published to **Firebase Hosting**. The first time, Firebase may ask you to log in. Run `firebase login --no-localhost`, open the link, sign in, and paste the code back.
- At the end you'll see two links:
  - Web app: `https://<project-id>.web.app`
  - API: `https://nsin-api-xxxxx-el.a.run.app/docs`

Open the web app and sign in with a demo account, such as `resident@neighbourhood.org` with password `Password123!`.

### B7. Updating after code changes
```bash
cd Task_Force_141_Google_Startup_Buildathon_India_2026 && git pull && bash deploy/deploy.sh
```

### B8. Stop all costs (after the event)
```bash
gcloud sql instances delete nsin-db          # the only thing that costs money while idle
gcloud run services delete nsin-api --region=asia-south1
```
Or delete the whole project: ☰ → **IAM & Admin** → **Settings** → **Shut down**.

---

## What runs where

| Google product | Used for |
|---|---|
| Google AI Studio | Prototyping prompts and schemas; issuing the Gemini API key |
| Gemini API (`gemini-2.5-flash`) | Triage with structured JSON output, and responder briefings |
| Gemini embeddings (`gemini-embedding-001`) | Protocol search and related-incident search (768-dim vectors) |
| Cloud Run | The FastAPI backend: autoscaling, HTTPS, scales to zero |
| Cloud SQL for PostgreSQL + pgvector | All data, vector search and analytics SQL |
| Secret Manager | Database password, JWT secret, Gemini key |
| Cloud Build + Artifact Registry | Building and storing the container image |
| Firebase Hosting | The React web app on a global CDN |
| Google Antigravity | The IDE we develop and test in |

## Troubleshooting

| Message | Fix |
|---|---|
| `PERMISSION_DENIED ... billing` | The project has no billing account. Go to ☰ → Billing → **Link a billing account**. |
| `API ... has not been used in project` | Run `bash deploy/setup.sh` again; it enables the APIs. |
| Cloud Run shows `degraded` in `/health` | Run `gcloud run services logs read nsin-api --region=asia-south1 --limit=50` and check for a database password or Cloud SQL connection error. |
| `429 RESOURCE_EXHAUSTED` from Gemini | That's the free-tier rate limit. Wait a minute. Triage keeps working through the rule engine. |
| Firebase `HTTP Error: 403` | Run `firebase login --reauth` and make sure you picked the same Google account. |
