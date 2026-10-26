-- =====================================================================
-- HR Remedy India - SEO Content Automation
-- 03_article_processing_history.sql
--
-- Persistent processing state for workflow 02 and workflow 03. Duplicate
-- prevention, revision limits, plagiarism-report reuse protection and
-- Google Docs write idempotency are all enforced from these tables, never
-- from n8n execution memory.
-- =====================================================================

-- One row per article. Article_ID is derived deterministically from the
-- normalised target URL + primary keyword (see seo_article_id), so retries
-- and duplicate sheet rows for the same topic always map to the same row.
CREATE TABLE IF NOT EXISTS seo_article_jobs (
  article_id              text        PRIMARY KEY,
  normalized_key          text        NOT NULL UNIQUE,
  keyword_id              text        NOT NULL,
  target_page_url         text        NOT NULL,
  primary_keyword         text        NOT NULL,
  keyword_input           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sheet_row_number        integer,
  status                  text        NOT NULL DEFAULT 'READY',
  current_stage           text,
  run_no                  integer     NOT NULL DEFAULT 0,
  attempts                integer     NOT NULL DEFAULT 0,
  total_attempts          integer     NOT NULL DEFAULT 0,
  max_attempts            integer     NOT NULL DEFAULT 3,
  lease_owner             text,
  lease_expires_at        timestamptz,
  heartbeat_at            timestamptz,
  claimed_at              timestamptz,
  prompt_json             jsonb,
  latest_article          jsonb,
  editorial_report        jsonb,
  plagiarism_summary      jsonb,
  quality_status          text,
  checks_passed           boolean     NOT NULL DEFAULT false,
  approval_payload        jsonb,
  approval_candidate      jsonb,
  doc_marker              text        UNIQUE,
  google_doc_id           text,
  google_doc_url          text,
  doc_verified_at         timestamptz,
  keywords_sheet_synced_at timestamptz,
  article_log_synced_at   timestamptz,
  final_status            text,
  last_error              text,
  failure_stage           text,
  retryable               boolean,
  recovery_attempts       integer     NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  CONSTRAINT seo_article_jobs_status_chk CHECK (status IN (
    'READY','PROCESSING','PROMPT_CREATED','ARTICLE_GENERATED','QUALITY_REVIEW',
    'PLAGIARISM_CHECK','REVISION_REQUIRED','APPROVED','REVIEW_REQUIRED','ERROR','SKIPPED_DUPLICATE')),
  CONSTRAINT seo_article_jobs_attempts_chk CHECK (attempts >= 0 AND attempts <= max_attempts)
);

CREATE INDEX IF NOT EXISTS seo_article_jobs_keyword_idx ON seo_article_jobs (keyword_id);
CREATE INDEX IF NOT EXISTS seo_article_jobs_lease_idx ON seo_article_jobs (lease_owner, lease_expires_at);
CREATE INDEX IF NOT EXISTS seo_article_jobs_status_idx ON seo_article_jobs (status);

-- One row per full article-writing attempt (initial draft or revision).
-- check_text_sha256 is the hash of the exact text that must be sent to the
-- plagiarism checker for this attempt; the approval gate compares it with
-- the hash of the text that was actually checked.
CREATE TABLE IF NOT EXISTS seo_article_attempts (
  article_id          text        NOT NULL REFERENCES seo_article_jobs (article_id) ON DELETE CASCADE,
  run_no              integer     NOT NULL,
  attempt_no          integer     NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('INITIAL','REVISION')),
  article             jsonb       NOT NULL,
  check_text_sha256   char(64)    NOT NULL,
  word_count          integer,
  editorial_status    text,
  editorial_passed    boolean,
  editorial_report    jsonb,
  plagiarism_status   text,
  plagiarism_percent  numeric(6,2),
  plagiarism_passed   boolean,
  decision            text,
  decision_reasons    jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_article_attempts_pk PRIMARY KEY (article_id, run_no, attempt_no),
  CONSTRAINT seo_article_attempts_no_chk CHECK (attempt_no BETWEEN 1 AND 10)
);

