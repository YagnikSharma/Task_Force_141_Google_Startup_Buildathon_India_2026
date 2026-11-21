# NSIN: Buildathon readiness (evaluation map)

Status on 20 Nov 2026. This page maps each judging criterion to:
- what is built;
- where the evidence is;
- how to demo it live;
- what is still missing.

What the Google team said they judge first: **the live, deployed link that a judge can use.** The deck and video are extras. So everything below is ordered around a judge clicking through the live app alone.

**Demo logins** (seeded in every environment, password `Password123!`):

| Role | Email |
|---|---|
| Resident | `resident@neighbourhood.org` |
| Responder | `responder@neighbourhood.org` |
| Admin (RWA) | `admin@neighbourhood.org` |

---

## 1. Functional product and implementation (30%)

| Workflow | Built | Evidence | Live demo step |
|---|---|---|---|
| One-tap SOS with live location | ✅ | `api/v1/sos.py`, Resident dashboard | Log in as resident → Emergency SOS |
| Incident report → Gemini triage → saved incident | ✅ | `ai/triage.py`, `api/v1/incidents.py`, `ReportIncidentPage.tsx` | Report incident → type Hinglish text → "Analyse" → submit |
| Responder lifecycle (claim → en route → on scene → resolved) | ✅ | State machine `ALLOWED_TRANSITIONS`, audit log | Log in as responder → Claim & Acknowledge |
| Staff priority override with reason (audited) | ✅ | `POST /incidents/{id}/priority` | Incident page → override priority |
| **Live community map** (alerts, hazards, responders, privacy masking) | ✅ | `api/v1/live_map.py`, `/map` | Open Live Map |
| Demo dispatch: a responder unit drives to the incident with an ETA | ✅ | `POST /map/demo/dispatch/{id}` | Live Map → "Dispatch (demo)" |
| **NSIN Copilot agent** (Gemini tool calling, confirm-to-act) | ✅ new | `ai/agent.py`, `api/v1/agent.py`, `CopilotPanel.tsx` | "Ask Copilot" button on any page |
| Child commute tracking, elder check-ins, trusted contacts | ✅ | `children.py`, `elder_care.py`, `trusted_contacts.py` | Resident pages |
| Community insights (median / p90 response, SLA breaches, hotspots) | ✅ | `analytics/insights.py` | Community Insights |
| Persistence, validation, loading and error states | ✅ | PostgreSQL; Pydantic limits; UI spinners and messages | – |

**Tests:**
- 88 pass offline (no AI calls, test database `nsin_test`).
- 12 more run only with a Gemini key. On 20 Nov, Gemini's free tier was overloaded (503/504), so these were not all green; the code paths fell back correctly. Rerun them once after deploying, against the paid key or Vertex AI.

**Gaps:**
- Push notifications (FCM) are planned, not built.
- The Android APK still needs a GitHub Actions build.

## 2. Technical architecture (20%)

- **Stack:** FastAPI on Cloud Run, Cloud SQL PostgreSQL 16 + pgvector, React web app on Firebase Hosting, and a native Android app (Kotlin, Compose).
- **Modular:** one router per domain (`api/v1/*`). AI lives in `ai/` (triage, retrieval, briefing, vector store, agent). One Gemini wrapper (`ai/gemini.py`) holds every model call, fallback, timeout and cache.
- **Security:**
  - JWT auth and role checks on every write;
  - staff-only tools are hidden from residents' agents, and permissions are re-checked on confirm;
  - login throttle and an agent message limit (30 per 10 min per user);
  - append-only audit log;
  - secrets in Secret Manager;
  - non-root container;
  - `/health` hides connection details in production.
- **Reliability:**
  - The rule engine always runs, so an SOS never waits for AI.
  - Model fallback chain with a time budget; overloaded models are skipped for 30 s, quota-exhausted ones for 2 min and retired ones for 1 h.
  - Fixed on 20 Nov: per-request deadlines are now at least 10 s, because the Gemini API rejects shorter ones (this had silently disabled the fallback models).
- **Cost:** Cloud Run scales 0 to 2 instances, output tokens are capped, and Gemini answers are cached for 1 h.
- **Documentation:** `architecture.md` (diagram and data flow), `docs/AI_DESIGN.md`, `docs/SECURITY.md`, `docs/TESTING.md`.

The architecture diagram in `architecture.md` includes the Copilot agent.

## 3. Google AI integration depth (20%)

