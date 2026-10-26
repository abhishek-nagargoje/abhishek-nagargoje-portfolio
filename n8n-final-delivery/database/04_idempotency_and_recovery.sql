-- =====================================================================
-- HR Remedy India - SEO Content Automation
-- 04_idempotency_and_recovery.sql
--
-- Claiming with leases, the per-stage state machine, the approval gate,
-- the Google Docs ledger protocol and recovery functions.
--
-- Lease model: a job is owned by exactly one n8n execution (lease_owner =
-- the n8n execution ID). Every recorded stage extends the lease. Another
-- execution may only take a job over after the lease has expired, and the
-- recovery sweep additionally waits a grace period, so a running job is
-- never reset.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Claim the next READY keyword (one per execution).
-- p_candidates: JSON array in priority order, each element:
--   {keyword_id, target_page_url, primary_keyword, row_number, input:{...}}
-- outcome:
--   GENERATE   - new run: write, check and (if passed) publish an article
--   RESUME_DOC - checks already passed earlier; only the Google Docs write
--                (with marker check) and sheet updates remain
--   RECONCILE  - article already verified in Google Docs; only the sheet
--                updates are missing
--   NONE       - nothing claimable (see skipped / message)
-- skipped: candidates not claimed, with sheet_action SKIPPED_DUPLICATE or
--          NONE (in progress elsewhere).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo_claim_next_job(
  p_candidates jsonb, p_owner text, p_lease_minutes integer, p_max_attempts integer)
RETURNS TABLE (outcome text, article_id text, keyword_id text, job jsonb, skipped jsonb, message text)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  c        jsonb;
  v_aid    text;
  v_key    text;
  v_kw     text;
  v_mode   text;
  v_ledger text;
  j        seo_article_jobs%ROWTYPE;
  v_skip   jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(p_owner, '') = '' THEN
    RAISE EXCEPTION 'CONFIG_ERROR: claim requires an execution id';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'CONFIG_ERROR: max attempts must be between 1 and 10';
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) LOOP
    v_kw  := btrim(c->>'keyword_id');
    v_key := seo_normalized_key(c->>'target_page_url', c->>'primary_keyword');
    v_aid := seo_article_id(c->>'target_page_url', c->>'primary_keyword');

    INSERT INTO seo_article_jobs AS t
      (article_id, normalized_key, keyword_id, target_page_url, primary_keyword,
       keyword_input, sheet_row_number, status, max_attempts, doc_marker)
    VALUES
      (v_aid, v_key, v_kw, btrim(c->>'target_page_url'), btrim(c->>'primary_keyword'),
       coalesce(c->'input', '{}'::jsonb), (c->>'row_number')::int, 'READY', p_max_attempts, seo_doc_marker(v_aid))
    ON CONFLICT (article_id) DO NOTHING;

    SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = v_aid FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      v_skip := v_skip || jsonb_build_object('keyword_id', v_kw, 'row_number', c->'row_number',
                 'article_id', v_aid, 'reason', 'LOCKED_BY_CONCURRENT_CLAIM', 'sheet_action', 'NONE');
      CONTINUE;
    END IF;

    IF j.lease_owner IS NOT NULL AND j.lease_owner <> p_owner AND j.lease_expires_at > now() THEN
      v_skip := v_skip || jsonb_build_object('keyword_id', v_kw, 'row_number', c->'row_number',
                 'article_id', v_aid, 'reason', 'IN_PROGRESS', 'lease_owner', j.lease_owner,
                 'lease_expires_at', j.lease_expires_at, 'sheet_action', 'NONE');
      CONTINUE;
    END IF;

    SELECT l.status INTO v_ledger FROM seo_document_ledger l WHERE l.article_id = v_aid;

    IF j.keyword_id <> v_kw AND j.status IN ('APPROVED','REVIEW_REQUIRED','SKIPPED_DUPLICATE') THEN
      -- A different sheet row targets the same URL + keyword combination.
      v_skip := v_skip || jsonb_build_object('keyword_id', v_kw, 'row_number', c->'row_number',
                 'article_id', v_aid, 'reason', 'DUPLICATE_OF_' || j.keyword_id,
                 'existing_keyword_id', j.keyword_id, 'existing_status', j.status,
                 'sheet_action', 'SKIPPED_DUPLICATE');
      CONTINUE;
    END IF;

    IF j.status = 'APPROVED' THEN
      IF j.keywords_sheet_synced_at IS NULL OR j.article_log_synced_at IS NULL THEN
        v_mode := 'RECONCILE';
      ELSE
        v_skip := v_skip || jsonb_build_object('keyword_id', v_kw, 'row_number', c->'row_number',
                   'article_id', v_aid, 'reason', 'ALREADY_APPROVED', 'existing_keyword_id', j.keyword_id,
                   'google_doc_url', j.google_doc_url, 'sheet_action', 'SKIPPED_DUPLICATE');
        CONTINUE;
      END IF;
    ELSIF v_ledger IS NOT NULL OR (j.checks_passed AND j.approval_payload IS NOT NULL) THEN
      v_mode := 'RESUME_DOC';
    ELSE
      v_mode := 'GENERATE';
    END IF;

    UPDATE seo_article_jobs t SET
      status            = CASE WHEN v_mode = 'RECONCILE' THEN t.status ELSE 'PROCESSING' END,
      current_stage     = 'CLAIMED_' || v_mode,
      lease_owner       = p_owner,
      lease_expires_at  = now() + make_interval(mins => greatest(coalesce(p_lease_minutes, 20), 1)),
      heartbeat_at      = now(),
      claimed_at        = now(),
      keyword_id        = v_kw,
      keyword_input     = coalesce(c->'input', t.keyword_input),
      sheet_row_number  = coalesce((c->>'row_number')::int, t.sheet_row_number),
      max_attempts      = CASE WHEN v_mode = 'GENERATE' THEN p_max_attempts ELSE t.max_attempts END,
      run_no            = CASE WHEN v_mode = 'GENERATE' THEN t.run_no + 1 ELSE t.run_no END,
      attempts          = CASE WHEN v_mode = 'GENERATE' THEN 0 ELSE t.attempts END,
      prompt_json       = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.prompt_json END,
      latest_article    = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.latest_article END,
      editorial_report  = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.editorial_report END,
      plagiarism_summary= CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.plagiarism_summary END,
      quality_status    = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.quality_status END,
      checks_passed     = CASE WHEN v_mode = 'GENERATE' THEN false ELSE t.checks_passed END,
      approval_payload  = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.approval_payload END,
      approval_candidate= CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.approval_candidate END,
      final_status      = CASE WHEN v_mode = 'RECONCILE' THEN t.final_status ELSE NULL END,
      last_error        = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.last_error END,
      failure_stage     = CASE WHEN v_mode = 'GENERATE' THEN NULL ELSE t.failure_stage END,
      retryable         = NULL,
      doc_marker        = seo_doc_marker(t.article_id),
      completed_at      = CASE WHEN v_mode = 'RECONCILE' THEN t.completed_at ELSE NULL END,
      updated_at        = now()
    WHERE t.article_id = v_aid
    RETURNING * INTO j;

    RETURN QUERY SELECT v_mode, j.article_id, j.keyword_id,
      to_jsonb(j) || jsonb_build_object('ledger_status', v_ledger),
      v_skip,
      format('Claimed %s (%s) for %s', j.keyword_id, j.article_id, v_mode);
    RETURN;
  END LOOP;

  RETURN QUERY SELECT 'NONE'::text, NULL::text, NULL::text, NULL::jsonb, v_skip,
    CASE WHEN jsonb_array_length(v_skip) = 0 THEN 'No READY keyword candidates were supplied'
         ELSE 'No claimable keyword: every candidate is in progress elsewhere or is a duplicate' END;
