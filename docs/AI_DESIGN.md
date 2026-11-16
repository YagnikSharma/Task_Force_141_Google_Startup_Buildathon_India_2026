# AI design: Gemini with a safety net

NSIN uses AI where it changes outcomes: understanding a messy, panicked report in seconds, and briefing a volunteer who has never handled that situation before. Because this is emergency software, AI must also be **safe to be wrong**. Every design choice below follows from that.

## 1. Models and where they run

| Model | Purpose | Called from |
|---|---|---|
| `gemini-3.8-flash` (Gemini API) | Triage with **structured output** (Pydantic schema → JSON); responder briefing grounded in retrieved protocols | `ai/triage.py`, `ai/briefing.py` |
| `gemini-embedding-001` at 768 dims | Protocol passages (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`) and incident similarity (`SEMANTIC_SIMILARITY`) | `ai/retrieval.py`, `ai/vector_store.py` |

One client (`ai/gemini.py`, Google Gen AI SDK `google-genai`) serves two back ends:
- **Gemini Developer API**, with a key from **Google AI Studio**: local development and the free tier.
- **Vertex AI**, with `GOOGLE_GENAI_USE_VERTEXAI=true`: on Cloud Run the service account authenticates, so no key is stored.

Models are configuration (`GEMINI_MODEL`, `GEMINI_EMBED_MODEL`), so a newer Gemini model is a one-line change.

## 2. Triage workflow (`ai/triage.py`)

```
intake (rules) → assess (rules) → Gemini (structured JSON) → merge → route → retrieve protocols
```

| Step | What happens |
|---|---|
| Rules: intake | Whole-word keyword matching ("person" never matches "son"), location extraction, missing-information checks |
| Rules: assess | Priority ladder P1–P4 with a reason and a checklist. It always runs and never needs the network |
| Gemini | Receives the report, the app's location and the rule pre-screen. Returns `GeminiTriage`: category, priority, reasoning, responder briefing, up to 4 actions, missing information, detected language, location |
| Merge | **Final priority = the more severe of Gemini and the rules.** Gemini can escalate (it understands *"saans nahi le pa rahe"*, which the keywords miss) but can never downgrade a life-threat keyword |
| Route | P1 → escalated, with *"Call 112 now…"* as the first action |
| Retrieve | Cites the approved protocol for the final category |

Every response says which engine decided (`ai_engine`: `gemini:<model>` or `rules`), what the rules alone decided (`rule_priority`), and why Gemini was skipped if it was (`gemini_error`). Responders can always see how a decision was made.

## 3. Hybrid protocol retrieval (`ai/retrieval.py`)
- **Passages.** Six approved protocols are split into 60-word windows with a 12-word overlap. Each passage is stored once per audience, so audience filters are simple equality checks.
- **Two branches:**
  - **BM25 (Okapi).** In memory, always available.
  - **Dense.** The Gemini query embedding is compared against `protocol_passages.embedding` with pgvector cosine distance (`<=>`) on an HNSW index.
- **Gating.** Dense hits are kept only below a calibrated distance (`RETRIEVAL_MAX_DISTANCE`), so off-topic questions ("pasta recipe") return *nothing* instead of a confident wrong protocol.
- **Fusion.** Normalised reciprocal rank fusion, plus a soft prior for the protocol category that matches the triage result.
- **Citations.** Every result carries the exact passage that matched, and whether it matched by `bm25`, `vector` or both.

### Measured calibration (gemini-embedding-001, 768 dims, cosine distance)
| Query | Top protocol | Distance |
|---|---|---|
| my son has not reached home from school | Child safety | 0.288 |
| what should a responder do when they claim an incident | Responder procedures | 0.328 |
| elderly neighbour not answering the door | Elder care | 0.343 |
| someone is following me home at night | Women's transit safety | 0.363 |
| my grandmother is not answering her phone | Elder care | 0.372 |
| the streetlight on our lane is broken | Hazards | 0.390 |
| quantum astrophysics spaceship orbit | (rejected) | 0.463 |
| stock market tips for today | (rejected) | 0.470 |
| what is the recipe for pasta | (rejected) | 0.475 |

On-topic questions put the right protocol first at ≤ 0.39, and off-topic ones start at 0.46. The gates are `RETRIEVAL_STRONG_MATCH=0.40` and `RETRIEVAL_MAX_DISTANCE=0.43`. For incidents, two reports of the same event measured 0.03–0.09 and different incidents 0.16 or more, so `SIMILAR_INCIDENT_MAX_DISTANCE=0.12`.

## 4. Grounded responder briefing (`ai/briefing.py`)
Gemini receives only the report, the triage result and the retrieved passages. It returns `Briefing`: a summary, exactly three actions and the protocol title it used. The API checks that the title is one of the retrieved protocols (`grounded: true/false`). The briefing never changes the priority.

## 5. Related reports (`ai/vector_store.py`)
Each incident is embedded on creation. Responders get reports within `SIMILAR_INCIDENT_MAX_DISTANCE` cosine distance, with reports at the same address ranked first, so five reports of one broken streetlight become one job.

## 6. Resilience: an SOS never waits on a model
- **Fallback chain:** `GEMINI_MODEL` (default `gemini-3.8-flash`), then `GEMINI_FALLBACK_MODELS` (`gemini-3.5-flash`, `gemini-3.1-flash-lite`). We found this the hard way: Google retired `gemini-2.5-flash` for new keys mid-build, and the free tier's daily quota runs out during heavy testing.
- **Quota-aware:** a model that answers `429 RESOURCE_EXHAUSTED` is skipped for 2 minutes, and a retired one (`404`) for an hour, instead of being retried.
- **Time budget:** at most `GEMINI_BUDGET_SECONDS` (20 s) across all models, `GEMINI_TIMEOUT_SECONDS` (12 s) per request, and one quick retry on `5xx`.
- **Measured:** 2.7–7 s per triage on the free tier, even while two models were out of quota. Before the budget existed, the same situation took 42–71 s.

## 7. Failure modes (tested)
| Situation | Behaviour | Test |
|---|---|---|
| No key configured | Rules decide; `gemini_error` explains | `test_triage_without_gemini_key_falls_back_to_rules` |
| Key rejected by Google | Rules decide | `test_triage_with_invalid_key_falls_back_to_rules` |
| Briefing unavailable | Triage is still returned with `briefing_error` | `test_briefing_degrades_when_gemini_is_unavailable` |
| Gemini tries to downgrade a knife attack | Stays P1 | `test_gemini_never_downgrades_a_life_threat` |

## 8. Privacy
- Only the report text and the app-supplied location are sent to Gemini. The app never adds account details (name, phone, emergency medical notes) to a prompt.
- **Free tier vs production.** On the free Gemini API tier, Google may use prompts to improve its products, so the free tier is for development and demos with synthetic data only. Real resident data goes through **Vertex AI** (or the paid Gemini API tier), where prompts are not used for training and processing stays in the chosen region.
- Embeddings are stored in our own Cloud SQL database, not in a third-party vector service.

## 9. Roadmap
- **Gemini Live:** voice SOS with follow-up questions, for callers who can't type.
- **Gemma on Android:** offline triage when the network drops.
- **Google Agent Skills:** package dispatch (responder matching, 112 escalation) as skills for an agent.
