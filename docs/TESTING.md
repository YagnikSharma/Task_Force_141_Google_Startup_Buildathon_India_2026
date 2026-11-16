# Testing

## Principles
- **Real infrastructure only.** Every test talks to a real PostgreSQL 16 + pgvector database, and the Gemini tests call the real Gemini API. There are **no mocks**.
- **Repeatable.** At the start of a run, `tests/conftest.py` drops and recreates the application's tables, and the app seeds a deterministic 30-day history. Use a dedicated database (the docker compose `db` service is one).
- **Failures are real failures.** Degradation tests break things for real, for example by sending requests with an API key that Google rejects. They don't patch functions.
- **Skips say why.** Tests that need Gemini are skipped with the reason *"needs GEMINI_API_KEY"* when no key is configured, so a run without a key is still honest.

## Running

```bash
docker compose up -d db                                  # PostgreSQL + pgvector on localhost:5433
pip install -r src/backend/requirements.txt
python -m pytest tests --cov=src/backend/app --cov-report=term-missing
```
Put `GEMINI_API_KEY=...` in `src/backend/.env` (see [GOOGLE_CLOUD_SETUP.md](GOOGLE_CLOUD_SETUP.md#part-a-get-a-free-gemini-api-key)) to run the Gemini tests too.

## Latest results

| Run | Result | Coverage |
|---|---|---|
| With the real Gemini API (17 Nov 2026) | **85 tests: 84 passed in the full run; 1 failed once.** That test's Gemini call hit a free-tier `504 DEADLINE_EXCEEDED` (the rule fallback answered as designed), and it passed on rerun | **96%** of `src/backend/app` |
| Without a Gemini key | 75 passed, 10 skipped (all need the key) | 92% |

The free tier has low daily quotas. After several full runs, the bigger models answer `429 RESOURCE_EXHAUSTED`, and NSIN falls back to the next model in `GEMINI_FALLBACK_MODELS`. This is visible in `ai_engine`, for example `gemini:gemini-3.1-flash-lite`.

## What each file proves

| File | What it proves |
|---|---|
| `test_api.py` | End-to-end workflows: health (database mode + Gemini status), login, trusted contacts, the incident lifecycle across resident and responder, SOS, triage persistence |
| `test_security.py` | No admin self-signup, responder verification, login throttling, constant-time unknown emails, token tampering, private-incident isolation, privacy masking, input limits, state machine, reference codes, SOS atomicity + audit, overdue journeys, AI-analysis ownership |
| `test_care.py` | Child journeys and elder check-ins |
| `test_triage.py` | The offline rule engine: 10 wording traps, escalation vs standard branch, location fallback, the cited protocol per category, and the "never downgrade" merge rule |
| `test_retrieval.py` | Passage splitting, BM25 ranking and filters, category and audience filters, passage citations, stop-word queries, API validation, hybrid status |
| `test_gemini.py` | A retired model name falls back to the next Gemini model (a real 404). Gemini embeddings (768 dims). Hinglish SOS escalated to P1 where the keywords alone under-rate it. Gemini can't downgrade a knife attack. The incident-assistance API returns Gemini's analysis. A grounded Gemini briefing. Fallback to rules with no key and with a rejected key. Briefing degradation and the off switch |
| `test_platform_features.py` | SQL analytics: exact median and p90, hotspots, SLA breaches. Schema, `vector` columns and HNSW indexes. pgvector cosine distance. Live health. Semantic retrieval and off-topic rejection. Duplicate-report linking. The `nsin_app` role is denied DDL and audit tampering |

## Static checks
See [SECURITY.md §6](SECURITY.md#6-automated-scans-reproducible): Bandit, pip-audit, npm audit and ruff are all clean.
