-- =============================================================================
-- 04_idempotency_and_recovery.sql
-- Google Docs write ledger, master-document lock, reconciliation helpers,
-- and least-privilege grants.
--
-- Google Docs, Google Sheets and PostgreSQL do not share a transaction. The
-- ledger turns the Docs append into a recoverable state machine:
--
--   (no row) --begin_doc_write--> PENDING --batchUpdate OK + marker found--> VERIFIED
--                                    |                                          |
--                                    +--batchUpdate error/timeout--> UNCERTAIN   |
--                                    |      (reconcile: read doc, search marker) |
--                                    +--definite failure / marker absent--> FAILED (may be retried)
--
-- Every appended article contains a unique marker line:
--     SEO-ARTICLE-MARKER: <article_id>
-- Reconciliation searches the master document for that marker, so an article
-- is never appended twice, even if n8n crashed between the Docs call and the
-- database update.
-- =============================================================================

CREATE TABLE IF NOT EXISTS seo.doc_write_ledger (
  article_id      text PRIMARY KEY REFERENCES seo.articles (article_id),
  keyword_id      text NOT NULL,
  doc_id          text NOT NULL,
  marker          text NOT NULL UNIQUE,
  state           text NOT NULL CHECK (state IN ('PENDING', 'UNCERTAIN', 'VERIFIED', 'FAILED')),
  write_attempts  int  NOT NULL DEFAULT 0,
  execution_id    text,
  expected_chars  int,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  verified_at     timestamptz
);

CREATE INDEX IF NOT EXISTS doc_write_ledger_state ON seo.doc_write_ledger (state, updated_at);

-- One writer per master document at a time: the append computes an insertion
-- index from the current end of the document, so concurrent appends must not
-- interleave. Lease-based so a crashed holder cannot block forever.
CREATE TABLE IF NOT EXISTS seo.doc_locks (
  doc_id       text PRIMARY KEY,
  holder       text,
  acquired_at  timestamptz,
  expires_at   timestamptz
);

CREATE OR REPLACE FUNCTION seo.acquire_doc_lock(p_doc_id text, p_holder text, p_ttl_seconds int)
RETURNS TABLE (acquired boolean, holder text, expires_at timestamptz)
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO seo.doc_locks (doc_id) VALUES (p_doc_id) ON CONFLICT (doc_id) DO NOTHING;
  RETURN QUERY
  WITH upd AS (
    UPDATE seo.doc_locks l
       SET holder = p_holder, acquired_at = now(), expires_at = now() + make_interval(secs => p_ttl_seconds)
     WHERE l.doc_id = p_doc_id AND (l.holder IS NULL OR l.holder = p_holder OR l.expires_at < now())
    RETURNING l.holder, l.expires_at
  )
  SELECT true, upd.holder, upd.expires_at FROM upd
  UNION ALL
  SELECT false, l.holder, l.expires_at FROM seo.doc_locks l
   WHERE l.doc_id = p_doc_id AND NOT EXISTS (SELECT 1 FROM upd);
END;
$$;

CREATE OR REPLACE FUNCTION seo.release_doc_lock(p_doc_id text, p_holder text)
RETURNS boolean
LANGUAGE sql AS $$
  WITH upd AS (
    UPDATE seo.doc_locks SET holder = NULL, acquired_at = NULL, expires_at = NULL
     WHERE doc_id = p_doc_id AND holder = p_holder
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM upd);
$$;

-- -----------------------------------------------------------------------------
-- seo.begin_doc_write  ("Check Article Idempotency")
--   PROCEED           no successful write recorded; ledger now PENDING
--   ALREADY_WRITTEN   ledger VERIFIED; do NOT append again, just finish bookkeeping
--   RECONCILE         previous write outcome unknown (PENDING/UNCERTAIN);
--                     read the document and search for the marker first
--   NOT_APPROVABLE    the article's latest attempt has not passed both checks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.begin_doc_write(
  p_article_id text, p_keyword_id text, p_execution_id text, p_doc_id text, p_marker text,
  p_expected_chars int
) RETURNS TABLE (decision text, ledger_state text, write_attempts int)
LANGUAGE plpgsql AS $$
DECLARE
  l seo.doc_write_ledger%ROWTYPE;
  v_outcome text;
