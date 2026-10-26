-- =============================================================================
-- 01_pgvector_setup.sql
-- SEO Content Automation System - database bootstrap
--
-- Run ONCE per database, as a role that is allowed to CREATE EXTENSION
-- (normally the database owner or a superuser):
--
--   psql -v ON_ERROR_STOP=1 -h <host> -U <admin_user> -d <database> -f 01_pgvector_setup.sql
--
-- Then run 02, 03 and 04 in order. Every script is idempotent: re-running it
-- does not drop data and does not duplicate objects.
--
-- Requirements:
--   * PostgreSQL 13+ (tested on PostgreSQL 16.15)
--   * pgvector 0.5.0+ (HNSW index support). Tested with pgvector 0.6.0.
--     Docker users: image "pgvector/pgvector:pg16" ships the extension.
--     Debian/Ubuntu: apt-get install postgresql-16-pgvector
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Fail loudly if pgvector is too old for HNSW indexes.
DO $$
DECLARE
  v_version text;
  v_parts   int[];
BEGIN
  SELECT extversion INTO v_version FROM pg_extension WHERE extname = 'vector';
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pgvector extension is not installed in this database';
  END IF;
  v_parts := string_to_array(split_part(v_version, '-', 1), '.')::int[];
  IF v_parts[1] = 0 AND v_parts[2] < 5 THEN
    RAISE EXCEPTION 'pgvector % found; version 0.5.0 or newer is required (HNSW). Run: ALTER EXTENSION vector UPDATE;', v_version;
  END IF;
  RAISE NOTICE 'pgvector version % OK', v_version;
END
$$;

-- All application objects live in a dedicated schema so they never collide
-- with n8n's own tables (if n8n uses the same PostgreSQL server).
CREATE SCHEMA IF NOT EXISTS seo;

CREATE TABLE IF NOT EXISTS seo.schema_migrations (
  version      text PRIMARY KEY,
  description  text NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO seo.schema_migrations (version, description)
VALUES ('01', 'pgvector extension and seo schema')
ON CONFLICT (version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Least-privilege application role used by the n8n PostgreSQL credential.
-- The role is created WITHOUT a password. Set one interactively afterwards:
--     \password n8n_seo_app
-- Never write the password into this file or into Git.
-- Privileges are granted at the end of 04_idempotency_and_recovery.sql,
-- after all tables and functions exist.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_seo_app') THEN
    CREATE ROLE n8n_seo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    RAISE NOTICE 'Created role n8n_seo_app (no password set yet - run \password n8n_seo_app)';
  END IF;
END
$$;
