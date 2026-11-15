# Security & Privacy

NSIN handles the most sensitive data a neighbourhood has: where people are, who is alone, who is in danger. This document lists every security control, **where it is implemented**, and **the test that proves it**.

## 1. Threat model (what we defend against)

| Threat | Example | Control | Proof |
|---|---|---|---|
| Privilege escalation | A user registers with `"role": "admin"` | Registration accepts only `resident`, `guardian` and `responder`; responders stay unverified until an admin approves them | `tests/test_security.py::test_admin_role_cannot_be_self_registered`, `test_self_registered_responder_needs_admin_verification` |
| Credential stuffing / brute force | Repeated password guesses | Sliding-window throttle per IP + email → `429` with `Retry-After` | `test_login_is_throttled_after_repeated_failures` |
| User enumeration | Probing which emails exist | Identical response and constant-time bcrypt check for unknown emails | `test_unknown_email_and_wrong_password_look_identical` |
| Token forgery | Edited or replayed JWT | HS256 signature + expiry verification; missing / malformed / tampered tokens get `401` | `test_tampered_or_missing_token_is_rejected` |
| IDOR (reading others' data) | Resident opens another resident's private incident by id | Private incidents are visible to the reporter and verified staff only; others get `404` (ids can't be probed) | `test_private_incidents_are_invisible_to_other_residents` |
| Privacy leak | Public alert reveals who reported it and where | Reporter name and coordinates are masked for other residents; responder GPS is hidden from residents | `test_public_alerts_hide_reporter_identity_and_coordinates`, `test_roster_hides_responder_locations_from_residents` |
| Unauthorised writes | Resident resolves someone else's incident; attaches AI analysis to it | Ownership and role checks on every write | `test_residents_cannot_act_on_others_incidents`, `test_ai_triage_cannot_be_attached_to_someone_elses_incident` |
| SQL injection | Malicious text in a report | All SQL is parameterised (ORM and bound `text()` parameters; vector filters bind values, and column names come from a fixed allow-list). No user input is interpolated into SQL | Bandit scan (below): 0 issues |
| Oversized / malformed input | 300-character title overflowing a `VARCHAR(255)` | Pydantic schemas with enums, coordinate ranges and lengths sized to the columns → `422`, never `500` | `test_input_limits_match_column_sizes`, `test_registration_validates_input` |
| Illegal state changes | Re-opening a resolved incident | Explicit state machine; illegal transitions → `409` | `test_incident_state_machine_rejects_illegal_transitions` |
| Audit tampering | Deleting evidence of an action | Audit rows are written in the same transaction as the change; the app's database role cannot `UPDATE`/`DELETE` `audit_events` | `test_app_role_is_denied_ddl_and_audit_tampering` |
| Database takeover via the app | SQL injection used to `DROP` tables | App runs as a data-only PostgreSQL role: no `CREATE`, `ALTER`, `DROP` | same test (5 statements, all rejected with `permission denied` / `must be owner`) |
| AI outage blocking an SOS | Gemini quota exhausted during a spike | The rule engine always runs first; Gemini failures are caught and reported in `gemini_error` | `test_triage_with_invalid_key_falls_back_to_rules` |
| Error-message leakage | Stack traces revealing SQL | Generic `500` handler; details logged server-side only | `src/backend/app/main.py` (`unhandled_exception_handler`) |
| Prompt injection through AI | A report that tries to talk Gemini into a lower priority | Gemini's output is schema-validated JSON; the final priority is the **more severe** of Gemini and the rules, so a manipulated answer can never downgrade a life-threat. Briefings must cite a retrieved protocol (`grounded`) | `test_gemini_never_downgrades_a_life_threat`, `test_briefing_is_written_by_gemini_and_grounded` |

## 2. Least privilege in PostgreSQL / Cloud SQL

[`db/least_privilege.sql`](../db/least_privilege.sql) creates the role **`nsin_app`**:
- `SELECT, INSERT, UPDATE, DELETE` on the application tables only;
- **no DDL**: `CREATE` on the schema is revoked;
- `audit_events` is **insert and read only**.

The API's login is a member of this role (`CREATE ROLE nsin_api LOGIN ... IN ROLE nsin_app`). The tests run `SET ROLE nsin_app` and prove that `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`, `UPDATE audit_events` and `DELETE FROM audit_events` are all refused, while normal reads and writes succeed (`test_app_role_*`).

## 3. Secrets and configuration
- No secret is committed. `src/backend/.env` is gitignored, and `.env.example` holds placeholders only.
- On Google Cloud, the database password, JWT secret and Gemini key live in **Secret Manager** and reach Cloud Run as environment variables (`--set-secrets`). With `GOOGLE_GENAI_USE_VERTEXAI=true`, no Gemini key is needed at all: Cloud Run's service account authenticates to Vertex AI.
- `APP_ENV=production` **refuses to start** with the development JWT secret, with a secret shorter than 32 characters, or with wildcard CORS (`core/config.py::_validate`, tested by `test_production_refuses_development_secrets`).
- Credentials go into the connection URL through `URL.create`, so special characters are escaped.
- `/health` hides connection details in production.
- Cloud SQL is reached through the Cloud SQL unix socket. The database has no public IP allow-list to manage.

## 4. Privacy by design
- **Minimum data to the model.** Gemini receives the report text and the location the app supplies. It never receives account details (name, phone, emergency medical notes).
- **Free tier for demos only.** The free Gemini API tier may use prompts to improve Google products, so it's used with synthetic demo data only. Real resident data goes through Vertex AI or the paid tier (see [AI_DESIGN.md](AI_DESIGN.md#7-privacy)).
- **Data minimisation in responses.** Identities and coordinates are masked for non-owners, and responders' live location is never shown to residents.
- **Android:** cleartext HTTP is allowed in **debug builds only**, and backups are disabled because the app stores a session token.

## 5. Platform hardening
- Security headers on every API response: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` and `Cache-Control: no-store` (`test_security_headers_present`). Firebase Hosting adds the same headers to the web app (`firebase.json`).
- CORS: an explicit allow-list of origins and methods (the Firebase Hosting domains in production).
- Passwords: bcrypt with cost 12, limited to bcrypt's 72-byte maximum instead of being silently truncated.
- The API container runs as a non-root user (`uid 10001`). Cloud Run gives HTTPS by default.

## 6. Automated scans (reproducible)

| Scan | Command | Result |
|---|---|---|
| Python static analysis (Bandit) | `bandit -r src/backend/app` | **0 issues** over 3,073 lines. Annotated false positives: a token-type label, a dev secret that production refuses, and constant table names in SQL |
| Python dependencies (pip-audit) | `pip-audit -r src/backend/requirements.txt` | **No known vulnerabilities** |
| Web dependencies (npm audit) | `npm --prefix src/web-app audit --omit=dev` | **0 vulnerabilities** |
| Lint (ruff) | `ruff check src/backend tests` (rules F, E9, B; `ruff.toml`) | **clean** |

Last full run: **16 Nov 2026**.

## 7. Reporting a vulnerability
Please open a private security advisory on the repository. Don't include real resident data in reports.
