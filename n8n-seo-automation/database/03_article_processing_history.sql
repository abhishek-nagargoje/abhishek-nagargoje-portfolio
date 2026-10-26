-- =============================================================================
-- 03_article_processing_history.sql
-- Keyword queue state, articles, per-attempt history, processing events.
--
-- PostgreSQL is the source of truth for processing state. The Google Sheets
-- Status column is a human-facing mirror plus a control input (READY / reset).
--
-- Concurrency model
--   * seo.claim_keyword() atomically claims a keyword with SELECT ... FOR UPDATE
--     and a lease (claimed_by_execution + lease_expires_at). Two executions can
--     never both receive CLAIMED for the same keyword.
--   * Every state-changing function below takes p_execution_id and calls
--     seo.assert_claim(). A stale execution whose lease was taken over gets an
--     exception (CLAIM_LOST) instead of silently overwriting newer work.
-- =============================================================================

CREATE TABLE IF NOT EXISTS seo.keyword_records (
  keyword_id            text PRIMARY KEY,
  brand_id              text NOT NULL,
  target_page_url       text NOT NULL,
  normalized_url        text NOT NULL,
  primary_keyword       text NOT NULL,
  normalized_keyword    text NOT NULL,
  combination_key       text GENERATED ALWAYS AS (brand_id || '|' || normalized_keyword || '|' || normalized_url) STORED,
  status                text NOT NULL DEFAULT 'READY' CHECK (status IN (
                          'READY', 'PROCESSING', 'PROMPT_CREATED', 'ARTICLE_GENERATED', 'QUALITY_REVIEW',
                          'PLAGIARISM_CHECK', 'REVISION_REQUIRED', 'APPROVED', 'REVIEW_REQUIRED',
                          'ERROR', 'SKIPPED_DUPLICATE')),
  current_article_id    text,
  claimed_by_execution  text,
  claimed_at            timestamptz,
  lease_expires_at      timestamptz,
  technical_failures    int NOT NULL DEFAULT 0,
  total_claims          int NOT NULL DEFAULT 0,
  regeneration_count    int NOT NULL DEFAULT 0,
  last_error_class      text,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE INDEX IF NOT EXISTS keyword_records_combination ON seo.keyword_records (combination_key);
CREATE INDEX IF NOT EXISTS keyword_records_status ON seo.keyword_records (status);

CREATE TABLE IF NOT EXISTS seo.articles (
  article_id              text PRIMARY KEY,
  keyword_id              text NOT NULL REFERENCES seo.keyword_records (keyword_id),
  brand_id                text NOT NULL,
  status                  text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN (
                            'IN_PROGRESS', 'APPROVED', 'REVIEW_REQUIRED', 'ERROR', 'SUPERSEDED')),
  attempt_count           int NOT NULL DEFAULT 0,
  max_attempts            int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  article_title           text,
  seo_title               text,
  meta_description        text,
  url_slug                text,
  latest_payload          jsonb,
  latest_markdown         text,
  quality_status          text,
  eeta_report             jsonb,
  plagiarism_percent      numeric(6, 2),
  plagiarism_status       text,
  plagiarism_report_ref   text,
  plagiarism_report       jsonb,
  failed_conditions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_reason           text,
  google_doc_id           text,
  google_doc_url          text,
  sheet_synced            boolean NOT NULL DEFAULT false,
  sheet_sync_error        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  approved_at             timestamptz
);

