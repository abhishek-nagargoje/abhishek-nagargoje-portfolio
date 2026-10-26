// SQL behaviour tests for the HR Remedy India SEO automation schema.
// Runs against a REAL PostgreSQL + pgvector database (no mocks).
//
// Usage (needs the "pg" npm package):
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=seo_n8n PGPASSWORD=... PGDATABASE=seo_content_test \
//   node tests/sql_behaviour_tests.js
//
// WARNING: run it against a disposable test database. It applies the schema
// and then TRUNCATES the seo_* tables.
'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require(process.env.PG_MODULE || 'pg');

const dbDir = path.join(__dirname, '..', 'database');
const schemaSql = ['01_pgvector_setup.sql', '02_brand_knowledge_schema.sql',
  '03_article_processing_history.sql', '04_idempotency_and_recovery.sql']
  .map((f) => fs.readFileSync(path.join(dbDir, f), 'utf8')).join('\n');

let passed = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) { passed++; console.log('  PASS', name); } else { failures.push(name); console.log('  FAIL', name, info === undefined ? '' : JSON.stringify(info)); }
}
async function expectError(name, fn, pattern) {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (e) { check(name, pattern.test(e.message), e.message); }
}
const client = () => new Client();
function unitVector(seed) {
  const v = Array.from({ length: 768 }, (_, i) => Math.sin(seed * 31 + i * 0.37) + (i === seed ? 3 : 0));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return '[' + v.map((x) => (x / n).toFixed(6)).join(',') + ']';
}
const ev = (db, aid, owner, event, payload) =>
  db.query('SELECT * FROM seo_job_event($1,$2,$3,$4::jsonb,$5)', [aid, owner, event, JSON.stringify(payload), 20]).then((r) => r.rows[0]);
const claim = (db, cands, owner, max = 3) =>
  db.query('SELECT * FROM seo_claim_next_job($1::jsonb,$2,$3,$4)', [JSON.stringify(cands), owner, 20, max]).then((r) => r.rows[0]);