BEGIN
  PERFORM seo.assert_claim(p_keyword_id, p_execution_id);

  -- Defence in depth: the database itself refuses to start a Docs write for an
  -- article whose latest attempt did not pass editorial AND plagiarism checks.
  SELECT t.outcome INTO v_outcome FROM seo.article_attempts t
   WHERE t.article_id = p_article_id ORDER BY t.attempt_no DESC LIMIT 1;
  IF v_outcome IS DISTINCT FROM 'PASSED' THEN
    RETURN QUERY SELECT 'NOT_APPROVABLE'::text, NULL::text, 0;
    RETURN;
  END IF;

  SELECT * INTO l FROM seo.doc_write_ledger d WHERE d.article_id = p_article_id FOR UPDATE;
  IF FOUND THEN
    IF l.state = 'VERIFIED' THEN
      RETURN QUERY SELECT 'ALREADY_WRITTEN'::text, l.state, l.write_attempts;
      RETURN;
    ELSIF l.state IN ('PENDING', 'UNCERTAIN') THEN
      RETURN QUERY SELECT 'RECONCILE'::text, l.state, l.write_attempts;
      RETURN;
    END IF;
    -- FAILED: a definite failure is safe to retry
    UPDATE seo.doc_write_ledger d
       SET state = 'PENDING', doc_id = p_doc_id, write_attempts = d.write_attempts + 1,
           execution_id = p_execution_id, expected_chars = p_expected_chars, last_error = NULL, updated_at = now()
     WHERE d.article_id = p_article_id;
    RETURN QUERY SELECT 'PROCEED'::text, 'PENDING'::text, l.write_attempts + 1;
    RETURN;
  END IF;

  INSERT INTO seo.doc_write_ledger (article_id, keyword_id, doc_id, marker, state, write_attempts, execution_id, expected_chars)
  VALUES (p_article_id, p_keyword_id, p_doc_id, p_marker, 'PENDING', 1, p_execution_id, p_expected_chars);
  RETURN QUERY SELECT 'PROCEED'::text, 'PENDING'::text, 1;
END;
$$;