CREATE INDEX IF NOT EXISTS articles_keyword ON seo.articles (keyword_id);
CREATE INDEX IF NOT EXISTS articles_status ON seo.articles (status);
-- At most one approved article per keyword record at a time. Regeneration
-- marks the previous approved article SUPERSEDED first.
CREATE UNIQUE INDEX IF NOT EXISTS articles_one_approved_per_keyword
  ON seo.articles (keyword_id) WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS seo.article_attempts (
  article_id             text NOT NULL REFERENCES seo.articles (article_id),
  attempt_no             int  NOT NULL CHECK (attempt_no >= 1),
  execution_id           text,
  origin                 text NOT NULL CHECK (origin IN ('INITIAL', 'REVISION')),
  article_payload        jsonb NOT NULL,
  article_markdown       text NOT NULL,
  content_sha256         char(64) NOT NULL,
  structure_errors       jsonb NOT NULL DEFAULT '[]'::jsonb,
  deterministic_checks   jsonb,
  source_checks          jsonb,
  editorial_status       text,
  editorial_report       jsonb,
  plagiarism_status      text,
  plagiarism_percent     numeric(6, 2),
  plagiarism_report      jsonb,
  plagiarism_content_sha256 char(64),   -- hash of the text that was actually scanned
  failed_conditions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_corrections   jsonb,
  outcome                text,          -- PASSED / FAILED_EDITORIAL / FAILED_PLAGIARISM / FAILED_STRUCTURE / TECHNICAL_ERROR
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS seo.processing_events (
  event_id      bigserial PRIMARY KEY,
  execution_id  text,
  workflow      text,
  keyword_id    text,
  article_id    text,
  stage         text NOT NULL,
  status        text NOT NULL,
  error_class   text,             -- CONTENT_QUALITY / PLAGIARISM / API_TRANSIENT / CONFIGURATION / HUMAN_REVIEW / INPUT
  message       text,             -- safe explanation only, never secrets
  details       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processing_events_keyword ON seo.processing_events (keyword_id, created_at DESC);
CREATE INDEX IF NOT EXISTS processing_events_article ON seo.processing_events (article_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.new_article_id() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'ART-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-' ||
         upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
$$;

CREATE OR REPLACE FUNCTION seo.log_event(
  p_execution_id text, p_workflow text, p_keyword_id text, p_article_id text,
  p_stage text, p_status text, p_error_class text, p_message text, p_details jsonb
) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO seo.processing_events (execution_id, workflow, keyword_id, article_id, stage, status, error_class, message, details)
  VALUES (p_execution_id, p_workflow, NULLIF(p_keyword_id, ''), NULLIF(p_article_id, ''), p_stage, p_status,
          NULLIF(p_error_class, ''), left(p_message, 4000), p_details)
  RETURNING event_id;
$$;

-- Raises CLAIM_LOST unless p_execution_id still owns the keyword's claim.
-- Also renews the lease, so long-running executions are not reclaimed.
CREATE OR REPLACE FUNCTION seo.assert_claim(p_keyword_id text, p_execution_id text, p_lease_minutes int DEFAULT 180)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_owner text;
BEGIN
  SELECT claimed_by_execution INTO v_owner FROM seo.keyword_records WHERE keyword_id = p_keyword_id FOR UPDATE;
  IF v_owner IS DISTINCT FROM p_execution_id THEN
    RAISE EXCEPTION 'CLAIM_LOST: keyword % is claimed by execution %, not %', p_keyword_id, v_owner, p_execution_id;
  END IF;
  UPDATE seo.keyword_records
     SET lease_expires_at = now() + make_interval(mins => p_lease_minutes), updated_at = now()
   WHERE keyword_id = p_keyword_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- seo.claim_keyword
-- Outcomes:
--   CLAIMED            proceed with generation (article_id returned)
--   RECOVER            a previous run already wrote this article to Google Docs
--                      (ledger VERIFIED) but did not finish bookkeeping; finish
--                      it without regenerating or re-appending
--   ALREADY_COMPLETED  keyword already APPROVED and regeneration not authorised
--   SKIPPED_DUPLICATE  another Keyword_ID with the same brand+keyword+URL
--                      combination is approved or being processed
--   IN_PROGRESS        another execution holds a live lease
--   KEYWORD_ID_CONFLICT the Keyword_ID was approved for a different keyword/URL
-- Deduplication policy: the identity of a request is the combination
--   (brand, normalised primary keyword, normalised target URL).
--   The same keyword with a DIFFERENT target URL is processed separately
--   (a cannibalisation warning is returned in reason).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.claim_keyword(
  p_keyword_id          text,
  p_brand_id            text,
  p_target_page_url     text,
  p_normalized_url      text,
  p_primary_keyword     text,
  p_normalized_keyword  text,
  p_execution_id        text,
  p_lease_minutes       int,
  p_regenerate          boolean,
  p_max_attempts        int
) RETURNS TABLE (outcome text, article_id text, reason text, attempt_count int, keyword_status text)
LANGUAGE plpgsql AS $$
DECLARE
  r            seo.keyword_records%ROWTYPE;
  v_combo      text := p_brand_id || '|' || p_normalized_keyword || '|' || p_normalized_url;
  v_dup        seo.keyword_records%ROWTYPE;
  v_article    seo.articles%ROWTYPE;
  v_ledger     text;
  v_article_id text;
  v_warning    text := NULL;
BEGIN
  INSERT INTO seo.keyword_records (keyword_id, brand_id, target_page_url, normalized_url, primary_keyword, normalized_keyword)
  VALUES (p_keyword_id, p_brand_id, p_target_page_url, p_normalized_url, p_primary_keyword, p_normalized_keyword)
  ON CONFLICT (keyword_id) DO NOTHING;

  SELECT * INTO r FROM seo.keyword_records k WHERE k.keyword_id = p_keyword_id FOR UPDATE;

  -- Live lease held by someone else (or by us in an earlier, still-running call).
  IF r.claimed_by_execution IS NOT NULL AND r.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'IN_PROGRESS'::text, r.current_article_id,
      'Claimed by execution ' || r.claimed_by_execution || ' until ' || r.lease_expires_at::text, 0, r.status;
    RETURN;
  END IF;

  -- Keyword_ID reused for a different keyword/URL after approval: refuse.
  IF r.combination_key <> v_combo THEN
    IF r.status = 'APPROVED' THEN
      RETURN QUERY SELECT 'KEYWORD_ID_CONFLICT'::text, r.current_article_id,
        'Keyword_ID was already approved for a different keyword/URL. Use a new Keyword_ID.'::text, 0, r.status;
      RETURN;
    END IF;
    UPDATE seo.keyword_records k
       SET target_page_url = p_target_page_url, normalized_url = p_normalized_url,
           primary_keyword = p_primary_keyword, normalized_keyword = p_normalized_keyword, updated_at = now()
     WHERE k.keyword_id = p_keyword_id;
    SELECT * INTO r FROM seo.keyword_records k WHERE k.keyword_id = p_keyword_id;
  END IF;

  -- Partial success from an earlier run: document already written & verified.
  IF r.current_article_id IS NOT NULL THEN
    SELECT * INTO v_article FROM seo.articles a WHERE a.article_id = r.current_article_id;
    SELECT l.state INTO v_ledger FROM seo.doc_write_ledger l WHERE l.article_id = r.current_article_id;
    IF v_ledger = 'VERIFIED' AND v_article.status <> 'APPROVED' THEN
      UPDATE seo.keyword_records k
         SET claimed_by_execution = p_execution_id, claimed_at = now(),
             lease_expires_at = now() + make_interval(mins => p_lease_minutes), updated_at = now()
       WHERE k.keyword_id = p_keyword_id;
      RETURN QUERY SELECT 'RECOVER'::text, r.current_article_id,
        'Article already written to Google Docs; finishing bookkeeping only'::text, v_article.attempt_count, r.status;
      RETURN;
    END IF;
    IF v_ledger IN ('PENDING', 'UNCERTAIN') THEN
      RETURN QUERY SELECT 'IN_PROGRESS'::text, r.current_article_id,
        'Google Docs write outcome is uncertain; waiting for the Error Recovery workflow to reconcile'::text, 0, r.status;
      RETURN;
    END IF;
  END IF;

  IF r.status = 'APPROVED' AND NOT COALESCE(p_regenerate, false) THEN
    RETURN QUERY SELECT 'ALREADY_COMPLETED'::text, r.current_article_id,
      'Keyword already has an approved article; set Regenerate=TRUE to authorise a new one'::text, 0, r.status;
    RETURN;
  END IF;

  -- Duplicate combination under another Keyword_ID.
  SELECT * INTO v_dup FROM seo.keyword_records k
   WHERE k.combination_key = v_combo AND k.keyword_id <> p_keyword_id
     AND (k.status = 'APPROVED' OR (k.claimed_by_execution IS NOT NULL AND k.lease_expires_at > now()))
   LIMIT 1;
  IF FOUND AND NOT COALESCE(p_regenerate, false) THEN
    UPDATE seo.keyword_records k SET status = 'SKIPPED_DUPLICATE', updated_at = now(),
           last_error_class = 'INPUT', last_error = 'Duplicate of ' || v_dup.keyword_id
     WHERE k.keyword_id = p_keyword_id;
    RETURN QUERY SELECT 'SKIPPED_DUPLICATE'::text, NULL::text,
      ('Same brand+keyword+URL already handled by Keyword_ID ' || v_dup.keyword_id)::text, 0, 'SKIPPED_DUPLICATE'::text;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM seo.keyword_records k
              WHERE k.brand_id = p_brand_id AND k.normalized_keyword = p_normalized_keyword
                AND k.normalized_url <> p_normalized_url AND k.keyword_id <> p_keyword_id) THEN
    v_warning := 'WARNING: the same primary keyword is assigned to another target URL (possible cannibalisation)';
  END IF;

  -- Reuse an unfinished article (keeps attempt history and ledger linkage),
  -- otherwise start a new one.
  v_article_id := NULL;
  IF r.current_article_id IS NOT NULL AND v_article.status IN ('IN_PROGRESS', 'ERROR') THEN
    v_article_id := r.current_article_id;
    UPDATE seo.articles a SET status = 'IN_PROGRESS', updated_at = now() WHERE a.article_id = v_article_id;
  ELSE
    IF r.status = 'APPROVED' AND COALESCE(p_regenerate, false) THEN
      UPDATE seo.articles a SET status = 'SUPERSEDED', updated_at = now()
       WHERE a.keyword_id = p_keyword_id AND a.status = 'APPROVED';
      UPDATE seo.keyword_records k SET regeneration_count = regeneration_count + 1 WHERE k.keyword_id = p_keyword_id;
    END IF;
    v_article_id := seo.new_article_id();
    INSERT INTO seo.articles (article_id, keyword_id, brand_id, max_attempts)
    VALUES (v_article_id, p_keyword_id, p_brand_id, p_max_attempts);
  END IF;

  UPDATE seo.keyword_records k
     SET status = 'PROCESSING', current_article_id = v_article_id,
         claimed_by_execution = p_execution_id, claimed_at = now(),
         lease_expires_at = now() + make_interval(mins => p_lease_minutes),
         total_claims = total_claims + 1,
         -- a human re-queued the row (REVIEW_REQUIRED / configuration ERROR -> READY): start a fresh retry budget
         technical_failures = CASE
           WHEN r.status = 'REVIEW_REQUIRED' OR (r.status = 'ERROR' AND r.last_error_class IS DISTINCT FROM 'API_TRANSIENT')
           THEN 0 ELSE k.technical_failures END,
         updated_at = now()
   WHERE k.keyword_id = p_keyword_id;

  PERFORM seo.log_event(p_execution_id, 'SEO_Article_Automation', p_keyword_id, v_article_id,
                        'CLAIM', 'CLAIMED', NULL, v_warning, NULL);

  RETURN QUERY SELECT 'CLAIMED'::text, v_article_id, COALESCE(v_warning, 'Claimed'),
    (SELECT a.attempt_count FROM seo.articles a WHERE a.article_id = v_article_id), 'PROCESSING'::text;
END;
$$;

-- Mirror of the pipeline stage (PROMPT_CREATED, ARTICLE_GENERATED, ...).
CREATE OR REPLACE FUNCTION seo.set_stage(p_keyword_id text, p_execution_id text, p_status text)
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seo.assert_claim(p_keyword_id, p_execution_id);
  UPDATE seo.keyword_records SET status = p_status, updated_at = now() WHERE keyword_id = p_keyword_id;
  RETURN p_status;
END;
$$;

-- -----------------------------------------------------------------------------
-- Attempt history. Each attempt stores the exact article version, and the
-- sha256 of its markdown. Editorial and plagiarism results are written against
-- (article_id, attempt_no) and the plagiarism result must carry the same hash,
-- so an old report can never be attached to a modified article.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.record_attempt(
  p_article_id text, p_keyword_id text, p_execution_id text, p_attempt_no int, p_origin text,
  p_payload jsonb, p_markdown text, p_structure_errors jsonb, p_revision_corrections jsonb
) RETURNS TABLE (attempt_no int, content_sha256 text)
LANGUAGE plpgsql AS $$
DECLARE
  v_hash text := encode(sha256(convert_to(COALESCE(p_markdown, ''), 'UTF8')), 'hex');
BEGIN
  PERFORM seo.assert_claim(p_keyword_id, p_execution_id);
  INSERT INTO seo.article_attempts AS t (article_id, attempt_no, execution_id, origin, article_payload, article_markdown,
                                         content_sha256, structure_errors, revision_corrections)
  VALUES (p_article_id, p_attempt_no, p_execution_id, p_origin, p_payload, COALESCE(p_markdown, ''), v_hash,
          COALESCE(p_structure_errors, '[]'::jsonb), p_revision_corrections)
  ON CONFLICT ON CONSTRAINT article_attempts_pkey DO UPDATE
    SET execution_id = EXCLUDED.execution_id, origin = EXCLUDED.origin, article_payload = EXCLUDED.article_payload,
        article_markdown = EXCLUDED.article_markdown, content_sha256 = EXCLUDED.content_sha256,
        structure_errors = EXCLUDED.structure_errors, revision_corrections = EXCLUDED.revision_corrections,
        -- a re-recorded attempt invalidates any earlier evaluation of it
        editorial_status = NULL, editorial_report = NULL, deterministic_checks = NULL, source_checks = NULL,
        plagiarism_status = NULL, plagiarism_percent = NULL, plagiarism_report = NULL,
        plagiarism_content_sha256 = NULL, outcome = NULL, updated_at = now();

  UPDATE seo.articles a
     SET attempt_count = GREATEST(a.attempt_count, p_attempt_no),
         latest_payload = p_payload, latest_markdown = p_markdown,
         article_title = p_payload ->> 'Article_Title', seo_title = p_payload ->> 'SEO_Title',
         meta_description = p_payload ->> 'Meta_Description', url_slug = p_payload ->> 'URL_Slug',
         updated_at = now()
   WHERE a.article_id = p_article_id;

  RETURN QUERY SELECT p_attempt_no, v_hash;
END;
$$;

CREATE OR REPLACE FUNCTION seo.record_editorial_result(
  p_article_id text, p_keyword_id text, p_execution_id text, p_attempt_no int,
  p_editorial_status text, p_editorial_report jsonb, p_deterministic_checks jsonb, p_source_checks jsonb,
  p_failed_conditions jsonb
) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seo.assert_claim(p_keyword_id, p_execution_id);
  UPDATE seo.article_attempts
     SET editorial_status = p_editorial_status, editorial_report = p_editorial_report,
         deterministic_checks = p_deterministic_checks, source_checks = p_source_checks,
         failed_conditions = COALESCE(p_failed_conditions, '[]'::jsonb),
         outcome = CASE WHEN p_editorial_status = 'PASS' THEN outcome ELSE 'FAILED_EDITORIAL' END,
         updated_at = now()
   WHERE article_id = p_article_id AND attempt_no = p_attempt_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND: % attempt %', p_article_id, p_attempt_no;
  END IF;
  UPDATE seo.articles SET quality_status = p_editorial_status, eeta_report = p_editorial_report,
         failed_conditions = COALESCE(p_failed_conditions, '[]'::jsonb), updated_at = now()
   WHERE article_id = p_article_id;
  RETURN p_editorial_status;
END;
$$;

CREATE OR REPLACE FUNCTION seo.record_plagiarism_result(
  p_article_id text, p_keyword_id text, p_execution_id text, p_attempt_no int,
  p_scanned_sha256 text, p_status text, p_percent numeric, p_report jsonb, p_report_ref text,
  p_failed_conditions jsonb
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_hash text;
BEGIN
  PERFORM seo.assert_claim(p_keyword_id, p_execution_id);
  SELECT content_sha256 INTO v_hash FROM seo.article_attempts
   WHERE article_id = p_article_id AND attempt_no = p_attempt_no;
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND: % attempt %', p_article_id, p_attempt_no;
  END IF;
  IF v_hash <> p_scanned_sha256 THEN
    RAISE EXCEPTION 'PLAGIARISM_REPORT_STALE: report was produced for a different article version';
  END IF;
  UPDATE seo.article_attempts
     SET plagiarism_status = p_status, plagiarism_percent = p_percent, plagiarism_report = p_report,
         plagiarism_content_sha256 = p_scanned_sha256,
         failed_conditions = CASE WHEN p_status = 'PASS' THEN failed_conditions
                                  ELSE failed_conditions || COALESCE(p_failed_conditions, '[]'::jsonb) END,
         outcome = CASE WHEN p_status = 'PASS' THEN 'PASSED'
                        WHEN p_status = 'FAIL' THEN 'FAILED_PLAGIARISM'
                        ELSE 'TECHNICAL_ERROR' END,
         updated_at = now()
   WHERE article_id = p_article_id AND attempt_no = p_attempt_no;
  UPDATE seo.articles
     SET plagiarism_status = p_status, plagiarism_percent = p_percent, plagiarism_report = p_report,
         plagiarism_report_ref = p_report_ref, updated_at = now()
   WHERE article_id = p_article_id;
  RETURN p_status;
END;
$$;

-- Content could not pass within MAX_ARTICLE_ATTEMPTS (or needs a human):
-- keep everything, release the claim, never append to the master doc.
CREATE OR REPLACE FUNCTION seo.mark_review_required(
  p_article_id text, p_keyword_id text, p_execution_id text, p_reason text, p_failed_conditions jsonb
) RETURNS TABLE (keyword_status text, article_id text, attempt_count int)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seo.assert_claim(p_keyword_id, p_execution_id);
  UPDATE seo.articles a
     SET status = 'REVIEW_REQUIRED', review_reason = left(p_reason, 4000),
         failed_conditions = COALESCE(p_failed_conditions, a.failed_conditions), updated_at = now()
   WHERE a.article_id = p_article_id;
  UPDATE seo.keyword_records k
     SET status = 'REVIEW_REQUIRED', claimed_by_execution = NULL, lease_expires_at = NULL,
         last_error_class = 'HUMAN_REVIEW', last_error = left(p_reason, 4000), updated_at = now()
   WHERE k.keyword_id = p_keyword_id;
  PERFORM seo.log_event(p_execution_id, 'SEO_Article_Automation', p_keyword_id, p_article_id,
                        'FINAL', 'REVIEW_REQUIRED', 'HUMAN_REVIEW', p_reason, p_failed_conditions);
  RETURN QUERY SELECT 'REVIEW_REQUIRED'::text, p_article_id,
               (SELECT a.attempt_count FROM seo.articles a WHERE a.article_id = p_article_id);
END;
$$;

-- Technical / configuration failure. Decides what the sheet should show:
--   READY            transient failure, will be retried automatically next run
--   ERROR            configuration/auth/permanent failure - fix, then set READY
--   REVIEW_REQUIRED  too many technical failures for this keyword
-- Does NOT require the claim when called by the error-recovery workflow
-- (p_execution_id = 'RECOVERY'), because the original execution is gone.
CREATE OR REPLACE FUNCTION seo.mark_keyword_error(
  p_keyword_id text, p_article_id text, p_execution_id text, p_stage text,
  p_error_class text, p_message text, p_retryable boolean, p_max_technical_failures int
) RETURNS TABLE (sheet_status text, technical_failures int)
LANGUAGE plpgsql AS $$
DECLARE
  v_failures int;
  v_status   text;
  v_owner    text;
BEGIN
  SELECT claimed_by_execution INTO v_owner FROM seo.keyword_records WHERE keyword_id = p_keyword_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'ERROR'::text, 0;
    RETURN;
  END IF;
  IF p_execution_id <> 'RECOVERY' AND v_owner IS NOT NULL AND v_owner <> p_execution_id THEN
    RAISE EXCEPTION 'CLAIM_LOST: keyword % is claimed by execution %', p_keyword_id, v_owner;
  END IF;

  UPDATE seo.keyword_records k
     SET technical_failures = k.technical_failures + 1, updated_at = now()
   WHERE k.keyword_id = p_keyword_id
  RETURNING k.technical_failures INTO v_failures;

  v_status := CASE
    WHEN NOT p_retryable THEN 'ERROR'
    WHEN v_failures >= p_max_technical_failures THEN 'REVIEW_REQUIRED'
    ELSE 'READY' END;

  UPDATE seo.keyword_records k
     SET status = CASE WHEN v_status = 'READY' THEN 'ERROR' ELSE v_status END, -- DB keeps ERROR; sheet shows READY for auto-retry
         claimed_by_execution = NULL, lease_expires_at = NULL,
         last_error_class = p_error_class, last_error = left(p_message, 4000), updated_at = now()
   WHERE k.keyword_id = p_keyword_id;

  IF NULLIF(p_article_id, '') IS NOT NULL THEN
    UPDATE seo.articles a
       SET status = CASE WHEN v_status = 'REVIEW_REQUIRED' THEN 'REVIEW_REQUIRED' ELSE 'ERROR' END,
           review_reason = CASE WHEN v_status = 'REVIEW_REQUIRED' THEN left(p_message, 4000) ELSE a.review_reason END,
           updated_at = now()
     WHERE a.article_id = p_article_id AND a.status = 'IN_PROGRESS';
  END IF;

  PERFORM seo.log_event(p_execution_id, 'SEO_Article_Automation', p_keyword_id, p_article_id,
                        p_stage, 'ERROR', p_error_class, p_message,
                        jsonb_build_object('retryable', p_retryable, 'sheet_status', v_status, 'technical_failures', v_failures));
  RETURN QUERY SELECT v_status, v_failures;
END;
$$;

INSERT INTO seo.schema_migrations (version, description)
VALUES ('03', 'keyword records, articles, attempts, processing events, claim functions')
ON CONFLICT (version) DO NOTHING;