END
$fn$;

-- ---------------------------------------------------------------------
-- Per-stage state machine. Every call (except SHEETS_SYNCED) requires the
-- caller to still own the lease, and extends it. Returns lease_ok = false
-- (never silently succeeds) if another execution has taken over.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo_job_event(
  p_article_id text, p_owner text, p_event text, p_payload jsonb, p_lease_minutes integer)
RETURNS TABLE (lease_ok boolean, article_id text, status text, run_no integer, attempts integer, detail jsonb)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  j         seo_article_jobs%ROWTYPE;
  a         seo_article_attempts%ROWTYPE;
  pc        seo_plagiarism_checks%ROWTYPE;
  l         seo_document_ledger%ROWTYPE;
  v_attempt integer := nullif(p_payload->>'attempt_no', '')::int;
  v_detail  jsonb := '{}'::jsonb;
  v_sha     text;
  v_final   text;
  v_status  text;
  v_passed  boolean;
  v_reasons text[] := ARRAY[]::text[];
  v_lease   interval := make_interval(mins => greatest(coalesce(p_lease_minutes, 20), 1));
BEGIN
  SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STATE_ERROR: unknown article_id %', p_article_id;
  END IF;

  IF p_event <> 'SHEETS_SYNCED' AND j.lease_owner IS DISTINCT FROM p_owner THEN
    RETURN QUERY SELECT false, j.article_id, j.status, j.run_no, j.attempts,
      jsonb_build_object('reason', 'LEASE_LOST', 'lease_owner', j.lease_owner, 'event', p_event);
    RETURN;
  END IF;

  CASE p_event
  WHEN 'HEARTBEAT' THEN
    NULL;

  WHEN 'PROMPT_CREATED' THEN
    UPDATE seo_article_jobs t SET status = 'PROMPT_CREATED', current_stage = 'PROMPT_CREATED',
           prompt_json = p_payload->'prompt' WHERE t.article_id = p_article_id;

  WHEN 'ARTICLE_GENERATED' THEN
    IF v_attempt IS NULL OR v_attempt < 1 OR v_attempt > j.max_attempts THEN
      RAISE EXCEPTION 'ATTEMPT_LIMIT: attempt % is outside 1..% for %', v_attempt, j.max_attempts, p_article_id;
    END IF;
    IF v_attempt NOT IN (j.attempts, j.attempts + 1) THEN
      RAISE EXCEPTION 'STATE_ERROR: attempt % does not follow recorded attempt %', v_attempt, j.attempts;
    END IF;
    v_sha := seo_text_sha256(p_payload->>'check_text');
    INSERT INTO seo_article_attempts AS t
      (article_id, run_no, attempt_no, kind, article, check_text_sha256, word_count)
    VALUES
      (p_article_id, j.run_no, v_attempt, coalesce(p_payload->>'kind', 'INITIAL'), p_payload->'article',
       v_sha, nullif(p_payload->>'word_count', '')::int)
    ON CONFLICT (article_id, run_no, attempt_no) DO UPDATE SET
      kind = EXCLUDED.kind, article = EXCLUDED.article, check_text_sha256 = EXCLUDED.check_text_sha256,
      word_count = EXCLUDED.word_count, editorial_status = NULL, editorial_passed = NULL,
      editorial_report = NULL, plagiarism_status = NULL, plagiarism_percent = NULL,
      plagiarism_passed = NULL, decision = NULL, decision_reasons = NULL, updated_at = now();
    -- A plagiarism result can never be reused for different text.
    DELETE FROM seo_plagiarism_checks t
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = v_attempt
       AND t.content_sha256 <> v_sha;
    UPDATE seo_article_jobs t SET status = 'ARTICLE_GENERATED', current_stage = 'ARTICLE_GENERATED',
           attempts = v_attempt,
           total_attempts = t.total_attempts + CASE WHEN v_attempt > j.attempts THEN 1 ELSE 0 END,
           latest_article = p_payload->'article', editorial_report = NULL, plagiarism_summary = NULL,
           quality_status = NULL
     WHERE t.article_id = p_article_id;
    v_detail := jsonb_build_object('check_text_sha256', v_sha);

  WHEN 'EDITORIAL_DONE' THEN
    IF v_attempt IS DISTINCT FROM j.attempts THEN
      RAISE EXCEPTION 'STATE_ERROR: editorial report is for attempt % but current attempt is %', v_attempt, j.attempts;
    END IF;
    UPDATE seo_article_attempts t SET editorial_status = p_payload->>'overall_status',
           editorial_passed = coalesce((p_payload->>'passed')::boolean, false),
           editorial_report = p_payload->'report', updated_at = now()
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = v_attempt;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STATE_ERROR: no recorded article for attempt %', v_attempt;
    END IF;
    UPDATE seo_article_jobs t SET status = 'QUALITY_REVIEW', current_stage = 'EDITORIAL_DONE',
           editorial_report = p_payload->'report', quality_status = p_payload->>'overall_status'
     WHERE t.article_id = p_article_id;

  WHEN 'PLAG_SUBMITTED' THEN
    SELECT * INTO a FROM seo_article_attempts t
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts;
    IF NOT FOUND OR v_attempt IS DISTINCT FROM j.attempts THEN
      RAISE EXCEPTION 'STATE_ERROR: plagiarism submission does not belong to the current attempt %', j.attempts;
    END IF;
    v_sha := seo_text_sha256(p_payload->>'submitted_text');
    IF v_sha <> a.check_text_sha256 THEN
      RAISE EXCEPTION 'STATE_ERROR: text submitted for plagiarism does not match the recorded article text';
    END IF;
    INSERT INTO seo_plagiarism_checks AS t
      (article_id, run_no, attempt_no, content_sha256, word_count, provider_hash, provider_key,
       status, threshold_percent, result)
    VALUES
      (p_article_id, j.run_no, j.attempts, v_sha, nullif(p_payload->>'word_count', '')::int,
       p_payload->>'provider_hash', p_payload->>'provider_key', 'SUBMITTED',
       nullif(p_payload->>'threshold_percent', '')::numeric, p_payload->'raw')
    ON CONFLICT (article_id, run_no, attempt_no) DO UPDATE SET
      content_sha256 = EXCLUDED.content_sha256, word_count = EXCLUDED.word_count,
      provider_hash = EXCLUDED.provider_hash, provider_key = EXCLUDED.provider_key,
      status = 'SUBMITTED', poll_count = 0, plag_percent = NULL, unique_percent = NULL,
      rephrased_percent = NULL, exact_percent = NULL, threshold_percent = EXCLUDED.threshold_percent,
      passed = NULL, result = EXCLUDED.result, error = NULL, submitted_at = now(),
      completed_at = NULL, updated_at = now();
    UPDATE seo_article_jobs t SET status = 'PLAGIARISM_CHECK', current_stage = 'PLAG_SUBMITTED'
     WHERE t.article_id = p_article_id;

  WHEN 'PLAG_RESULT' THEN
    IF v_attempt IS DISTINCT FROM j.attempts THEN
      RAISE EXCEPTION 'STATE_ERROR: plagiarism result is for attempt % but current attempt is %', v_attempt, j.attempts;
    END IF;
    SELECT * INTO pc FROM seo_plagiarism_checks t
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts FOR UPDATE;
    IF NOT FOUND THEN
      -- The request never produced a provider job (rejected, word limit,
      -- network failure). Record it as FAILED so the attempt history is complete.
      IF p_payload->>'status' <> 'FAILED' OR (p_payload->>'provider_hash') IS NOT NULL THEN
        RAISE EXCEPTION 'STATE_ERROR: no plagiarism submission recorded for current attempt %', j.attempts;
      END IF;
      SELECT * INTO a FROM seo_article_attempts t
       WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STATE_ERROR: no recorded article for attempt %', j.attempts;
      END IF;
      INSERT INTO seo_plagiarism_checks (article_id, run_no, attempt_no, content_sha256, status, error)
      VALUES (p_article_id, j.run_no, j.attempts, a.check_text_sha256, 'FAILED', seo_redact(p_payload->>'error'))
      RETURNING * INTO pc;
    END IF;
    IF pc.provider_hash IS DISTINCT FROM (p_payload->>'provider_hash') THEN
      RAISE EXCEPTION 'STATE_ERROR: plagiarism result hash does not match the submitted job';
    END IF;
    v_status := p_payload->>'status';
    IF v_status NOT IN ('COMPLETED','FAILED','TIMEOUT') THEN
      RAISE EXCEPTION 'STATE_ERROR: invalid plagiarism status %', v_status;
    END IF;
    -- Fail closed: only a COMPLETED report can ever pass.
    v_passed := CASE WHEN v_status = 'COMPLETED' THEN coalesce((p_payload->>'passed')::boolean, false) ELSE false END;
    UPDATE seo_plagiarism_checks t SET status = v_status,
           poll_count = coalesce(nullif(p_payload->>'poll_count', '')::int, t.poll_count),
           plag_percent = nullif(p_payload->>'plag_percent', '')::numeric,
           unique_percent = nullif(p_payload->>'unique_percent', '')::numeric,
           rephrased_percent = nullif(p_payload->>'rephrased_percent', '')::numeric,
           exact_percent = nullif(p_payload->>'exact_percent', '')::numeric,
           passed = v_passed, result = coalesce(p_payload->'result', t.result),
           error = seo_redact(p_payload->>'error'),
           completed_at = CASE WHEN v_status = 'COMPLETED' THEN now() ELSE NULL END,
           updated_at = now()
     WHERE t.check_id = pc.check_id;
    UPDATE seo_article_attempts t SET plagiarism_status = v_status,
           plagiarism_percent = nullif(p_payload->>'plag_percent', '')::numeric,
           plagiarism_passed = v_passed, updated_at = now()
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts;
    UPDATE seo_article_jobs t SET current_stage = 'PLAG_' || v_status,
           plagiarism_summary = (p_payload - 'result') || jsonb_build_object('passed', v_passed)
     WHERE t.article_id = p_article_id;
    v_detail := jsonb_build_object('passed', v_passed);

  WHEN 'DECISION' THEN
    IF v_attempt IS DISTINCT FROM j.attempts THEN
      RAISE EXCEPTION 'STATE_ERROR: decision is for attempt % but current attempt is %', v_attempt, j.attempts;
    END IF;
    IF p_payload->>'decision' = 'REVISE' AND j.attempts >= j.max_attempts THEN
      RAISE EXCEPTION 'ATTEMPT_LIMIT: cannot revise after % of % attempts', j.attempts, j.max_attempts;
    END IF;
    UPDATE seo_article_attempts t SET decision = p_payload->>'decision',
           decision_reasons = p_payload->'reasons', updated_at = now()
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts;
    UPDATE seo_article_jobs t SET
           status = CASE WHEN p_payload->>'decision' = 'REVISE' THEN 'REVISION_REQUIRED' ELSE t.status END,
           current_stage = 'DECISION_' || (p_payload->>'decision')
     WHERE t.article_id = p_article_id;

  WHEN 'APPROVAL_READY' THEN
    SELECT * INTO a FROM seo_article_attempts t
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts;
    SELECT * INTO pc FROM seo_plagiarism_checks t
     WHERE t.article_id = p_article_id AND t.run_no = j.run_no AND t.attempt_no = j.attempts;
    IF v_attempt IS DISTINCT FROM j.attempts THEN
      v_reasons := v_reasons || format('approval requested for attempt %s but current attempt is %s', v_attempt, j.attempts);
    END IF;
    IF a.article_id IS NULL THEN
      v_reasons := v_reasons || 'no recorded article for the current attempt'::text;
    ELSIF a.editorial_passed IS NOT TRUE THEN
      v_reasons := v_reasons || 'editorial evaluation did not pass for the current attempt'::text;
    END IF;
    IF pc.check_id IS NULL THEN
      v_reasons := v_reasons || 'no plagiarism report exists for the current attempt'::text;
    ELSE
      IF pc.status <> 'COMPLETED' THEN
        v_reasons := v_reasons || format('plagiarism report status is %s, not COMPLETED', pc.status);
      END IF;
      IF pc.passed IS NOT TRUE THEN
        v_reasons := v_reasons || 'plagiarism report did not pass the acceptance policy'::text;
      END IF;
      IF a.article_id IS NOT NULL AND pc.content_sha256 <> a.check_text_sha256 THEN
        v_reasons := v_reasons || 'plagiarism report was produced for different text'::text;
      END IF;
    END IF;
    IF array_length(v_reasons, 1) > 0 THEN
      RAISE EXCEPTION 'APPROVAL_GATE_FAILED: %', array_to_string(v_reasons, '; ');
    END IF;
    UPDATE seo_article_jobs t SET checks_passed = true, approval_payload = p_payload->'approval_payload',
           doc_marker = seo_doc_marker(t.article_id), current_stage = 'APPROVAL_READY',
           quality_status = 'PASS'
     WHERE t.article_id = p_article_id;
    v_detail := jsonb_build_object('marker', seo_doc_marker(p_article_id));

  WHEN 'DOC_WRITE_PENDING' THEN
    IF NOT j.checks_passed THEN
      RAISE EXCEPTION 'APPROVAL_GATE_FAILED: Google Docs write requested before all checks passed';
    END IF;
    SELECT * INTO l FROM seo_document_ledger t WHERE t.article_id = p_article_id FOR UPDATE;
    IF FOUND AND l.status = 'VERIFIED' THEN
      v_detail := jsonb_build_object('already_verified', true, 'doc_id', l.doc_id, 'write_count', l.write_count);
    ELSE
      INSERT INTO seo_document_ledger AS t
        (article_id, doc_id, marker, status, run_no, attempt_no, execution_id, write_count)
      VALUES
        (p_article_id, p_payload->>'doc_id', seo_doc_marker(p_article_id), 'PENDING', j.run_no, j.attempts, p_owner, 1)
      ON CONFLICT (article_id) DO UPDATE SET doc_id = EXCLUDED.doc_id, status = 'PENDING',
        execution_id = EXCLUDED.execution_id, write_count = t.write_count + 1, updated_at = now();
      SELECT * INTO l FROM seo_document_ledger t WHERE t.article_id = p_article_id;
      v_detail := jsonb_build_object('already_verified', false, 'doc_id', l.doc_id, 'write_count', l.write_count);
    END IF;
    UPDATE seo_article_jobs t SET current_stage = 'DOC_WRITE_PENDING' WHERE t.article_id = p_article_id;

  WHEN 'DOC_VERIFIED' THEN
    IF NOT j.checks_passed THEN
      RAISE EXCEPTION 'APPROVAL_GATE_FAILED: cannot verify a document write for an unapproved article';
    END IF;
    INSERT INTO seo_document_ledger AS t
      (article_id, doc_id, marker, status, run_no, attempt_no, execution_id, write_count, verified_at)
    VALUES
      (p_article_id, p_payload->>'doc_id', seo_doc_marker(p_article_id), 'VERIFIED', j.run_no, j.attempts, p_owner, 0, now())
    ON CONFLICT (article_id) DO UPDATE SET doc_id = EXCLUDED.doc_id, status = 'VERIFIED',
      verified_at = now(), updated_at = now();
    UPDATE seo_article_jobs t SET google_doc_id = p_payload->>'doc_id', google_doc_url = p_payload->>'doc_url',
           doc_verified_at = now(), current_stage = 'DOC_VERIFIED'
     WHERE t.article_id = p_article_id;

  WHEN 'FINALIZE' THEN
    v_final := p_payload->>'final_status';
    IF v_final NOT IN ('APPROVED','REVIEW_REQUIRED','ERROR','SKIPPED_DUPLICATE') THEN
      RAISE EXCEPTION 'STATE_ERROR: invalid final status %', v_final;
    END IF;
    IF v_final = 'APPROVED' THEN
      SELECT * INTO l FROM seo_document_ledger t WHERE t.article_id = p_article_id;
      IF NOT j.checks_passed OR l.status IS DISTINCT FROM 'VERIFIED' THEN
        RAISE EXCEPTION 'APPROVAL_GATE_FAILED: APPROVED requires passed checks and a verified Google Docs write';
      END IF;
    END IF;
    UPDATE seo_article_jobs t SET status = v_final, final_status = v_final, current_stage = 'FINALIZED',
           last_error = seo_redact(nullif(p_payload->>'last_error', '')),
           failure_stage = nullif(p_payload->>'failure_stage', ''),
           retryable = nullif(p_payload->>'retryable', '')::boolean,
           approval_candidate = CASE WHEN v_final = 'APPROVED' THEN NULL
                                     ELSE coalesce(p_payload->'approval_candidate', t.approval_candidate) END,
           quality_status = coalesce(nullif(p_payload->>'quality_status', ''), t.quality_status),
           keywords_sheet_synced_at = NULL, article_log_synced_at = NULL,
           lease_owner = NULL, lease_expires_at = NULL, completed_at = now()
     WHERE t.article_id = p_article_id;

  WHEN 'SHEETS_SYNCED' THEN
    UPDATE seo_article_jobs t SET
           keywords_sheet_synced_at = CASE WHEN coalesce((p_payload->>'keywords')::boolean, false) THEN now() ELSE t.keywords_sheet_synced_at END,
           article_log_synced_at = CASE WHEN coalesce((p_payload->>'article_log')::boolean, false) THEN now() ELSE t.article_log_synced_at END,
           lease_owner = CASE WHEN t.lease_owner = p_owner THEN NULL ELSE t.lease_owner END,
           lease_expires_at = CASE WHEN t.lease_owner = p_owner THEN NULL ELSE t.lease_expires_at END
     WHERE t.article_id = p_article_id;

  ELSE
    RAISE EXCEPTION 'STATE_ERROR: unknown event %', p_event;
  END CASE;

  IF p_event NOT IN ('FINALIZE','SHEETS_SYNCED') THEN
    UPDATE seo_article_jobs t SET lease_expires_at = now() + v_lease, heartbeat_at = now()
     WHERE t.article_id = p_article_id;
  END IF;
  UPDATE seo_article_jobs t SET updated_at = now() WHERE t.article_id = p_article_id;

  SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id;
  RETURN QUERY SELECT true, j.article_id, j.status, j.run_no, j.attempts, v_detail;
