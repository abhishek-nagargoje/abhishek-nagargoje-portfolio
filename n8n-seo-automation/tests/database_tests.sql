-- =============================================================================
-- database_tests.sql - executable assertions for the seo schema.
-- Run against a DISPOSABLE database that has 01-04 applied:
--   psql -v ON_ERROR_STOP=1 -d seo_test -f tests/database_tests.sql
-- Runs as the least-privilege application role to prove the grants suffice.
-- Any failed ASSERT aborts with a non-zero exit code.
-- =============================================================================
SET client_min_messages = notice;
SET ROLE n8n_seo_app;

CREATE TEMP TABLE IF NOT EXISTS t_vec AS
SELECT (SELECT array_agg(random()::real) FROM generate_series(1, 768))::vector(768)::text AS v1,
       (SELECT array_agg(random()::real) FROM generate_series(1, 768))::vector(768)::text AS v2,
       (SELECT array_agg(random()::real) FROM generate_series(1, 3))::vector(3)::text AS bad;

-- ---------------------------------------------------------------------------
-- RAG-1: insert / unchanged / updated / validation
-- ---------------------------------------------------------------------------
DO $$
DECLARE v1 text; v2 text; bad text; a text;
BEGIN
  SELECT t.v1, t.v2, t.bad INTO v1, v2, bad FROM t_vec t;
  SELECT action INTO a FROM seo.upsert_brand_chunk('TEST', 'K1', 0, 'SERVICES', 'Housekeeping services.', '', repeat('a', 64), '2026-10-01', v1, 'gemini-embedding-001', 768, '{}');
  ASSERT a = 'INSERTED', 'RAG-1a expected INSERTED got ' || a;
  SELECT action INTO a FROM seo.upsert_brand_chunk('TEST', 'K1', 0, 'SERVICES', 'Housekeeping services.', '', repeat('a', 64), '2026-10-01', v1, 'gemini-embedding-001', 768, '{}');
  ASSERT a = 'UNCHANGED', 'RAG-1b expected UNCHANGED got ' || a;
  SELECT action INTO a FROM seo.upsert_brand_chunk('TEST', 'K1', 0, 'SERVICES', 'Housekeeping and security services.', '', repeat('b', 64), '2026-10-02', v2, 'gemini-embedding-001', 768, '{}');
  ASSERT a = 'UPDATED', 'RAG-1c expected UPDATED got ' || a;
  ASSERT (SELECT count(*) FROM seo.brand_knowledge_chunks WHERE brand_id = 'TEST' AND knowledge_id = 'K1') = 1, 'RAG-1d duplicate rows';
  BEGIN
    PERFORM seo.upsert_brand_chunk('TEST', 'K2', 0, 'SERVICES', 'x', '', repeat('c', 64), '', bad, 'gemini-embedding-001', 768, '{}');
    RAISE EXCEPTION 'RAG-1e dimension mismatch was not rejected';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE 'EMBEDDING_DIMENSION_MISMATCH%' OR SQLERRM LIKE '%expected 768 dimensions%', 'RAG-1e unexpected error: ' || SQLERRM;
  END;
  BEGIN
    PERFORM seo.upsert_brand_chunk('TEST', 'K2', 0, 'SERVICES', 'x', '', repeat('c', 64), '', v1, 'some-other-model', 768, '{}');
    RAISE EXCEPTION 'RAG-1f model mismatch was not rejected';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE 'EMBEDDING_CONFIG_MISMATCH%', 'RAG-1f unexpected error: ' || SQLERRM;
  END;
  RAISE NOTICE 'PASS RAG-1 upsert idempotency and embedding validation';
END $$;

