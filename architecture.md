# System architecture

## Overview
NSIN has three tiers.
- **Clients:** a React web app on Firebase Hosting and a native Android app (Kotlin, Jetpack Compose).
- **API:** one FastAPI backend on **Google Cloud Run**. It owns every business rule: role checks, the incident state machine, SOS routing, journey and check-in tracking, triage, retrieval and analytics.
- **Data:** **Cloud SQL for PostgreSQL 16 with pgvector** is the system of record. It also runs vector search (HNSW, cosine) and the analytics SQL.

**Gemini** sits at the centre of the response loop. It turns free text, including Hindi and Hinglish, into a structured triage decision and a responder briefing. Its embeddings power protocol search and duplicate-report detection. A deterministic rule engine runs beside it, so the product keeps working without the model.

## Diagram

```mermaid
graph TD
    Web["Web app<br/>React 19 + TypeScript<br/>Firebase Hosting"] -->|"HTTPS · JSON · JWT"| API
    Android["Android app<br/>Kotlin + Compose + Retrofit"] -->|"HTTPS · JSON · JWT"| API

    subgraph Run["Google Cloud Run (asia-south1) · autoscaling 0 to 10"]
        API["FastAPI /api/v1<br/>auth · sos · incidents · contacts · children<br/>elder-care · responders · community · ai"]
        SEC["Security<br/>JWT · role checks · login throttle<br/>validation · audit"]
        TRI["Triage workflow<br/>rules: intake → assess<br/>Gemini: structured JSON → merge (never downgrade)<br/>route: escalate / standard"]
        RET["Hybrid retriever<br/>BM25 + pgvector · RRF · filters"]
        VEC["Related-incident search"]
        BRF["Grounded briefing"]
        ANA["Analytics SQL"]
        API --> SEC & TRI & VEC & ANA
        TRI --> RET
        API --> BRF --> RET
    end

    subgraph GAI["Google AI"]
        GEM["Gemini 3.8 Flash<br/>structured output"]
        EMB["gemini-embedding-001<br/>768 dims"]
    end
    TRI --> GEM
    BRF --> GEM
    RET --> EMB
    VEC --> EMB

    subgraph SQL["Cloud SQL for PostgreSQL 16 + pgvector"]
        T1["users · incidents · status history · responders<br/>contacts · journeys · check-ins · hazards"]
        T2["protocol_passages · incident_embeddings<br/>vector(768) + HNSW cosine"]
        T3["audit_events (append-only for the app role)"]
    end
    API -->|"SQLAlchemy + psycopg 3<br/>Cloud SQL unix socket"| SQL
    RET -->|"embedding <=> query"| T2
    VEC -->|"embedding <=> incident"| T2
    ANA -->|"PERCENTILE_CONT · RANK OVER"| T1

    SM["Secret Manager<br/>DB password · JWT secret · Gemini key"] -.-> Run
    CB["Cloud Build → Artifact Registry"] -.->|"deploy"| Run
```

## Request flow: an SOS or incident report
1. The client posts the report. The API validates it (Pydantic; lengths match the columns), writes the incident and its status history in **one transaction**, and records an audit row.
2. **Triage** (`ai/triage.py`):
   - The **rules** classify by whole-word keywords and set a baseline priority. They never need the network.
   - **Gemini** receives the text and the rule pre-screen and returns JSON validated against a Pydantic schema: category, priority, reasoning, responder briefing, actions, missing information, language and location.
   - **Merge:** the final priority is the **more severe** of the two. Gemini can escalate, but never downgrade.
   - **Route:** a P1 is escalated, and "Call 112" becomes the first action.
   - **Retrieve:** the approved protocols for the final category are cited.
3. **Embedding.** The incident is embedded (`SEMANTIC_SIMILARITY`) into `incident_embeddings`. A failure here is logged and never blocks the report.
4. **Responders.** Responders see the queue, claim the incident and move it through the state machine. Every change is audited.
5. **Analytics.** Median and p90 time-to-acknowledge, SLA breaches, hotspots and hourly distribution are computed in SQL over the status history.

## Degradation, on purpose
| Failure | What still works |
|---|---|
| No Gemini key, quota exhausted or outage | Rule triage, BM25 protocol citations, all workflows. `/health` reports why Gemini is off |
| Embedding call fails for one incident | The incident is saved and dispatched; only "related reports" misses it |
| Dense retrieval fails for one query | That query is answered with BM25 only, and the response says so |

## Deployment
| Piece | Google product | Config |
|---|---|---|
| API container | Cloud Build → Artifact Registry → **Cloud Run** | `cloudbuild.yaml`, `src/backend/Dockerfile` |
| Database | **Cloud SQL for PostgreSQL 16** + pgvector, connected over the Cloud SQL unix socket | `INSTANCE_CONNECTION_NAME` |
| Secrets | **Secret Manager**, mounted as environment variables | `--set-secrets` in `cloudbuild.yaml` |
| Web app | **Firebase Hosting** | `firebase.json` |
| One-time setup / deploy | Cloud Shell scripts | `deploy/setup.sh`, `deploy/deploy.sh` |

## Scaling path
- **Stateless API.** Cloud Run scales out per request. Keep minimum instances at 1 during a pilot for instant SOS.
- **Database.** Cloud SQL tiers scale vertically, with read replicas for analytics. pgvector HNSW indexes keep similarity search sub-linear.
- **Per-city deployments** in `asia-south1` (Mumbai) and `asia-south2` (Delhi) give latency and data residency. Pub/Sub can fan out alerts during spikes.
- **Gemini on Vertex AI.** Set `GOOGLE_GENAI_USE_VERTEXAI=true` and Cloud Run's service account is used: no API key, provisioned throughput, and regional endpoints.