END
$fn$;

-- ---------------------------------------------------------------------
-- Master Google Doc (single shared document, created automatically).
-- Compare-and-swap so concurrent executions converge on one document.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo_set_master_doc(p_expected_doc_id text, p_doc jsonb)
RETURNS TABLE (won boolean, master_doc jsonb)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_current jsonb;
BEGIN
  IF coalesce(p_doc->>'doc_id', '') = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: doc_id is required';
  END IF;
  PERFORM pg_advisory_xact_lock(724100002);
  SELECT setting_value INTO v_current FROM seo_settings WHERE setting_key = 'master_doc';
  IF v_current IS NULL OR (v_current->>'doc_id') IS NOT DISTINCT FROM nullif(p_expected_doc_id, '') THEN
    PERFORM seo_put_setting('master_doc', p_doc || jsonb_build_object('stored_at', now()));
    RETURN QUERY SELECT true, seo_get_setting('master_doc');
  ELSE
    RETURN QUERY SELECT false, v_current;
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------
-- Schema / configuration status used by workflows 01 and 02 right after
-- schema initialisation. Stores the spreadsheet ID on first use and
-- reports a mismatch afterwards (unless a change is explicitly allowed).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo_schema_status(
  p_brand_id text, p_spreadsheet_id text, p_model text, p_allow_spreadsheet_change boolean, p_runtime_config jsonb)