-- ---------------------------------------------------------------------------
-- RAG-2: retrieval (semantic top-K + pinned categories) and RAG-3 deactivation
-- ---------------------------------------------------------------------------
DO $$
DECLARE v1 text; v2 text; n int; r record;
BEGIN
  SELECT t.v1, t.v2 INTO v1, v2 FROM t_vec t;
  PERFORM seo.upsert_brand_chunk('TEST', 'K3', 0, 'BRAND_VOICE', 'Plain, factual tone.', '', repeat('d', 64), '', v1, 'gemini-embedding-001', 768, '{}');
  PERFORM seo.upsert_brand_chunk('TEST', 'K4', 0, 'INTERNAL_LINKS', 'https://example.com/housekeeping', '', repeat('e', 64), '', v1, 'gemini-embedding-001', 768, '{}');
  SELECT count(*) INTO n FROM seo.match_brand_knowledge('TEST', v2, 1, 0.99, ARRAY['BRAND_VOICE'], 1);
  -- K1 holds v2, so the single semantic hit has similarity 1.0; BRAND_VOICE is pinned.
  ASSERT n = 2, 'RAG-2a expected 2 rows (1 semantic + 1 pinned) got ' || n;
  SELECT * INTO r FROM seo.match_brand_knowledge('TEST', v2, 1, 0.0, ARRAY[]::text[], 0) LIMIT 1;
  ASSERT r.knowledge_id = 'K1' AND r.similarity > 0.999, 'RAG-2b nearest neighbour wrong';
  SELECT count(*) INTO n FROM seo.match_brand_knowledge('EMPTY_BRAND', v2, 8, 0.0, ARRAY['BRAND_VOICE'], 2);
  ASSERT n = 0, 'RAG-2c empty brand must return no rows';

  SELECT count(*) INTO n FROM seo.deactivate_brand_knowledge('TEST', ARRAY['K4'], '{"K1": 1}'::jsonb);
  ASSERT n = 1, 'RAG-3a expected 1 deactivated got ' || n;
  ASSERT (SELECT NOT is_active FROM seo.brand_knowledge_chunks WHERE chunk_id = 'TEST:K4:0'), 'RAG-3b K4 still active';
  ASSERT (SELECT count(*) FROM seo.brand_knowledge_chunks WHERE chunk_id = 'TEST:K4:0') = 1, 'RAG-3c row must not be deleted';
  SELECT count(*) INTO n FROM seo.match_brand_knowledge('TEST', v1, 8, 0.0, ARRAY['INTERNAL_LINKS'], 2) WHERE knowledge_id = 'K4';
  ASSERT n = 0, 'RAG-3d inactive chunk retrieved';
  RAISE NOTICE 'PASS RAG-2/RAG-3 retrieval, pinned categories, soft deactivation';
END $$;

-- ---------------------------------------------------------------------------
-- Q-1: claim, IN_PROGRESS, fencing (CLAIM_LOST), stage, attempts, stale report
-- ---------------------------------------------------------------------------
DO $$
DECLARE c record; h text; ok boolean;
BEGIN
  SELECT * INTO c FROM seo.claim_keyword('KW001', 'TEST', 'https://example.com/housekeeping', 'https://example.com/housekeeping',
                                         'Housekeeping Services Pune', 'housekeeping services pune', 'exec-1', 180, false, 3);
  ASSERT c.outcome = 'CLAIMED' AND c.article_id LIKE 'ART-%', 'Q-1a claim failed: ' || c.outcome;
  PERFORM set_config('t.article', c.article_id, false);

  SELECT * INTO c FROM seo.claim_keyword('KW001', 'TEST', 'https://example.com/housekeeping', 'https://example.com/housekeeping',
                                         'Housekeeping Services Pune', 'housekeeping services pune', 'exec-2', 180, false, 3);
  ASSERT c.outcome = 'IN_PROGRESS', 'Q-1b second claim must be IN_PROGRESS, got ' || c.outcome;

  BEGIN
    PERFORM seo.set_stage('KW001', 'exec-2', 'PROMPT_CREATED');
    RAISE EXCEPTION 'Q-1c fencing failed';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE 'CLAIM_LOST%', 'Q-1c unexpected: ' || SQLERRM;
  END;
  PERFORM seo.set_stage('KW001', 'exec-1', 'PROMPT_CREATED');

  SELECT content_sha256 INTO h FROM seo.record_attempt(current_setting('t.article'), 'KW001', 'exec-1', 1, 'INITIAL',
         '{"Article_Title":"T"}'::jsonb, '# H1\n\nBody v1', '[]'::jsonb, NULL);
  ASSERT length(h) = 64, 'Q-1d hash missing';
  PERFORM seo.record_editorial_result(current_setting('t.article'), 'KW001', 'exec-1', 1, 'FAIL', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '["X"]'::jsonb);

  -- a plagiarism report for a different text must be rejected
  BEGIN
    PERFORM seo.record_plagiarism_result(current_setting('t.article'), 'KW001', 'exec-1', 1, repeat('0', 64), 'PASS', 1.0, '{}'::jsonb, 'ref', '[]'::jsonb);
    RAISE EXCEPTION 'Q-1e stale report accepted';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE 'PLAGIARISM_REPORT_STALE%', 'Q-1e unexpected: ' || SQLERRM;
  END;

  -- Docs write must be refused while the latest attempt has not PASSED
  ASSERT (SELECT decision FROM seo.begin_doc_write(current_setting('t.article'), 'KW001', 'exec-1', 'DOC1', 'SEO-ARTICLE-MARKER: ' || current_setting('t.article'), 100)) = 'NOT_APPROVABLE',
         'Q-1f failed article must not be approvable';
  RAISE NOTICE 'PASS Q-1 claim, concurrency guard, fencing, stale-report guard, approval guard';