-- Outcome of a write/verification. p_state: VERIFIED | UNCERTAIN | FAILED.
CREATE OR REPLACE FUNCTION seo.set_doc_write_state(p_article_id text, p_state text, p_error text)
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF p_state NOT IN ('VERIFIED', 'UNCERTAIN', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid ledger state %', p_state;
  END IF;
  UPDATE seo.doc_write_ledger
     SET state = p_state, last_error = left(p_error, 4000), updated_at = now(),
         verified_at = CASE WHEN p_state = 'VERIFIED' THEN now() ELSE verified_at END
   WHERE article_id = p_article_id
     -- never downgrade a verified write
     AND state <> 'VERIFIED';
  RETURN (SELECT state FROM seo.doc_write_ledger WHERE article_id = p_article_id);
END;
$$;

-- Compact, sheet-friendly summary of an editorial report (statuses only).
CREATE OR REPLACE FUNCTION seo.eeta_summary(p_report jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_report IS NULL THEN '' ELSE jsonb_build_object(
    'Overall', p_report ->> 'Overall_Status',
    'Checks', COALESCE((SELECT jsonb_object_agg(e.key, e.value ->> 'Status')
                          FROM jsonb_each(p_report) e
                         WHERE jsonb_typeof(e.value) = 'object' AND e.value ? 'Status'), '{}'::jsonb),
    'Unsupported_Claims', COALESCE(jsonb_array_length(p_report -> 'Unsupported_Claims'), 0)
  )::text END;
$$;

-- -----------------------------------------------------------------------------
-- seo.finalize_approved_article
-- Called only after the Docs write is VERIFIED. Single transaction: article
-- APPROVED, keyword APPROVED, claim released, document lock released.
-- Idempotent: calling it again returns the same row.
-- p_execution_id 'RECOVERY' is accepted from the Error Recovery workflow.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS seo.finalize_approved_article(text, text, text, text);
CREATE OR REPLACE FUNCTION seo.finalize_approved_article(
  p_article_id text, p_execution_id text, p_doc_id text, p_doc_url text
) RETURNS TABLE (
  article_id text, keyword_id text, target_page_url text, primary_keyword text, article_title text,
  seo_title text, meta_description text, url_slug text, quality_status text, eeta_summary text,
  plagiarism_percent numeric, plagiarism_status text, plagiarism_report_ref text, attempt_count int,
  google_doc_id text, google_doc_url text, approved_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql AS $$
DECLARE
  v_state   text;
  v_keyword text;
  v_owner   text;
BEGIN
  SELECT l.state, l.keyword_id INTO v_state, v_keyword FROM seo.doc_write_ledger l WHERE l.article_id = p_article_id;
  IF v_state IS DISTINCT FROM 'VERIFIED' THEN
    RAISE EXCEPTION 'DOC_WRITE_NOT_VERIFIED: article % ledger state is %', p_article_id, COALESCE(v_state, 'none');
  END IF;

  SELECT k.claimed_by_execution INTO v_owner FROM seo.keyword_records k WHERE k.keyword_id = v_keyword FOR UPDATE;
  IF p_execution_id <> 'RECOVERY' AND v_owner IS NOT NULL AND v_owner <> p_execution_id THEN
    RAISE EXCEPTION 'CLAIM_LOST: keyword % is claimed by execution %', v_keyword, v_owner;
  END IF;

  UPDATE seo.articles a
     SET status = 'APPROVED', google_doc_id = p_doc_id, google_doc_url = p_doc_url,
         approved_at = COALESCE(a.approved_at, now()), updated_at = now()
   WHERE a.article_id = p_article_id AND a.status <> 'APPROVED';

  UPDATE seo.keyword_records k
     SET status = 'APPROVED', current_article_id = p_article_id, claimed_by_execution = NULL,
         lease_expires_at = NULL, technical_failures = 0, last_error = NULL, last_error_class = NULL,
         completed_at = COALESCE(k.completed_at, now()), updated_at = now()
   WHERE k.keyword_id = v_keyword;

  -- release the lock if this execution, or the (possibly crashed) execution
  -- that performed the write, still holds it
  UPDATE seo.doc_locks dl SET holder = NULL, acquired_at = NULL, expires_at = NULL
   WHERE dl.doc_id = p_doc_id
     AND dl.holder IN (p_execution_id,
                       (SELECT l.execution_id FROM seo.doc_write_ledger l WHERE l.article_id = p_article_id));

  PERFORM seo.log_event(p_execution_id, 'SEO_Article_Automation', v_keyword, p_article_id,
                        'FINAL', 'APPROVED', NULL, 'Article appended to master Google Doc and verified', NULL);

  RETURN QUERY
  SELECT a.article_id, a.keyword_id, k.target_page_url, k.primary_keyword, a.article_title, a.seo_title,
         a.meta_description, a.url_slug, a.quality_status, seo.eeta_summary(a.eeta_report), a.plagiarism_percent,
         a.plagiarism_status, a.plagiarism_report_ref, a.attempt_count, a.google_doc_id, a.google_doc_url,
         a.approved_at, a.created_at
    FROM seo.articles a JOIN seo.keyword_records k ON k.keyword_id = a.keyword_id
   WHERE a.article_id = p_article_id;
END;
$$;

CREATE OR REPLACE FUNCTION seo.set_sheet_sync(p_article_id text, p_synced boolean, p_error text)
RETURNS boolean
LANGUAGE sql AS $$
  UPDATE seo.articles SET sheet_synced = p_synced, sheet_sync_error = left(p_error, 4000), updated_at = now()
   WHERE article_id = p_article_id
  RETURNING sheet_synced;
$$;

-- -----------------------------------------------------------------------------
-- Recovery queries used by workflows/03_Error_Recovery.json
-- -----------------------------------------------------------------------------

-- Ledger rows whose outcome is unknown and old enough that the writer is gone.
CREATE OR REPLACE FUNCTION seo.list_doc_writes_to_reconcile(p_min_age_minutes int)
RETURNS TABLE (article_id text, keyword_id text, doc_id text, marker text, state text, updated_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT l.article_id, l.keyword_id, l.doc_id, l.marker, l.state, l.updated_at
    FROM seo.doc_write_ledger l
   WHERE l.state IN ('PENDING', 'UNCERTAIN')
     AND l.updated_at < now() - make_interval(mins => p_min_age_minutes)
   ORDER BY l.updated_at
   LIMIT 50;
$$;

-- Approved (verified) articles whose Sheets bookkeeping did not complete.
-- Same columns as finalize_approved_article so the same sheet mapping works.
DROP FUNCTION IF EXISTS seo.list_unsynced_approved();
CREATE OR REPLACE FUNCTION seo.list_unsynced_approved()
RETURNS TABLE (
  article_id text, keyword_id text, target_page_url text, primary_keyword text, article_title text,
  seo_title text, meta_description text, url_slug text, quality_status text, eeta_summary text,
  plagiarism_percent numeric, plagiarism_status text, plagiarism_report_ref text, attempt_count int,
  google_doc_id text, google_doc_url text, approved_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT a.article_id, a.keyword_id, k.target_page_url, k.primary_keyword, a.article_title, a.seo_title,
         a.meta_description, a.url_slug, a.quality_status, seo.eeta_summary(a.eeta_report), a.plagiarism_percent,
         a.plagiarism_status, a.plagiarism_report_ref, a.attempt_count, a.google_doc_id, a.google_doc_url,
         a.approved_at, a.created_at
    FROM seo.articles a JOIN seo.keyword_records k ON k.keyword_id = a.keyword_id
   WHERE a.status = 'APPROVED' AND NOT a.sheet_synced
   ORDER BY a.approved_at
   LIMIT 50;
$$;

-- Keyword claims whose lease expired (n8n crashed / was restarted mid-run).
-- Rows with an unresolved Docs write are left alone for reconciliation.
-- Atomic per row (FOR UPDATE SKIP LOCKED): counts as a technical failure and
-- returns the status the Keywords sheet should show (READY = auto-retry).
DROP FUNCTION IF EXISTS seo.release_expired_claims();
CREATE OR REPLACE FUNCTION seo.release_expired_claims(p_max_technical_failures int DEFAULT 3)
RETURNS TABLE (keyword_id text, article_id text, previous_status text, previous_owner text, sheet_status text)
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_failures int;
  v_status text;
BEGIN
  FOR r IN
    SELECT k.keyword_id, k.current_article_id, k.status, k.claimed_by_execution
      FROM seo.keyword_records k
     WHERE k.claimed_by_execution IS NOT NULL
       AND k.lease_expires_at < now()
       AND NOT EXISTS (SELECT 1 FROM seo.doc_write_ledger l
                        WHERE l.article_id = k.current_article_id AND l.state IN ('PENDING', 'UNCERTAIN'))
     ORDER BY k.lease_expires_at
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE seo.keyword_records k
       SET technical_failures = k.technical_failures + 1
     WHERE k.keyword_id = r.keyword_id
    RETURNING k.technical_failures INTO v_failures;
    v_status := CASE WHEN v_failures >= p_max_technical_failures THEN 'REVIEW_REQUIRED' ELSE 'READY' END;
    UPDATE seo.keyword_records k
       SET status = CASE WHEN v_status = 'READY' THEN 'ERROR' ELSE 'REVIEW_REQUIRED' END,
           claimed_by_execution = NULL, lease_expires_at = NULL,
           last_error_class = 'API_TRANSIENT',
           last_error = 'Execution ' || r.claimed_by_execution || ' was interrupted (lease expired)', updated_at = now()
     WHERE k.keyword_id = r.keyword_id;
    UPDATE seo.articles a SET status = CASE WHEN v_status = 'READY' THEN 'ERROR' ELSE 'REVIEW_REQUIRED' END, updated_at = now()
     WHERE a.article_id = r.current_article_id AND a.status = 'IN_PROGRESS';
    PERFORM seo.log_event('RECOVERY', 'Error_Recovery', r.keyword_id, r.current_article_id, 'LEASE_EXPIRED', 'ERROR',
                          'API_TRANSIENT', 'Interrupted execution ' || r.claimed_by_execution, NULL);
    keyword_id := r.keyword_id; article_id := r.current_article_id; previous_status := r.status;
    previous_owner := r.claimed_by_execution; sheet_status := v_status;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Immediately releases the claims of an execution that failed (Error Trigger),
-- instead of waiting for the lease to expire. Same rules as above.
CREATE OR REPLACE FUNCTION seo.release_claims_of_execution(p_execution_id text, p_message text, p_max_technical_failures int DEFAULT 3)
RETURNS TABLE (keyword_id text, article_id text, sheet_status text)
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT k.keyword_id, k.current_article_id FROM seo.keyword_records k
     WHERE k.claimed_by_execution = p_execution_id
       AND NOT EXISTS (SELECT 1 FROM seo.doc_write_ledger l
                        WHERE l.article_id = k.current_article_id AND l.state IN ('PENDING', 'UNCERTAIN'))
     FOR UPDATE SKIP LOCKED
  LOOP
    RETURN QUERY
      SELECT r.keyword_id, r.current_article_id, f.sheet_status
        FROM seo.mark_keyword_error(r.keyword_id, r.current_article_id, 'RECOVERY', 'EXECUTION_FAILED',
                                    'API_TRANSIENT', p_message, true, p_max_technical_failures) f;
  END LOOP;
  UPDATE seo.doc_locks SET holder = NULL, acquired_at = NULL, expires_at = NULL WHERE holder = p_execution_id;
END;
$$;

-- Human review queue.
CREATE OR REPLACE VIEW seo.v_review_queue AS
SELECT a.article_id, a.keyword_id, k.primary_keyword, k.target_page_url, a.attempt_count, a.review_reason,
       a.quality_status, a.plagiarism_status, a.plagiarism_percent, a.failed_conditions, a.updated_at
  FROM seo.articles a JOIN seo.keyword_records k ON k.keyword_id = a.keyword_id
 WHERE a.status = 'REVIEW_REQUIRED'
 ORDER BY a.updated_at DESC;

INSERT INTO seo.schema_migrations (version, description)
VALUES ('04', 'docs write ledger, doc lock, recovery functions, grants')
ON CONFLICT (version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Least-privilege grants for the n8n application role (created in 01).
-- The role can read/write rows and call functions; it cannot create/drop
-- objects or touch other schemas.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_seo_app') THEN
    GRANT USAGE ON SCHEMA seo TO n8n_seo_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA seo TO n8n_seo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA seo TO n8n_seo_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA seo TO n8n_seo_app;
    REVOKE UPDATE, INSERT ON seo.schema_migrations, seo.embedding_config FROM n8n_seo_app;
  END IF;
END
$$;