RETURNS TABLE (embedding_column_dims integer, pgvector_version text, active_records integer,
               total_records integer, stored_spreadsheet_id text, spreadsheet_matches boolean, master_doc jsonb)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_dims    integer;
  v_stored  text;
BEGIN
  SELECT a.atttypmod INTO v_dims
    FROM pg_attribute a
   WHERE a.attrelid = 'seo_brand_knowledge'::regclass AND a.attname = 'embedding' AND NOT a.attisdropped;

  v_stored := seo_get_setting('spreadsheet')->>'spreadsheet_id';
  IF v_stored IS NULL OR coalesce(p_allow_spreadsheet_change, false) THEN
    PERFORM seo_put_setting('spreadsheet', jsonb_build_object('spreadsheet_id', p_spreadsheet_id));
    v_stored := p_spreadsheet_id;
  END IF;
  IF p_runtime_config IS NOT NULL AND v_stored = p_spreadsheet_id THEN
    PERFORM seo_put_setting('runtime_config', p_runtime_config);
  END IF;

  RETURN QUERY
    SELECT v_dims,
           (SELECT extversion FROM pg_extension WHERE extname = 'vector')::text,
           (SELECT count(*)::int FROM seo_brand_knowledge k WHERE k.brand_id = p_brand_id AND k.is_active AND k.embedding_model = p_model),
           (SELECT count(*)::int FROM seo_brand_knowledge k WHERE k.brand_id = p_brand_id),
           v_stored,
           (v_stored = p_spreadsheet_id),
           seo_get_setting('master_doc');