| Capability | How it is used (real, in code) |
|---|---|
| **Gemini structured output** | Triage returns Pydantic-validated JSON: category, priority, reasoning, actions and missing info. It reads English, Hindi and Hinglish. |
| **Gemini function calling (agent)** | NSIN Copilot has 9 tools: 5 read tools that query the live database, and 4 write tools that only run after the user presses **Confirm**. It runs up to 4 reasoning steps per message, with a role-aware tool list. |
| **Gemini embeddings** (`gemini-embedding-001`, 768-d) | Hybrid protocol retrieval (BM25 + pgvector, RRF) and duplicate-incident detection |
| **Grounded generation** | Responder briefings must cite a retrieved protocol |
| **Model selection and cost** | Flash and flash-lite only. Fallback chain `gemini-3.8-flash → gemini-3.5-flash → gemini-3.1-flash-lite`, token caps and a response cache |
| **Failure handling** | No key, a quota error or an outage → rule triage plus BM25 citations, and the agent answers from the protocol library. The UI labels which engine answered. |

**Evaluated and deliberately NOT integrated** (they don't serve the safety problem; adding them for logos would cost credits and the judges would see through it):
- Nano Banana (image generation);
- Lyria (music);
- BigQuery and AlloyDB: Cloud SQL + pgvector already covers our data size, and a second database adds cost and risk;
- Conversational Analytics: the Copilot already answers questions over live app data.

**Planned (labelled in the README roadmap):**
- Gemini Live voice SOS;
- Gemma on-device triage;
- Agent Skills packaging for dispatch;
- Firebase Auth and FCM;
- Google Maps Platform (the map uses Google Maps automatically when `VITE_GOOGLE_MAPS_API_KEY` is set at build time).

**Decision needed before the demo:** which Gemini endpoint the live demo uses. The free-tier AI Studio key was overloaded today. Options:
- a key from the $300 billing project;
- Vertex AI, via `GOOGLE_GENAI_USE_VERTEXAI=true` and Cloud Run's service account, so no key is needed.

Flash costs are a few cents for a whole demo day.

## 4. Problem-solution alignment (15%)

- **Problem:** in Indian cities, official help takes 15–30+ minutes, while the neighbour who could help in 2 minutes never finds out. WhatsApp groups bury alerts.
- Every feature maps to that problem:
  - SOS and triage get the right help fast;
  - the map and dispatch show help on its way;
  - the Copilot lets anyone, in Hinglish, find out what to do and file a proper report;
  - insights give RWAs response-time data.
- Women's safety in transit is the planned next module (safe-route score, women-only circle, "check on me").

## 5. UX, usability and accessibility (10%)

- Role-based navigation, a mobile-friendly layout (the Copilot is full-screen on phones), and loading and error states everywhere.
- **Accessibility:**
  - the Copilot is a labelled dialog, closes with Esc, announces replies to screen readers (`aria-live`) and has visible focus rings;
  - Enter sends, and Shift+Enter adds a new line;
  - location sharing is off by default and needs a tick, as consent.
- The 112 emergency hint is visible in the Copilot at all times.

**Gap:** a full visual redesign (shadcn/ui) was postponed in favour of working features.

## 6. Innovation and differentiation (5%)

- **AI that can't make things worse:** Gemini may raise a priority but never lower it below the safety rules.
- **An agent that acts, with a human in the loop:** the Copilot does real work (files reports, dispatches responders), but every change needs a human Confirm and lands in the audit log.
- **Privacy by design:** other residents' alerts are masked by about 110 m, with no names and no phone numbers.
- **Built in the final sprint (20 Nov):** NSIN Copilot agent, live map with demo dispatch, priority override, GPS-first reporting, Gemini reliability fixes, and the map fix for production builds.

## Live demo script (about 5 minutes)

1. **Landing page →** "Open the app" → log in as **resident**.
2. **Report incident:**
   - Type: *"Ek aadmi raat se gali mein ghoom raha hai, mask pehna hai, Babar Road, Bengali Market."*
   - Press Analyse: Gemini triage, priority and cited protocol appear.
   - Submit.
3. **Ask Copilot:**
   - Ask *"Is my neighbourhood safe right now?"*: it shows the tools used (live data).
   - Then *"Streetlight outside Sector 12 park is broken, report it"*: a **Confirm** card appears. Press Confirm and the report is filed.
4. Log out, then log in as **admin**.
5. **Copilot:** *"Dispatch help to the most critical open incident"* → Confirm.
6. **Live Map:** watch the responder drive to the incident with its ETA.
7. **Incident page:** see the timeline, then override the priority with a reason (audited).
8. **Community Insights:** response-time analytics.
9. Show `/health` on the API URL: Gemini, pgvector, the agent and its tools.

## Remaining before submission (in order)

1. **Deploy** (needs your OK at each step):
   - log in with `gcloud auth login` as yagniksharma47;
   - run `setup.sh`, then `deploy.sh`, then Firebase.
2. Choose the Gemini endpoint for the live demo (see section 3), then run the 12 Gemini tests once against it.
3. Smoke-test the live URL with all three logins.
4. Record the demo video from the script above.
5. Update the deck (it still says "Gemini 2.5 Flash"; the app uses the 3.x flash chain) and add the Copilot slide.
