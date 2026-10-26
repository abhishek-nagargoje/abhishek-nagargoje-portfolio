-- =====================================================================
-- HR Remedy India - SEO Content Automation
-- 01_pgvector_setup.sql
--
-- Target: existing PostgreSQL 17 container "seo-postgres", database
-- "seo_content", role "seo_n8n", pgvector 0.8.x already installed.
--
-- This file is idempotent. Workflows 01 and 02 execute the same statements
-- automatically in their "Ensure Database Schema" node, so running it by
-- hand is optional. It contains no passwords or secrets.
--
-- IMPORTANT for whoever edits these files: the n8n Postgres node evaluates
-- double-curly-brace expressions inside SQL text and rewrites quoted
-- dollar-number literals, so neither may appear anywhere in these files.
-- All PL/pgSQL functions therefore use named parameters only.
-- =====================================================================

-- Serialise concurrent schema initialisation (two executions starting at
-- the same moment). The lock is released automatically when the implicit
-- transaction of this multi-statement batch ends.
SELECT pg_advisory_xact_lock(724100001);

-- The vector extension is already installed in seo_content. IF NOT EXISTS
-- makes this a no-op that does not require superuser rights. If it is
-- missing, a superuser must run: CREATE EXTENSION vector;
CREATE EXTENSION IF NOT EXISTS vector;

DO $do$
DECLARE
  v_version text;
BEGIN
  SELECT extversion INTO v_version FROM pg_extension WHERE extname = 'vector';
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'CONFIG_ERROR: pgvector extension "vector" is not installed in database %', current_database();
  END IF;
  -- HNSW indexes need pgvector 0.5.0 or newer.
  IF string_to_array(split_part(v_version, '-', 1), '.')::int[] < ARRAY[0,5,0] THEN
    RAISE EXCEPTION 'CONFIG_ERROR: pgvector % is too old; 0.5.0 or newer is required', v_version;
  END IF;
END
$do$;

-- Key/value settings shared by all three workflows (master Google Doc ID,
-- spreadsheet ID consistency check, runtime configuration for recovery).
CREATE TABLE IF NOT EXISTS seo_settings (
  setting_key   text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION seo_get_setting(p_key text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $fn$
  SELECT setting_value FROM seo_settings WHERE setting_key = p_key;
$fn$;

CREATE OR REPLACE FUNCTION seo_put_setting(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  INSERT INTO seo_settings (setting_key, setting_value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (setting_key) DO UPDATE
    SET setting_value = EXCLUDED.setting_value, updated_at = now()
  RETURNING setting_value;
$fn$;

-- Removes API keys / tokens that may appear inside error text before it is
-- persisted (for example a Google "key=" query parameter in a URL).
CREATE OR REPLACE FUNCTION seo_redact(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p_text, ''), '(\m(key|token|api_key|apikey)=)[^&\s"'']+', '\1[REDACTED]', 'gi'),
               '("?(token|apiKey|api_key|authorization)"?\s*[:=]\s*"?)[A-Za-z0-9._\-]{8,}', '\1[REDACTED]', 'gi'),
             '(Bearer\s+)[A-Za-z0-9._\-]+', '\1[REDACTED]', 'gi'),
           'AIza[0-9A-Za-z_\-]{20,}', '[REDACTED]', 'g');
$fn$;