END
$fn$;

-- ---------------------------------------------------------------------
-- Recovery helpers (workflow 03).
-- ---------------------------------------------------------------------

-- Classifies an error text as permanent (authentication, permissions,
-- configuration, plan, approval gate) or transient.
CREATE OR REPLACE FUNCTION seo_error_is_retryable(p_error text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT NOT (coalesce(p_error, '') ~* '(401|403|402|unauthori[sz]ed|forbidden|permission|PERMISSION_DENIED|invalid api key|API key not valid|invalid token|CONFIG_ERROR|APPROVAL_GATE_FAILED|ATTEMPT_LIMIT|plan expired|insufficient.*(scope|credit|word)|credentials? (not found|could not be found|missing))');
$fn$;

-- Releases a failed job that is owned by a FINISHED execution and decides
-- what the Keywords sheet should show. Never touches a job whose lease is
-- owned by a different execution.
CREATE OR REPLACE FUNCTION seo_release_failed_job(
  p_article_id text, p_owner text, p_reason text, p_stage text, p_max_recovery integer)
RETURNS TABLE (action text, sheet_status text, sheet_last_error text, retryable boolean, job jsonb)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  j          seo_article_jobs%ROWTYPE;
  v_ledger   text;
  v_retry    boolean := seo_error_is_retryable(p_reason);
  v_reason   text := left(seo_redact(p_reason), 1500);
  v_action   text;
  v_sheet    text;
  v_msg      text;
BEGIN
  SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id FOR UPDATE;
  IF NOT FOUND OR j.lease_owner IS DISTINCT FROM p_owner THEN
    RETURN QUERY SELECT 'NONE'::text, NULL::text, NULL::text, v_retry, NULL::jsonb;
    RETURN;
  END IF;
  SELECT l.status INTO v_ledger FROM seo_document_ledger l WHERE l.article_id = p_article_id;

  IF v_ledger = 'VERIFIED' AND j.checks_passed THEN
    -- The article is already in Google Docs: reconcile, never regenerate.
    UPDATE seo_article_jobs t SET status = 'APPROVED', final_status = 'APPROVED', current_stage = 'RECOVERED_APPROVED',
           keywords_sheet_synced_at = NULL, article_log_synced_at = NULL, lease_owner = NULL,
           lease_expires_at = NULL, completed_at = coalesce(t.completed_at, now()),
           last_error = NULL, updated_at = now()
     WHERE t.article_id = p_article_id;
    v_action := 'SYNC_SHEETS'; v_sheet := 'APPROVED'; v_msg := '';
  ELSIF (v_retry OR v_ledger = 'PENDING') AND j.recovery_attempts < coalesce(p_max_recovery, 3) THEN
    -- Re-queue. If a Docs write may have happened (PENDING ledger), the next
    -- run resumes in RESUME_DOC mode and checks the marker before appending.
    UPDATE seo_article_jobs t SET status = 'ERROR', current_stage = 'RECOVERY_REQUEUED',
           last_error = v_reason, failure_stage = p_stage, retryable = true,
           recovery_attempts = t.recovery_attempts + 1, lease_owner = NULL, lease_expires_at = NULL,
           updated_at = now()
     WHERE t.article_id = p_article_id;
    v_action := 'RETRY'; v_sheet := 'READY';
    v_msg := format('Auto-retry %s/%s queued after failure at %s: %s', j.recovery_attempts + 1,
                    coalesce(p_max_recovery, 3), coalesce(p_stage, 'unknown stage'), v_reason);
  ELSE
    UPDATE seo_article_jobs t SET status = 'ERROR', final_status = 'ERROR', current_stage = 'RECOVERY_FAILED',
           last_error = v_reason, failure_stage = p_stage, retryable = v_retry,
           lease_owner = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
     WHERE t.article_id = p_article_id;
    v_action := 'MARK_ERROR'; v_sheet := 'ERROR';
    v_msg := CASE WHEN v_retry THEN format('Retry limit reached at %s: %s', coalesce(p_stage, 'unknown stage'), v_reason)
                  ELSE format('Permanent error at %s (fix configuration/credentials, then set Status to READY): %s',
                              coalesce(p_stage, 'unknown stage'), v_reason) END;
  END IF;

  SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id;
  RETURN QUERY SELECT v_action, v_sheet, v_msg, v_retry, to_jsonb(j);
END
$fn$;

-- Error Trigger entry point: records the failure and releases the job that
-- the failed execution owned (if any).
CREATE OR REPLACE FUNCTION seo_record_execution_error(
  p_execution_id text, p_workflow_id text, p_workflow_name text, p_mode text,
  p_last_node text, p_error_message text, p_max_recovery integer)
RETURNS TABLE (error_id bigint, action text, article_id text, keyword_id text, sheet_status text,
               sheet_last_error text, retryable boolean, job jsonb)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  v_err_id bigint;
  v_aid    text;
  v_kw     text;
  r        record;
BEGIN
  -- A manual test run of the Error Trigger supplies sample data without a
  -- real execution ID: record nothing and release nothing.
  IF coalesce(btrim(p_execution_id), '') = '' THEN
    RETURN QUERY SELECT NULL::bigint, 'NONE'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::boolean, NULL::jsonb;
    RETURN;
  END IF;
  SELECT t.article_id, t.keyword_id INTO v_aid, v_kw
    FROM seo_article_jobs t WHERE t.lease_owner = p_execution_id
   ORDER BY t.updated_at DESC LIMIT 1;

  -- The same execution can only be recorded once.
  SELECT e.error_id INTO v_err_id FROM seo_execution_errors e
   WHERE e.execution_id = p_execution_id AND e.workflow_id IS NOT DISTINCT FROM p_workflow_id
     AND e.failure_stage IS DISTINCT FROM 'STALE_LEASE'
   LIMIT 1;
  IF v_err_id IS NOT NULL THEN
    RETURN QUERY SELECT v_err_id, 'ALREADY_RECORDED'::text, v_aid, v_kw, NULL::text, NULL::text,
                        seo_error_is_retryable(p_error_message), NULL::jsonb;
    RETURN;
  END IF;

  INSERT INTO seo_execution_errors AS e
    (execution_id, workflow_id, workflow_name, execution_mode, keyword_id, article_id,
     failure_stage, error_message, retryable, recovery_status)
  VALUES
    (p_execution_id, p_workflow_id, p_workflow_name, p_mode, v_kw, v_aid, p_last_node,
     left(seo_redact(p_error_message), 4000), seo_error_is_retryable(p_error_message), 'RECORDED')
  RETURNING e.error_id INTO v_err_id;

  IF v_aid IS NULL THEN
    UPDATE seo_execution_errors e SET recovery_status = 'NO_JOB_OWNED', recovery_action = 'NONE'
     WHERE e.error_id = v_err_id;
    RETURN QUERY SELECT v_err_id, 'NONE'::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        seo_error_is_retryable(p_error_message), NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO r FROM seo_release_failed_job(v_aid, p_execution_id, p_error_message, p_last_node, p_max_recovery);
  UPDATE seo_execution_errors e SET recovery_status = CASE r.action
           WHEN 'SYNC_SHEETS' THEN 'RECONCILE_REQUIRED' WHEN 'RETRY' THEN 'REQUEUED'
           WHEN 'MARK_ERROR' THEN 'MARKED_ERROR' ELSE 'NO_ACTION' END,
         recovery_action = r.action, retryable = r.retryable
   WHERE e.error_id = v_err_id;
  RETURN QUERY SELECT v_err_id, r.action, v_aid, v_kw, r.sheet_status, r.sheet_last_error, r.retryable, r.job;
END
$fn$;

-- Scheduled / manual recovery sweep. Returns one row per job that needs a
-- follow-up action in n8n:
--   SYNC_SHEETS        - article verified in Google Docs, sheet rows not yet updated
--   RETRY / MARK_ERROR - expired lease released (job owner stopped heart-beating)
--   REPOLL_PLAGIARISM  - a timed-out DupliChecker job can still be collected
CREATE OR REPLACE FUNCTION seo_recovery_sweep(
  p_owner text, p_grace_minutes integer, p_max_recovery integer, p_hash_valid_hours numeric)
RETURNS TABLE (action text, article_id text, keyword_id text, sheet_status text, sheet_last_error text,
               job jsonb, plagiarism jsonb)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  j  seo_article_jobs%ROWTYPE;
  pc seo_plagiarism_checks%ROWTYPE;
  r  record;
BEGIN
  -- 1. Expired leases (owner has not heart-beaten for lease + grace).
  FOR j IN
    SELECT * FROM seo_article_jobs t
     WHERE t.lease_owner IS NOT NULL
       AND t.lease_expires_at < now() - make_interval(mins => greatest(coalesce(p_grace_minutes, 10), 1))
       AND t.status IN ('PROCESSING','PROMPT_CREATED','ARTICLE_GENERATED','QUALITY_REVIEW','PLAGIARISM_CHECK','REVISION_REQUIRED','APPROVED')
     FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO seo_execution_errors (execution_id, workflow_name, keyword_id, article_id, failure_stage,
                                      error_message, retryable, recovery_status)
    VALUES (j.lease_owner, 'lease sweep', j.keyword_id, j.article_id, 'STALE_LEASE',
            format('Lease held by execution %s expired at %s (last stage %s)', j.lease_owner, j.lease_expires_at, j.current_stage),
            true, 'RECORDED');
    SELECT * INTO r FROM seo_release_failed_job(j.article_id, j.lease_owner,
             format('Execution %s stopped without finishing (lease expired at stage %s)', j.lease_owner, j.current_stage),
             j.current_stage, p_max_recovery);
    RETURN QUERY SELECT r.action, j.article_id, j.keyword_id, r.sheet_status, r.sheet_last_error, r.job, NULL::jsonb;
  END LOOP;

  -- 2. Approved + verified articles whose sheet rows were never updated.
  FOR j IN
    SELECT * FROM seo_article_jobs t
     WHERE t.status = 'APPROVED' AND t.lease_owner IS NULL AND t.doc_verified_at IS NOT NULL
       AND (t.keywords_sheet_synced_at IS NULL OR t.article_log_synced_at IS NULL)
       AND t.completed_at < now() - interval '2 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    RETURN QUERY SELECT 'SYNC_SHEETS'::text, j.article_id, j.keyword_id, 'APPROVED'::text, ''::text, to_jsonb(j), NULL::jsonb;
  END LOOP;

  -- 2b. Unapproved final states whose Keywords row was never updated.
  FOR j IN
    SELECT * FROM seo_article_jobs t
     WHERE t.status IN ('REVIEW_REQUIRED','ERROR') AND t.lease_owner IS NULL AND t.final_status IS NOT NULL
       AND t.keywords_sheet_synced_at IS NULL AND t.completed_at < now() - interval '2 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    RETURN QUERY SELECT 'SYNC_SHEETS'::text, j.article_id, j.keyword_id, j.status, coalesce(j.last_error, ''), to_jsonb(j), NULL::jsonb;
  END LOOP;

  -- 3. Plagiarism jobs that timed out while their provider hash is still valid.
  FOR pc IN
    SELECT p.* FROM seo_plagiarism_checks p
      JOIN seo_article_jobs t ON t.article_id = p.article_id AND t.run_no = p.run_no AND t.attempts = p.attempt_no
      JOIN seo_article_attempts a ON a.article_id = p.article_id AND a.run_no = p.run_no AND a.attempt_no = p.attempt_no
     WHERE p.status IN ('TIMEOUT','SUBMITTED') AND p.provider_hash IS NOT NULL AND p.provider_key IS NOT NULL
       AND p.submitted_at > now() - make_interval(secs => (coalesce(p_hash_valid_hours, 6.5) * 3600)::int)
       AND p.submitted_at < now() - interval '5 minutes'
       AND p.recovery_attempts < coalesce(p_max_recovery, 3)
       AND t.status = 'REVIEW_REQUIRED' AND t.lease_owner IS NULL AND t.approval_candidate IS NOT NULL
       AND a.editorial_passed IS TRUE
     FOR UPDATE OF p SKIP LOCKED
  LOOP
    UPDATE seo_plagiarism_checks p SET recovery_attempts = p.recovery_attempts + 1, updated_at = now()
     WHERE p.check_id = pc.check_id;
    SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = pc.article_id;
    RETURN QUERY SELECT 'REPOLL_PLAGIARISM'::text, j.article_id, j.keyword_id, NULL::text, NULL::text, to_jsonb(j),
      jsonb_build_object('check_id', pc.check_id, 'run_no', pc.run_no, 'attempt_no', pc.attempt_no,
                         'provider_hash', pc.provider_hash, 'provider_key', pc.provider_key,
                         'threshold_percent', pc.threshold_percent, 'recovery_attempt', pc.recovery_attempts + 1);
  END LOOP;
END
$fn$;

-- Applies a recovered DupliChecker report. A COMPLETED report that passes
-- re-queues the job (Keywords Status READY) so that workflow 02 resumes in
-- RESUME_DOC mode; it does NOT approve anything by itself.
CREATE OR REPLACE FUNCTION seo_recovery_plagiarism_result(
  p_article_id text, p_check_id bigint, p_provider_hash text, p_result jsonb)
RETURNS TABLE (action text, sheet_status text, sheet_last_error text, job jsonb)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  pc       seo_plagiarism_checks%ROWTYPE;
  j        seo_article_jobs%ROWTYPE;
  v_status text := p_result->>'status';
  v_passed boolean;
BEGIN
  SELECT * INTO pc FROM seo_plagiarism_checks p WHERE p.check_id = p_check_id FOR UPDATE;
  SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id FOR UPDATE;
  IF pc.check_id IS NULL OR pc.article_id <> p_article_id OR pc.provider_hash IS DISTINCT FROM p_provider_hash THEN
    RAISE EXCEPTION 'STATE_ERROR: recovered plagiarism report does not match the stored job';
  END IF;
  IF j.status <> 'REVIEW_REQUIRED' OR j.lease_owner IS NOT NULL OR j.attempts <> pc.attempt_no OR j.run_no <> pc.run_no THEN
    RETURN QUERY SELECT 'NONE'::text, NULL::text, NULL::text, to_jsonb(j);
    RETURN;
  END IF;

  IF v_status = 'PENDING' THEN
    RETURN QUERY SELECT 'PENDING'::text, NULL::text, NULL::text, to_jsonb(j);
    RETURN;
  END IF;
  IF v_status NOT IN ('COMPLETED','FAILED') THEN
    v_status := 'FAILED';
  END IF;
  v_passed := v_status = 'COMPLETED' AND coalesce((p_result->>'passed')::boolean, false);

  UPDATE seo_plagiarism_checks p SET status = v_status,
         plag_percent = nullif(p_result->>'plag_percent', '')::numeric,
         unique_percent = nullif(p_result->>'unique_percent', '')::numeric,
         rephrased_percent = nullif(p_result->>'rephrased_percent', '')::numeric,
         exact_percent = nullif(p_result->>'exact_percent', '')::numeric,
         passed = v_passed, result = coalesce(p_result->'result', p.result),
         error = seo_redact(p_result->>'error'),
         completed_at = CASE WHEN v_status = 'COMPLETED' THEN now() ELSE NULL END, updated_at = now()
   WHERE p.check_id = pc.check_id;
  UPDATE seo_article_attempts a SET plagiarism_status = v_status,
         plagiarism_percent = nullif(p_result->>'plag_percent', '')::numeric, plagiarism_passed = v_passed,
         updated_at = now()
   WHERE a.article_id = pc.article_id AND a.run_no = pc.run_no AND a.attempt_no = pc.attempt_no;

  IF v_passed THEN
    UPDATE seo_article_jobs t SET status = 'READY', current_stage = 'RECOVERED_PLAGIARISM_PASS',
           checks_passed = true, quality_status = 'PASS',
           approval_payload = t.approval_candidate || jsonb_build_object('plagiarism', p_result - 'result'),
           plagiarism_summary = (p_result - 'result'), doc_marker = seo_doc_marker(t.article_id),
           last_error = NULL, keywords_sheet_synced_at = NULL, updated_at = now()
     WHERE t.article_id = p_article_id;
    SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id;
    RETURN QUERY SELECT 'RESUME'::text, 'READY'::text,
      format('Recovered DupliChecker report passed (%s%%); the next run will publish to Google Docs', p_result->>'plag_percent'),
      to_jsonb(j);
  ELSE
    UPDATE seo_article_jobs t SET plagiarism_summary = (p_result - 'result'),
           last_error = format('Recovered DupliChecker report: %s %s', v_status,
                               coalesce(p_result->>'plag_percent', p_result->>'error', '')),
           updated_at = now()
     WHERE t.article_id = p_article_id;
    SELECT * INTO j FROM seo_article_jobs t WHERE t.article_id = p_article_id;
    RETURN QUERY SELECT 'MARK_REVIEW'::text, 'REVIEW_REQUIRED'::text, j.last_error, to_jsonb(j);
  END IF;
END
$fn$;