END $$;

-- ---------------------------------------------------------------------------
-- Q-2: revision attempt passes -> Docs ledger -> crash -> RECOVER -> finalize
--      -> re-run is ALREADY_COMPLETED (Test 3 & Test 11 at database level)
-- ---------------------------------------------------------------------------
DO $$
DECLARE c record; h text; d text; art text := current_setting('t.article');
BEGIN
  SELECT content_sha256 INTO h FROM seo.record_attempt(art, 'KW001', 'exec-1', 2, 'REVISION',
         '{"Article_Title":"T2"}'::jsonb, '# H1\n\nBody v2', '[]'::jsonb, '["fixed"]'::jsonb);
  PERFORM seo.record_editorial_result(art, 'KW001', 'exec-1', 2, 'PASS', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
  PERFORM seo.record_plagiarism_result(art, 'KW001', 'exec-1', 2, h, 'PASS', 3.5, '{}'::jsonb, 'ref-2', '[]'::jsonb);

  ASSERT (SELECT acquired FROM seo.acquire_doc_lock('DOC1', 'exec-1', 300)), 'Q-2a lock not acquired';
  ASSERT NOT (SELECT acquired FROM seo.acquire_doc_lock('DOC1', 'exec-9', 300)), 'Q-2b lock must be exclusive';

  SELECT decision INTO d FROM seo.begin_doc_write(art, 'KW001', 'exec-1', 'DOC1', 'SEO-ARTICLE-MARKER: ' || art, 100);
  ASSERT d = 'PROCEED', 'Q-2c expected PROCEED got ' || d;
  SELECT decision INTO d FROM seo.begin_doc_write(art, 'KW001', 'exec-1', 'DOC1', 'SEO-ARTICLE-MARKER: ' || art, 100);
  ASSERT d = 'RECONCILE', 'Q-2d second begin must RECONCILE, got ' || d;

  -- Docs append succeeded and the marker was found...
  PERFORM seo.set_doc_write_state(art, 'VERIFIED', NULL);
  ASSERT seo.set_doc_write_state(art, 'FAILED', 'late failure') = 'VERIFIED', 'Q-2e VERIFIED must not be downgraded';
  -- ...then n8n crashed before the DB/Sheets updates. Simulate lease expiry:
  RESET ROLE;
  UPDATE seo.keyword_records SET lease_expires_at = now() - interval '1 minute' WHERE keyword_id = 'KW001';
  SET ROLE n8n_seo_app;

  SELECT * INTO c FROM seo.claim_keyword('KW001', 'TEST', 'https://example.com/housekeeping', 'https://example.com/housekeeping',
                                         'Housekeeping Services Pune', 'housekeeping services pune', 'exec-3', 180, false, 3);
  ASSERT c.outcome = 'RECOVER' AND c.article_id = art, 'Q-2f expected RECOVER for same article, got ' || c.outcome;
  ASSERT (SELECT decision FROM seo.begin_doc_write(art, 'KW001', 'exec-3', 'DOC1', 'SEO-ARTICLE-MARKER: ' || art, 100)) = 'ALREADY_WRITTEN',
         'Q-2g verified write must never be appended again';

  PERFORM seo.finalize_approved_article(art, 'exec-3', 'DOC1', 'https://docs.google.com/document/d/DOC1/edit');
  PERFORM seo.finalize_approved_article(art, 'exec-3', 'DOC1', 'https://docs.google.com/document/d/DOC1/edit'); -- idempotent
  ASSERT (SELECT status FROM seo.keyword_records WHERE keyword_id = 'KW001') = 'APPROVED', 'Q-2h keyword not APPROVED';
  ASSERT (SELECT count(*) FROM seo.articles WHERE keyword_id = 'KW001' AND status = 'APPROVED') = 1, 'Q-2i approved count';

  SELECT * INTO c FROM seo.claim_keyword('KW001', 'TEST', 'https://example.com/housekeeping', 'https://example.com/housekeeping',
                                         'Housekeeping Services Pune', 'housekeeping services pune', 'exec-4', 180, false, 3);
  ASSERT c.outcome = 'ALREADY_COMPLETED', 'Q-2j re-run must be ALREADY_COMPLETED, got ' || c.outcome;

  -- same combination submitted under another Keyword_ID
  SELECT * INTO c FROM seo.claim_keyword('KW099', 'TEST', 'https://example.com/housekeeping/', 'https://example.com/housekeeping',
                                         'housekeeping services  pune', 'housekeeping services pune', 'exec-5', 180, false, 3);
  ASSERT c.outcome = 'SKIPPED_DUPLICATE', 'Q-2k expected SKIPPED_DUPLICATE, got ' || c.outcome;
  ASSERT (SELECT holder IS NULL FROM seo.doc_locks WHERE doc_id = 'DOC1'), 'Q-2l doc lock not released';
  RAISE NOTICE 'PASS Q-2 ledger, partial-success recovery, no double append, duplicate policy';
END $$;

-- ---------------------------------------------------------------------------
-- Q-3: technical failures -> READY (auto retry) ... -> REVIEW_REQUIRED;
--      configuration failures -> ERROR; revision limit -> REVIEW_REQUIRED
-- ---------------------------------------------------------------------------
DO $$
DECLARE c record; s text;
BEGIN
  SELECT * INTO c FROM seo.claim_keyword('KW002', 'TEST', 'https://example.com/fm', 'https://example.com/fm', 'facility management pune', 'facility management pune', 'exec-6', 180, false, 3);
  SELECT sheet_status INTO s FROM seo.mark_keyword_error('KW002', c.article_id, 'exec-6', 'GEMINI', 'API_TRANSIENT', '503', true, 2);
  ASSERT s = 'READY', 'Q-3a first transient failure should auto-retry, got ' || s;
  SELECT * INTO c FROM seo.claim_keyword('KW002', 'TEST', 'https://example.com/fm', 'https://example.com/fm', 'facility management pune', 'facility management pune', 'exec-7', 180, false, 3);
  ASSERT c.outcome = 'CLAIMED', 'Q-3b reclaim after transient error';
  SELECT sheet_status INTO s FROM seo.mark_keyword_error('KW002', c.article_id, 'exec-7', 'GEMINI', 'API_TRANSIENT', '503', true, 2);
  ASSERT s = 'REVIEW_REQUIRED', 'Q-3c max technical failures should require review, got ' || s;

  SELECT * INTO c FROM seo.claim_keyword('KW003', 'TEST', 'https://example.com/x', 'https://example.com/x', 'x', 'x', 'exec-8', 180, false, 3);
  SELECT sheet_status INTO s FROM seo.mark_keyword_error('KW003', c.article_id, 'exec-8', 'GEMINI', 'CONFIGURATION', '401', false, 3);
  ASSERT s = 'ERROR', 'Q-3d configuration error must be ERROR, got ' || s;

  SELECT * INTO c FROM seo.claim_keyword('KW004', 'TEST', 'https://example.com/y', 'https://example.com/y', 'y', 'y', 'exec-10', 180, false, 3);
  PERFORM seo.mark_review_required(c.article_id, 'KW004', 'exec-10', 'MAX_ARTICLE_ATTEMPTS reached', '["FAIL"]'::jsonb);
  ASSERT (SELECT status FROM seo.articles WHERE article_id = c.article_id) = 'REVIEW_REQUIRED', 'Q-3e';
  ASSERT (SELECT count(*) FROM seo.doc_write_ledger WHERE article_id = c.article_id) = 0, 'Q-3f review article must not be in ledger';
  RAISE NOTICE 'PASS Q-3 error classification and review state';
END $$;

-- ---------------------------------------------------------------------------
-- Q-4: interrupted execution -> lease expiry -> release_expired_claims
-- ---------------------------------------------------------------------------
DO $$
DECLARE c record; n int;
BEGIN
  SELECT * INTO c FROM seo.claim_keyword('KW005', 'TEST', 'https://example.com/z', 'https://example.com/z', 'z', 'z', 'exec-11', 180, false, 3);
  RESET ROLE;
  UPDATE seo.keyword_records SET lease_expires_at = now() - interval '1 minute' WHERE keyword_id = 'KW005';
  SET ROLE n8n_seo_app;
  SELECT count(*) INTO n FROM seo.release_expired_claims() WHERE keyword_id = 'KW005';
  ASSERT n = 1, 'Q-4a expired claim not released';
  ASSERT (SELECT claimed_by_execution IS NULL FROM seo.keyword_records WHERE keyword_id = 'KW005'), 'Q-4b owner not cleared';
  ASSERT (SELECT technical_failures FROM seo.keyword_records WHERE keyword_id = 'KW005') = 1, 'Q-4c interruption must count as a technical failure';

  -- Error Trigger path: claims of a failed execution are released immediately
  SELECT * INTO c FROM seo.claim_keyword('KW006', 'TEST', 'https://example.com/w', 'https://example.com/w', 'w', 'w', 'exec-crash', 180, false, 3);
  ASSERT c.outcome = 'CLAIMED', 'Q-4d';
  SELECT count(*) INTO n FROM seo.release_claims_of_execution('exec-crash', 'Execution failed', 3) WHERE sheet_status = 'READY';
  ASSERT n = 1, 'Q-4e failed execution claims not released';
  SELECT * INTO c FROM seo.claim_keyword('KW006', 'TEST', 'https://example.com/w', 'https://example.com/w', 'w', 'w', 'exec-next', 180, false, 3);
  ASSERT c.outcome = 'CLAIMED', 'Q-4f keyword must be claimable again after release';

  ASSERT seo.eeta_summary('{"Overall_Status":"PASS","Experience_Check":{"Status":"PASS","Explanation":"x"},"Unsupported_Claims":[]}'::jsonb)::jsonb ->> 'Overall' = 'PASS', 'Q-4g eeta summary';
  ASSERT (SELECT count(*) FROM seo.list_unsynced_approved()) = 1, 'Q-4h approved-but-unsynced article must be listed';
  PERFORM seo.set_sheet_sync(current_setting('t.article'), true, NULL);
  ASSERT (SELECT count(*) FROM seo.list_unsynced_approved()) = 0, 'Q-4i synced article must not be listed';
  RAISE NOTICE 'PASS Q-4 interrupted/failed execution recovery, sheet-sync recovery';
END $$;

RESET ROLE;
SELECT 'ALL DATABASE ASSERTIONS PASSED' AS result;
