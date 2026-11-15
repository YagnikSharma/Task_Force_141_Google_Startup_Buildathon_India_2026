-- Least-privilege application role for NSIN on PostgreSQL / Cloud SQL.
-- The API connects as a login that is a member of nsin_app: it can read and write data, but it
-- cannot create, alter or drop tables, and it can only INSERT and SELECT the audit trail.
-- Idempotent: safe to run more than once. Run it as the database owner after the first start.
--
--   psql "$DATABASE_URL" -f db/least_privilege.sql
--   CREATE ROLE nsin_api LOGIN PASSWORD '<strong password>' IN ROLE nsin_app;   -- once

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nsin_app') THEN
        CREATE ROLE nsin_app NOLOGIN;
    END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM nsin_app;
GRANT USAGE ON SCHEMA public TO nsin_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    users, trusted_contacts, responders, incidents, incident_status_history, location_events,
    child_journeys, elder_checkins, assistance_requests, community_hazards, ai_analysis_records,
    protocol_passages, incident_embeddings
TO nsin_app;

-- Audit trail is append-only for the application.
REVOKE ALL ON audit_events FROM nsin_app;
GRANT SELECT, INSERT ON audit_events TO nsin_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nsin_app;