(async () => {
  const db = client(); await db.connect();
  console.log('Schema initialisation (twice, idempotent)');
  await db.query(schemaSql); await db.query(schemaSql);
  check('schema applies twice without error', true);
  await db.query('TRUNCATE seo_brand_knowledge, seo_brand_ingestion_runs, seo_article_jobs, seo_execution_errors, seo_settings CASCADE');

  console.log('Brand knowledge ingestion');
  const rec = { knowledge_id: 'KB-001', category: 'Company Profile', content: 'HR Remedy India provides HR services.', source_url: 'https://www.hrremedyindia.com/', last_updated: '2026-10-01' };
  let r = (await db.query('SELECT * FROM seo_brand_check($1,$2::jsonb,$3,$4)', ['hr-remedy-india', JSON.stringify(rec), 'gemini-embedding-001', 768])).rows[0];
  check('new record -> INSERT', r.action === 'INSERT', r);
  r = (await db.query('SELECT * FROM seo_brand_upsert($1,$2::jsonb,$3,$4,$5,$6::jsonb)', ['hr-remedy-india', JSON.stringify(rec), unitVector(1), 'gemini-embedding-001', 768, '{}'])).rows[0];
  check('upsert inserted with 768 dims', r.action === 'INSERTED' && r.stored_dimensions === 768, r);
  r = (await db.query('SELECT * FROM seo_brand_upsert($1,$2::jsonb,$3,$4,$5,$6::jsonb)', ['hr-remedy-india', JSON.stringify(rec), unitVector(1), 'gemini-embedding-001', 768, '{}'])).rows[0];
  check('repeated upsert updates, does not duplicate', r.action === 'UPDATED', r);
  r = (await db.query('SELECT * FROM seo_brand_check($1,$2::jsonb,$3,$4)', ['hr-remedy-india', JSON.stringify(rec), 'gemini-embedding-001', 768])).rows[0];
  check('unchanged content -> UNCHANGED (no re-embedding)', r.action === 'UNCHANGED', r);
  r = (await db.query('SELECT * FROM seo_brand_check($1,$2::jsonb,$3,$4)', ['hr-remedy-india', JSON.stringify({ ...rec, content: rec.content + ' Updated.' }), 'gemini-embedding-001', 768])).rows[0];
  check('changed content -> UPDATE', r.action === 'UPDATE', r);
  const rec2 = { ...rec, knowledge_id: 'KB-002', category: 'Brand Voice', content: 'Professional, clear, helpful.' };
  await db.query('SELECT * FROM seo_brand_upsert($1,$2::jsonb,$3,$4,$5,$6::jsonb)', ['hr-remedy-india', JSON.stringify(rec2), unitVector(2), 'gemini-embedding-001', 768, '{}']);
  r = (await db.query("SELECT count(*)::int n FROM seo_brand_knowledge WHERE brand_id='hr-remedy-india'")).rows[0];
  check('one row per Knowledge_ID', r.n === 2, r);
  await expectError('wrong embedding dimension rejected', () => db.query('SELECT * FROM seo_brand_upsert($1,$2::jsonb,$3,$4,$5,$6::jsonb)', ['hr-remedy-india', JSON.stringify(rec), '[0.1,0.2]', 'gemini-embedding-001', 768, '{}']), /dimensions|expected 768/);
  r = (await db.query('SELECT * FROM seo_brand_finish_ingestion($1,$2,$3,$4::jsonb,$5::jsonb)', ['hr-remedy-india', 'exec-1', 'gemini-embedding-001', '[]', '{}'])).rows[0];
  check('empty approved list never deactivates the knowledge base', r.deactivated === 0 && r.active_records === 2, r);
  r = (await db.query('SELECT * FROM seo_brand_finish_ingestion($1,$2,$3,$4::jsonb,$5::jsonb)', ['hr-remedy-india', 'exec-2', 'gemini-embedding-001', '["KB-001"]', '{"failed":0}'])).rows[0];
  check('record no longer approved is deactivated', r.deactivated === 1 && r.active_records === 1, r);
  r = (await db.query('SELECT seo_brand_retrieve($1,$2,$3,$4,$5,$6::jsonb) AS x', ['hr-remedy-india', unitVector(1), 'gemini-embedding-001', 5, 0.3, '["Brand Voice"]'])).rows[0].x;
  check('retrieval returns only active, relevant chunks', r.active_records === 1 && r.chunks.length === 1 && r.chunks[0].knowledge_id === 'KB-001' && r.chunks[0].similarity > 0.99, r);
  r = (await db.query('SELECT seo_brand_retrieve($1,$2,$3,$4,$5,$6::jsonb) AS x', ['hr-remedy-india', unitVector(1), 'other-model', 5, 0.3, '[]'])).rows[0].x;
  check('retrieval ignores records from a different embedding model', r.active_records === 0 && r.chunks.length === 0, r);

  console.log('Claiming, leases and concurrency');
  const cand = { keyword_id: 'KW-001', target_page_url: 'https://www.hrremedyindia.com/recruitment/', primary_keyword: 'Recruitment Services  India', row_number: 2, input: { Keyword_ID: 'KW-001' } };
  // Concurrency: 5 separate connections claim the same keyword at the same instant.
  const conns = await Promise.all(Array.from({ length: 5 }, async () => { const c = client(); await c.connect(); return c; }));
  const results = await Promise.all(conns.map((c, i) => claim(c, [cand], 'exec-c' + i)));
  await Promise.all(conns.map((c) => c.end()));
  const winners = results.filter((x) => x.outcome === 'GENERATE');
  check('exactly one of five concurrent executions claims the keyword', winners.length === 1, results.map((x) => x.outcome));
  const owner = winners[0].job.lease_owner; const aid = winners[0].article_id;
  check('stable Article_ID format', /^HRR-[0-9A-F]{16}$/.test(aid), aid);
  r = (await db.query('SELECT seo_article_id($1,$2) a', ['https://www.hrremedyindia.com/recruitment#top', 'recruitment services india'])).rows[0];
  check('Article_ID is stable across URL/keyword formatting differences', r.a === aid, r);
  r = await claim(db, [cand], 'exec-other');
  check('second execution cannot claim an active lease', r.outcome === 'NONE' && r.skipped[0].reason === 'IN_PROGRESS', r);
  r = await ev(db, aid, 'exec-other', 'HEARTBEAT', {});
  check('non-owner event returns lease_ok=false', r.lease_ok === false, r);

  console.log('Attempts, editorial and plagiarism gates');
  await expectError('approval impossible before any article', () => ev(db, aid, owner, 'APPROVAL_READY', { attempt_no: 1 }), /APPROVAL_GATE_FAILED/);
  r = await ev(db, aid, owner, 'ARTICLE_GENERATED', { attempt_no: 1, kind: 'INITIAL', article: { t: 1 }, check_text: 'text one', word_count: 2 });
  check('attempt 1 recorded', r.lease_ok && r.attempts === 1 && r.status === 'ARTICLE_GENERATED', r);
  await ev(db, aid, owner, 'EDITORIAL_DONE', { attempt_no: 1, overall_status: 'PASS', passed: true, report: {} });
  await expectError('plagiarism submission of different text rejected', () => ev(db, aid, owner, 'PLAG_SUBMITTED', { attempt_no: 1, submitted_text: 'other', provider_hash: 'h1', provider_key: 'k1' }), /does not match/);
  await ev(db, aid, owner, 'PLAG_SUBMITTED', { attempt_no: 1, submitted_text: 'text one', provider_hash: 'h1', provider_key: 'k1' });
  await expectError('cannot approve without a completed plagiarism report', () => ev(db, aid, owner, 'APPROVAL_READY', { attempt_no: 1 }), /not COMPLETED/);
  await expectError('plagiarism result for a different provider job rejected', () => ev(db, aid, owner, 'PLAG_RESULT', { attempt_no: 1, provider_hash: 'zzz', status: 'COMPLETED', passed: true }), /hash does not match/);
  r = await ev(db, aid, owner, 'PLAG_RESULT', { attempt_no: 1, provider_hash: 'h1', status: 'TIMEOUT', passed: true });
  check('TIMEOUT can never be stored as passed (fail closed)', r.detail.passed === false, r);
  await ev(db, aid, owner, 'PLAG_RESULT', { attempt_no: 1, provider_hash: 'h1', status: 'COMPLETED', plag_percent: 25, passed: false });
  await expectError('failed plagiarism report blocks approval', () => ev(db, aid, owner, 'APPROVAL_READY', { attempt_no: 1 }), /did not pass/);
  await ev(db, aid, owner, 'DECISION', { attempt_no: 1, decision: 'REVISE' });
  r = (await db.query('SELECT status FROM seo_article_jobs WHERE article_id=$1', [aid])).rows[0];
  check('revise decision -> REVISION_REQUIRED', r.status === 'REVISION_REQUIRED', r);
  await ev(db, aid, owner, 'ARTICLE_GENERATED', { attempt_no: 2, kind: 'REVISION', article: { t: 2 }, check_text: 'text two' });
  await expectError('revised text cannot reuse the old plagiarism/editorial result', () => ev(db, aid, owner, 'APPROVAL_READY', { attempt_no: 2 }), /editorial evaluation did not pass.*no plagiarism report/);
  await ev(db, aid, owner, 'DECISION', { attempt_no: 2, decision: 'REVISE' });
  await ev(db, aid, owner, 'ARTICLE_GENERATED', { attempt_no: 3, kind: 'REVISION', article: { t: 3 }, check_text: 'text three' });
  await expectError('fourth attempt blocked (max 3)', () => ev(db, aid, owner, 'ARTICLE_GENERATED', { attempt_no: 4, kind: 'REVISION', article: {}, check_text: 'x' }), /ATTEMPT_LIMIT/);
  await expectError('revision after the last attempt blocked', () => ev(db, aid, owner, 'DECISION', { attempt_no: 3, decision: 'REVISE' }), /ATTEMPT_LIMIT/);
  await ev(db, aid, owner, 'EDITORIAL_DONE', { attempt_no: 3, overall_status: 'FAIL', passed: false, report: {} });
  await ev(db, aid, owner, 'PLAG_SUBMITTED', { attempt_no: 3, submitted_text: 'text three', provider_hash: 'h3', provider_key: 'k3' });
  await ev(db, aid, owner, 'PLAG_RESULT', { attempt_no: 3, provider_hash: 'h3', status: 'COMPLETED', plag_percent: 2, passed: true });
  await expectError('critical editorial failure blocks approval even with clean plagiarism', () => ev(db, aid, owner, 'APPROVAL_READY', { attempt_no: 3 }), /editorial evaluation did not pass/);
  await ev(db, aid, owner, 'EDITORIAL_DONE', { attempt_no: 3, overall_status: 'PASS', passed: true, report: {} });
  await expectError('Docs write impossible before approval gate', () => ev(db, aid, owner, 'DOC_WRITE_PENDING', { doc_id: 'D1' }), /APPROVAL_GATE_FAILED/);
  r = await ev(db, aid, owner, 'APPROVAL_READY', { attempt_no: 3, approval_payload: { a: 1 } });
  check('all checks passed -> approval ready', r.lease_ok && r.detail.marker === '[[HRR-ARTICLE:' + aid + ']]', r);

  console.log('Google Docs ledger and reconciliation');
  r = await ev(db, aid, owner, 'DOC_WRITE_PENDING', { doc_id: 'D1' });
  check('ledger PENDING before append', r.detail.already_verified === false && r.detail.write_count === 1, r);
  await expectError('APPROVED requires a verified Docs write', () => ev(db, aid, owner, 'FINALIZE', { final_status: 'APPROVED' }), /verified Google Docs write/);
  await ev(db, aid, owner, 'DOC_VERIFIED', { doc_id: 'D1', doc_url: 'https://docs.google.com/document/d/D1/edit' });
  r = await ev(db, aid, owner, 'DOC_WRITE_PENDING', { doc_id: 'D1' });
  check('same Article_ID cannot be appended twice (ledger says VERIFIED)', r.detail.already_verified === true, r);
  await ev(db, aid, owner, 'FINALIZE', { final_status: 'APPROVED' });
  // Sheets update "failed": the keyword is still READY in the sheet.
  r = await claim(db, [cand], 'exec-retry');
  check('failure after Docs insert reconciles instead of regenerating', r.outcome === 'RECONCILE', r.outcome);
  await ev(db, aid, 'exec-retry', 'SHEETS_SYNCED', { keywords: true, article_log: true });
  r = await claim(db, [cand], 'exec-again');
  check('already-approved keyword is skipped as duplicate', r.outcome === 'NONE' && r.skipped[0].sheet_action === 'SKIPPED_DUPLICATE', r);
  r = await claim(db, [{ ...cand, keyword_id: 'KW-099', row_number: 9 }], 'exec-dup');
  check('different Keyword_ID with same URL+keyword is SKIPPED_DUPLICATE', r.outcome === 'NONE' && /DUPLICATE_OF_KW-001/.test(r.skipped[0].reason), r.skipped);

  console.log('Error recovery');
  const cand2 = { keyword_id: 'KW-002', target_page_url: 'https://www.hrremedyindia.com/payroll/', primary_keyword: 'payroll outsourcing', row_number: 3, input: {} };
  r = await claim(db, [cand2], 'exec-fail-1'); const aid2 = r.article_id;
  r = (await db.query('SELECT * FROM seo_record_execution_error($1,$2,$3,$4,$5,$6,$7)', ['exec-fail-1', 'wf2', 'W2', 'trigger', 'Gemini Call 2', 'The service is receiving too many requests (429)', 3])).rows[0];
  check('transient failure -> job re-queued (sheet READY)', r.action === 'RETRY' && r.sheet_status === 'READY', r);
  r = (await db.query('SELECT * FROM seo_record_execution_error($1,$2,$3,$4,$5,$6,$7)', ['exec-fail-1', 'wf2', 'W2', 'trigger', 'Gemini Call 2', 'dup', 3])).rows[0];
  check('same failed execution is recorded only once', r.action === 'ALREADY_RECORDED', r);
  r = await claim(db, [cand2], 'exec-fail-2');
  r = (await db.query('SELECT * FROM seo_record_execution_error($1,$2,$3,$4,$5,$6,$7)', ['exec-fail-2', 'wf2', 'W2', 'trigger', 'Check Gemini', 'API key not valid. Please pass a valid API key. key=AIzaSECRETSECRET', 3])).rows[0];
  check('permanent auth failure is not retried', r.action === 'MARK_ERROR' && r.sheet_status === 'ERROR' && r.retryable === false, r);
  r = (await db.query("SELECT error_message FROM seo_execution_errors WHERE execution_id='exec-fail-2'")).rows[0];
  check('API keys are redacted before storage', !/AIzaSECRET/.test(r.error_message), r);
  r = await claim(db, [cand2], 'exec-alive');
  r = (await db.query('SELECT * FROM seo_record_execution_error($1,$2,$3,$4,$5,$6,$7)', ['exec-unrelated', 'wf2', 'W2', 'trigger', 'X', 'boom', 3])).rows[0];
  check('error of another execution never releases an active job', r.action === 'NONE', r);
  r = (await db.query('SELECT * FROM seo_recovery_sweep($1,$2,$3,$4)', ['sweeper', 10, 3, 6.5])).rows;
  check('sweep does not touch an active lease', !r.some((x) => x.article_id === aid2), r);
  await db.query("UPDATE seo_article_jobs SET lease_expires_at = now() - interval '30 minutes' WHERE article_id=$1", [aid2]);
  r = (await db.query('SELECT * FROM seo_recovery_sweep($1,$2,$3,$4)', ['sweeper', 10, 3, 6.5])).rows;
  check('sweep releases an expired lease', r.some((x) => x.article_id === aid2 && ['RETRY', 'MARK_ERROR'].includes(x.action)), r);

  console.log('Plagiarism report recovery');
  const cand3 = { keyword_id: 'KW-003', target_page_url: 'https://www.hrremedyindia.com/training/', primary_keyword: 'corporate training', row_number: 4, input: {} };
  r = await claim(db, [cand3], 'exec-p'); const aid3 = r.article_id;
  await ev(db, aid3, 'exec-p', 'ARTICLE_GENERATED', { attempt_no: 1, article: {}, check_text: 'p text' });
  await ev(db, aid3, 'exec-p', 'EDITORIAL_DONE', { attempt_no: 1, overall_status: 'PASS', passed: true, report: {} });
  await ev(db, aid3, 'exec-p', 'PLAG_SUBMITTED', { attempt_no: 1, submitted_text: 'p text', provider_hash: 'ph', provider_key: 'pk' });
  await ev(db, aid3, 'exec-p', 'PLAG_RESULT', { attempt_no: 1, provider_hash: 'ph', status: 'TIMEOUT' });
  await ev(db, aid3, 'exec-p', 'FINALIZE', { final_status: 'REVIEW_REQUIRED', last_error: 'timeout', approval_candidate: { article: {} } });
  await db.query("UPDATE seo_plagiarism_checks SET submitted_at = now() - interval '20 minutes' WHERE article_id=$1", [aid3]);
  r = (await db.query('SELECT * FROM seo_recovery_sweep($1,$2,$3,$4)', ['sweeper', 10, 3, 6.5])).rows.find((x) => x.article_id === aid3 && x.action === 'REPOLL_PLAGIARISM');
  check('timed-out report is scheduled for re-polling', !!r, r);
  const pl = r.plagiarism;
  r = (await db.query('SELECT * FROM seo_recovery_plagiarism_result($1,$2,$3,$4::jsonb)', [aid3, pl.check_id, 'ph', JSON.stringify({ status: 'COMPLETED', plag_percent: 3, passed: true })])).rows[0];
  check('recovered passing report re-queues the job for publishing (not auto-approved)', r.action === 'RESUME' && r.sheet_status === 'READY' && r.job.status === 'READY', r.action);
  r = await claim(db, [cand3], 'exec-resume');
  check('re-queued job resumes at the Google Docs stage', r.outcome === 'RESUME_DOC', r.outcome);

  await db.end();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('Failed:', failures); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