-- One DupliChecker job per attempt. provider_hash/provider_key come from the
-- checkplag response and are needed to recover a timed-out report through
-- the documented query-footprint callback (hashes are valid ~7 hours).
CREATE TABLE IF NOT EXISTS seo_plagiarism_checks (
  check_id          bigserial   PRIMARY KEY,
  article_id        text        NOT NULL REFERENCES seo_article_jobs (article_id) ON DELETE CASCADE,
  run_no            integer     NOT NULL,
  attempt_no        integer     NOT NULL,
  content_sha256    char(64)    NOT NULL,
  word_count        integer,
  provider          text        NOT NULL DEFAULT 'duplichecker',
  provider_hash     text,
  provider_key      text,
  status            text        NOT NULL CHECK (status IN ('SUBMITTED','COMPLETED','FAILED','TIMEOUT')),
  poll_count        integer     NOT NULL DEFAULT 0,
  plag_percent      numeric(6,2),
  unique_percent    numeric(6,2),
  rephrased_percent numeric(6,2),
  exact_percent     numeric(6,2),
  threshold_percent numeric(6,2),
  passed            boolean,
  result            jsonb,
  error             text,
  recovery_attempts integer     NOT NULL DEFAULT 0,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_plagiarism_checks_attempt_uq UNIQUE (article_id, run_no, attempt_no)
);

CREATE INDEX IF NOT EXISTS seo_plagiarism_checks_status_idx ON seo_plagiarism_checks (status, submitted_at);

-- Google Docs write ledger. A PENDING row is written immediately BEFORE the
-- batchUpdate call; it becomes VERIFIED only after the unique marker has
-- been read back from the document. Recovery uses it to decide whether an
-- append may have happened and must be checked before appending again.
CREATE TABLE IF NOT EXISTS seo_document_ledger (
  article_id    text        PRIMARY KEY REFERENCES seo_article_jobs (article_id) ON DELETE CASCADE,
  doc_id        text        NOT NULL,
  marker        text        NOT NULL UNIQUE,
  status        text        NOT NULL CHECK (status IN ('PENDING','VERIFIED')),
  run_no        integer     NOT NULL,
  attempt_no    integer     NOT NULL,
  execution_id  text,
  write_count   integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  verified_at   timestamptz
);

-- Execution failures recorded by workflow 03 (Error Trigger + sweeps).
CREATE TABLE IF NOT EXISTS seo_execution_errors (
  error_id          bigserial   PRIMARY KEY,
  execution_id      text,
  workflow_id       text,
  workflow_name     text,
  execution_mode    text,
  keyword_id        text,
  article_id        text,
  failure_stage     text,
  error_message     text,
  retryable         boolean,
  recovery_status   text        NOT NULL DEFAULT 'RECORDED',
  recovery_action   text,
  details           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS seo_execution_errors_exec_idx ON seo_execution_errors (execution_id);

-- Stable Article_ID: "HRR-" + first 16 hex chars of SHA-256 of the
-- normalised key (lower-case URL without fragment/trailing slash, a pipe,
-- and the lower-case, whitespace-collapsed primary keyword).
CREATE OR REPLACE FUNCTION seo_normalized_key(p_url text, p_keyword text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT lower(regexp_replace(regexp_replace(btrim(coalesce(p_url, '')), '#.*$', ''), '/+$', ''))
         || '|' ||
         lower(regexp_replace(btrim(coalesce(p_keyword, '')), '\s+', ' ', 'g'));
$fn$;

CREATE OR REPLACE FUNCTION seo_article_id(p_url text, p_keyword text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT 'HRR-' || upper(substr(encode(sha256(convert_to(seo_normalized_key(p_url, p_keyword), 'UTF8')), 'hex'), 1, 16));
$fn$;

CREATE OR REPLACE FUNCTION seo_doc_marker(p_article_id text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT '[[HRR-ARTICLE:' || p_article_id || ']]';
$fn$;

CREATE OR REPLACE FUNCTION seo_text_sha256(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT encode(sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex');
$fn$;
