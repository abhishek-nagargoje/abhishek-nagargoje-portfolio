#!/usr/bin/env node
// End-to-end execution tests: real n8n server + real PostgreSQL/pgvector +
// mocked external HTTP services (tests/e2e/mock_services.js).
//
// Requirements (see documentation/TESTING_AND_TROUBLESHOOTING.md):
//   N8N_BIN       path to the n8n CLI (n8n 2.x, Node >= 24 on PATH)
//   PSQL          psql command able to create/drop the test DB (superuser)
//   /etc/hosts    kargar-test.example and refs.example -> 127.0.0.1
// Usage: N8N_BIN=/path/to/n8n node tests/e2e/run_e2e.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn, spawnSync } = require('child_process');
const { createState, createMockServer, SCENARIOS } = require('./mock_services');
const { transformWorkflow } = require('./transform');

const ROOT = path.resolve(__dirname, '..', '..');
const N8N_BIN = process.env.N8N_BIN || 'n8n';
const PSQL = process.env.PSQL || 'psql';
const DB = process.env.E2E_DB || 'seo_e2e';
const MOCK_PORT = 8787;
const N8N_PORT = Number(process.env.E2E_N8N_PORT || 5690); // 5679 is n8n's internal task-broker port
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SITE = `http://kargar-test.example:${MOCK_PORT}`;
const USER_FOLDER = process.env.E2E_N8N_FOLDER || path.join(os.tmpdir(), 'n8n-e2e-' + process.pid);
const RESULTS_FILE = path.join(ROOT, 'tests', 'results', 'e2e_results.json');

const results = [];
const state = createState();
const sql = (q) => execSync(`${PSQL} -X -q -t -A -v ON_ERROR_STOP=1 -d ${DB}`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function n8nEnv() {
  const env = { ...process.env, N8N_USER_FOLDER: USER_FOLDER, N8N_PORT: String(N8N_PORT), N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', GENERIC_TIMEZONE: 'Asia/Kolkata', N8N_SECURE_COOKIE: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false', EXECUTIONS_TIMEOUT: '-1', N8N_LISTEN_ADDRESS: '127.0.0.1' };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete env[k];
  return env;
}
function n8nCli(args) {
  const r = spawnSync(N8N_BIN, args, { env: n8nEnv(), encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) throw new Error(`n8n ${args.join(' ')} failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function record(id, title, ok, evidence) {
  results.push({ id, title, status: ok ? 'PASSED' : 'FAILED', evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${title}${ok ? '' : '\n      ' + JSON.stringify(evidence).slice(0, 1500)}`);
}

async function webhook(pathName, timeoutMs = 600000) {
  // /healthz turns green before n8n finishes activating workflows; a 404
  // "not registered" response never starts an execution, so it is safe to retry.
  for (let i = 0; i < 60; i++) {
    const r = await webhookOnce(pathName, timeoutMs);
    if (!(r.status === 404 && /not registered/.test(JSON.stringify(r.body)))) return r;
    await sleep(1000);
  }
  return webhookOnce(pathName, timeoutMs);
}

async function webhookOnce(pathName, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${N8N_PORT}/webhook/${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: ctl.signal });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch (e) { body = text; }
    return { status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

const markerCount = (articleId) => (state.doc.body.match(new RegExp(`SEO-ARTICLE-MARKER: ${articleId}(?![A-Z0-9])`, 'g')) || []).length;
const kwRow = (id) => state.sheets.Keywords.find((r) => r.Keyword_ID === id) || {};
const logRow = (articleId) => state.sheets.Article_Log.find((r) => r.Article_ID === articleId) || null;
const dbKw = (id) => {
  const out = sql(`SELECT row_to_json(k) FROM (SELECT k.status, k.current_article_id, k.last_error_class, k.last_error, k.technical_failures, a.status AS article_status, a.attempt_count, a.sheet_synced, l.state AS ledger_state FROM seo.keyword_records k LEFT JOIN seo.articles a ON a.article_id = k.current_article_id LEFT JOIN seo.doc_write_ledger l ON l.article_id = k.current_article_id WHERE k.keyword_id = '${id}') k;`);
  return out ? JSON.parse(out) : null;
};
const calls = (pred) => state.calls.filter(pred);
const jsonAgg = (q) => { const out = sql(q); return out ? JSON.parse(out) : []; };
const kwRowInput = (id, url, kw, extra) => ({ Keyword_ID: id, Target_Page_URL: url, Primary_Keyword: kw, Supporting_Keywords: 'office cleaning, commercial housekeeping',
  Search_Intent: 'Commercial', Target_Audience: 'Office managers', Target_Location: 'Pune', Language: 'English', Priority: 'High', Status: 'READY',
  Processing_Started_At: '', Processed_At: '', Last_Error: '', ...(extra || {}) });

async function main() {
  // ------------------------------------------------------------ database
  execSync(`${PSQL} -X -q -d postgres -c "DROP DATABASE IF EXISTS ${DB}" -c "CREATE DATABASE ${DB}"`);
  for (const f of ['01_pgvector_setup.sql', '02_brand_knowledge_schema.sql', '03_article_processing_history.sql', '04_idempotency_and_recovery.sql']) {
    execSync(`${PSQL} -X -q -v ON_ERROR_STOP=1 -d ${DB} -f ${path.join(ROOT, 'database', f)}`, { stdio: 'pipe' });
  }
  const dbPassword = crypto.randomBytes(18).toString('base64url'); // throwaway, never written to the repo
  sql(`ALTER ROLE n8n_seo_app PASSWORD '${dbPassword}';`);

  // ------------------------------------------------------------ mocks
  state.expected.geminiKey = 'test-' + crypto.randomBytes(8).toString('hex');
  state.expected.plagiarismToken = 'test-' + crypto.randomBytes(8).toString('hex');
  const server = createMockServer(state);
  await new Promise((r) => server.listen(MOCK_PORT, '0.0.0.0', r));

  // ------------------------------------------------------------ n8n setup
  fs.rmSync(USER_FOLDER, { recursive: true, force: true });
  fs.mkdirSync(USER_FOLDER, { recursive: true });
  const credIds = { postgres: 'e2ePostgresCred01', httpHeaderAuth: 'e2eGeminiCred0001', httpQueryAuth: 'e2eDupliCred00001' };
  const credFile = path.join(USER_FOLDER, 'creds.json');
  fs.writeFileSync(credFile, JSON.stringify([
    { id: credIds.postgres, name: 'E2E Postgres', type: 'postgres', data: { host: '127.0.0.1', port: 5432, database: DB, user: 'n8n_seo_app', password: dbPassword, ssl: 'disable', allowUnauthorizedCerts: false } },
    { id: credIds.httpHeaderAuth, name: 'E2E Gemini Key', type: 'httpHeaderAuth', data: { name: 'x-goog-api-key', value: state.expected.geminiKey } },
    { id: credIds.httpQueryAuth, name: 'E2E DupliChecker Token', type: 'httpQueryAuth', data: { name: 'token', value: state.expected.plagiarismToken } },
  ]));
  n8nCli(['import:credentials', `--input=${credFile}`]);
  fs.rmSync(credFile);
  const credentials = { postgres: { id: credIds.postgres, name: 'E2E Postgres' }, httpHeaderAuth: { id: credIds.httpHeaderAuth, name: 'E2E Gemini Key' }, httpQueryAuth: { id: credIds.httpQueryAuth, name: 'E2E DupliChecker Token' } };
  const cfg02 = { SPREADSHEET_ID: 'TEST-SPREADSHEET', MASTER_DOC_ID: 'TEST-DOC', DOCS_API_BASE: `${MOCK}/docs/v1`, GEMINI_API_BASE: `${MOCK}/gemini/v1beta`,
    PLAGIARISM_CHECK_URL: `${MOCK}/dupli/api/checkplag`, PLAGIARISM_INFO_URL: `${MOCK}/dupli/api/info`, ARTICLE_MIN_WORDS: 300, DOC_LOCK_WAIT_SECONDS: 2,
    PLAGIARISM_POLL_URL_TEMPLATE: `${MOCK}/dupli/api/query-footprint/{query_footprint}/{key}`, PLAGIARISM_POLL_INTERVAL_SECONDS: 1, PLAGIARISM_MAX_POLLS: 3 };
  const RECOVERY_ID = 'e2eRecovery00001';
  const specs = [
    ['01_Brand_RAG_Ingestion.json', { 'Ingestion Configuration': { SPREADSHEET_ID: 'TEST-SPREADSHEET', GEMINI_API_BASE: `${MOCK}/gemini/v1beta` } }, { path: 'e2e-ingest', target: 'Ingestion Configuration' }, 'e2eIngestion0001', { errorWorkflow: RECOVERY_ID }],
    ['02_SEO_Article_Automation.json', { 'Workflow Configuration': cfg02 }, { path: 'e2e-articles', target: 'Workflow Configuration' }, 'e2eArticles00001', { errorWorkflow: RECOVERY_ID }],
    ['03_Error_Recovery.json', { 'Recovery Configuration': { SPREADSHEET_ID: 'TEST-SPREADSHEET', MASTER_DOC_ID: 'TEST-DOC', DOCS_API_BASE: `${MOCK}/docs/v1`, RECONCILE_MIN_AGE_MINUTES: 0 },
      'Recovery Configuration (Error Path)': { SPREADSHEET_ID: 'TEST-SPREADSHEET', MASTER_DOC_ID: 'TEST-DOC', DOCS_API_BASE: `${MOCK}/docs/v1` } }, { path: 'e2e-recovery', target: 'Recovery Configuration' }, RECOVERY_ID, {}],
  ];
  for (const [file, config, webhookSpec, id, settings] of specs) {
    const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
    const t = transformWorkflow(wf, { mockBase: MOCK, config, credentials, webhook: webhookSpec, id, settings });
    const out = path.join(USER_FOLDER, file);
    fs.writeFileSync(out, JSON.stringify(t));
    n8nCli(['import:workflow', `--input=${out}`]);
  }
  const ids = Object.fromEntries(n8nCli(['list:workflow']).split('\n').filter((l) => /^\w+\|/.test(l)).map((l) => l.split('|').reverse()));
  if (Object.keys(ids).length !== 3) throw new Error(`expected 3 imported workflows, got ${JSON.stringify(ids)}`);
  for (const id of Object.values(ids)) n8nCli(['publish:workflow', `--id=${id}`]);
  const active = n8nCli(['list:workflow', '--active=true']).split('\n').filter((l) => /^\w+\|/.test(l));
  if (active.length !== 3) throw new Error(`expected 3 active workflows after publish, got ${active.length}`);

  const proc = spawn(N8N_BIN, ['start'], { env: { ...n8nEnv(), N8N_LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  proc.stdout.on('data', (d) => { serverLog += d; });
  proc.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${N8N_PORT}/healthz`);
      if (r.ok) break;
    } catch (e) { /* not up yet */ }
    await sleep(1000);
  }
  await sleep(4000);

  try {
    await scenarios();
  } catch (e) {
    record('HARNESS', 'harness error', false, { error: e.stack, serverLog: serverLog.slice(-4000) });
  } finally {
    proc.kill('SIGTERM');
    server.close();
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    const summary = { generated_at: new Date().toISOString(), n8n: n8nCli(['--version']).trim(), passed: results.filter((r) => r.status === 'PASSED').length, failed: results.filter((r) => r.status === 'FAILED').length, results };
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2));
    console.log(`\n${summary.passed} passed, ${summary.failed} failed -> ${path.relative(ROOT, RESULTS_FILE)}`);
    process.exitCode = summary.failed ? 1 : 0;
  }
}

async function runArticles(rows) {
  state.sheets.Keywords = rows;
  const before = state.calls.length;
  const r = await webhook('e2e-articles');
  return { response: r, newCalls: state.calls.slice(before) };
}

async function scenarios() {
  // ===================================================== Brand RAG ingestion
  state.sheets.Brand_Knowledge = [
    { Knowledge_ID: 'KB-001', Category: 'COMPANY_PROFILE', Content: 'KARGAR Facility Management provides housekeeping, security and facility maintenance services in Pune.', Source_URL: `${SITE}/about`, Approved: 'TRUE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: 'KB-002', Category: 'SERVICES', Content: 'Housekeeping services include office cleaning, washroom hygiene and pantry upkeep, delivered by trained housekeeping staff with on-site supervisors.', Source_URL: `${SITE}/housekeeping`, Approved: 'TRUE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: 'KB-003', Category: 'BRAND_VOICE', Content: 'Plain, practical and factual tone. No superlatives and no unverifiable promises.', Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: 'KB-004', Category: 'INTERNAL_LINKS', Content: `Facility management service page: ${SITE}/services/facility-management`, Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: 'KB-005', Category: 'SERVICE_AREAS', Content: 'Services are currently provided for offices and commercial facilities in Pune.', Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: 'KB-006', Category: 'TECHNICAL_EXPERTISE', Content: 'Electrical and plumbing maintenance is scheduled through preventive maintenance checklists agreed with the client.', Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: 'KB-007', Category: 'APPROVED_CLAIMS', Content: 'Draft claim awaiting approval: trained and supervised staff.', Source_URL: '', Approved: 'FALSE', Last_Updated: '2026-10-01' },
    { Knowledge_ID: '', Category: 'SERVICES', Content: 'Row without an identifier must be rejected.', Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
  ];
  let before = state.calls.length;
  let r = await webhook('e2e-ingest');
  let embeds = state.calls.slice(before).filter((c) => c.op === 'embed');
  const chunks = Number(sql("SELECT count(*) FROM seo.brand_knowledge_chunks WHERE brand_id='KARGAR' AND is_active"));
  const ingErrors = Number(sql('SELECT count(*) FROM seo.brand_ingestion_errors'));
  record('I1', 'Ingestion: approved rows embedded (RETRIEVAL_DOCUMENT, 768 dims) and stored; unapproved skipped; invalid row logged', r.status === 200 && chunks === 6 && embeds.length === 6 && embeds.every((c) => c.taskType === 'RETRIEVAL_DOCUMENT' && c.dims === 768) && ingErrors === 1,
    { http: r.status, response: r.body, chunks, embedCalls: embeds.length, ingErrors });

  before = state.calls.length;
  r = await webhook('e2e-ingest');
  embeds = state.calls.slice(before).filter((c) => c.op === 'embed');
  const run2 = JSON.parse(sql('SELECT row_to_json(r) FROM (SELECT * FROM seo.brand_ingestion_runs ORDER BY run_id DESC LIMIT 1) r'));
  record('I2', 'Ingestion idempotency: re-run re-embeds nothing and inserts no duplicates', embeds.length === 0 && run2.chunks_unchanged === 6 && run2.chunks_inserted === 0 && Number(sql('SELECT count(*) FROM seo.brand_knowledge_chunks')) === 6,
    { embedCalls: embeds.length, run: run2 });

  state.sheets.Brand_Knowledge[2].Content = 'Plain, practical and factual tone. No superlatives, no unverifiable promises, short paragraphs.';
  state.sheets.Brand_Knowledge[5].Approved = 'FALSE';
  before = state.calls.length;
  r = await webhook('e2e-ingest');
  embeds = state.calls.slice(before).filter((c) => c.op === 'embed');
  const run3 = JSON.parse(sql('SELECT row_to_json(r) FROM (SELECT * FROM seo.brand_ingestion_runs ORDER BY run_id DESC LIMIT 1) r'));
  const kb006 = sql("SELECT is_active::text || ':' || coalesce(deactivated_reason,'') FROM seo.brand_knowledge_chunks WHERE knowledge_id='KB-006'");
  record('I3', 'Ingestion: changed row re-embedded/updated; newly unapproved row soft-deactivated (not deleted)', embeds.length === 1 && run3.chunks_updated === 1 && run3.chunks_deactivated === 1 && kb006 === 'false:SOURCE_NOT_APPROVED',
    { embedCalls: embeds.length, run: run3, kb006 });
  state.sheets.Brand_Knowledge[5].Approved = 'TRUE';
  await webhook('e2e-ingest');

  // ===================================================== Test 1: single input
  let x = await runArticles([kwRowInput('KW001', `${SITE}/housekeeping`, SCENARIOS.HAPPY[0])]);
  let d = dbKw('KW001');
  const a1 = d && d.current_article_id;
  record('T1', 'Single input: full pipeline -> APPROVED, appended once, Sheets + Article_Log + DB consistent',
    x.response.status === 200 && kwRow('KW001').Status === 'APPROVED' && d.status === 'APPROVED' && d.ledger_state === 'VERIFIED' && d.sheet_synced === true &&
    markerCount(a1) === 1 && logRow(a1) && logRow(a1).Status === 'APPROVED' && logRow(a1).Keyword_ID === 'KW001' &&
    x.newCalls.filter((c) => c.op === 'prompt_creator').length === 1 && x.newCalls.filter((c) => c.op === 'writer').length === 1 &&
    x.newCalls.filter((c) => c.op === 'evaluator').length === 1 && x.newCalls.filter((c) => c.op === 'check').length >= 1 && x.newCalls.filter((c) => c.op === 'batchUpdate').length === 1,
    { response: x.response.body, db: d, sheet: kwRow('KW001'), log: logRow(a1), markers: markerCount(a1), ops: x.newCalls.map((c) => c.op) });

  // ===================================================== Test 3: duplicate input
  const docBefore = state.doc.body.length;
  x = await runArticles([{ ...kwRow('KW001'), Status: 'READY' }, kwRowInput('KW001B', `${SITE}/housekeeping/`, 'Housekeeping  Services Pune')]);
  record('T3', 'Duplicate input: completed record (stays APPROVED, note added) and same keyword+URL under a new ID (SKIPPED_DUPLICATE) are skipped; no new generation or Docs write',
    kwRow('KW001').Status === 'APPROVED' && /already approved/.test(kwRow('KW001').Last_Error) && kwRow('KW001B').Status === 'SKIPPED_DUPLICATE' && markerCount(a1) === 1 && state.doc.body.length === docBefore &&
    x.newCalls.filter((c) => c.service === 'gemini' && c.op !== 'embed').length === 0,
    { kw001: kwRow('KW001'), kw001b: kwRow('KW001B'), ops: x.newCalls.map((c) => c.op) });

  // ===================================================== Test 2: five inputs
  const five = SCENARIOS.HAPPY.slice(1).map((kw, i) => kwRowInput(`KW10${i + 1}`, `${SITE}/services/${kw.split(' ')[0]}`, kw));
  five.push(kwRowInput('KW105', `${SITE}/services/housekeeping-commercial`, 'commercial housekeeping services pune'));
  x = await runArticles(five);
  const fiveOk = five.every((row) => {
    const db = dbKw(row.Keyword_ID);
    const log = db && logRow(db.current_article_id);
    return db && db.status === 'APPROVED' && markerCount(db.current_article_id) === 1 && log && log.Keyword_ID === row.Keyword_ID &&
      log.Primary_Keyword === row.Primary_Keyword && log.Target_Page_URL.startsWith(row.Target_Page_URL);
  });
  record('T2', 'Five inputs: five independent articles, each appended once and correctly associated with its keyword/URL', fiveOk,
    { rows: five.map((row) => ({ id: row.Keyword_ID, sheet: kwRow(row.Keyword_ID).Status, db: dbKw(row.Keyword_ID) })) });

  // ===================================================== Test 4: page retrieval failure
  x = await runArticles([kwRowInput('KW201', `${SITE}/missing`, 'housekeeping contract pune'), kwRowInput('KW202', `${SITE}/js-app`, 'housekeeping agency pune')]);
  const d201 = dbKw('KW201');
  const d202 = dbKw('KW202');
  record('T4', 'Target-page retrieval failure (404 and JS-only page): REVIEW_REQUIRED with clear reason, no analysis or article generated',
    d201.status === 'REVIEW_REQUIRED' && /PAGE_HTTP_404/.test(d201.last_error) && d202.status === 'REVIEW_REQUIRED' && /PAGE_REQUIRES_JS_RENDERING/.test(d202.last_error) &&
    x.newCalls.filter((c) => c.op === 'prompt_creator' || c.op === 'writer').length === 0,
    { d201, d202, sheet: [kwRow('KW201'), kwRow('KW202')] });

  // ===================================================== Test 5: missing RAG information
  x = await runArticles([kwRowInput('KW301', `${SITE}/housekeeping`, 'ZZTOPIC quantum computing pune')]);
  d = dbKw('KW301');
  record('T5', 'Missing brand knowledge: REVIEW_REQUIRED (INSUFFICIENT_BRAND_CONTEXT), Gemini never asked to write',
    d.status === 'REVIEW_REQUIRED' && /INSUFFICIENT_BRAND_CONTEXT/.test(d.last_error) && x.newCalls.filter((c) => c.op === 'prompt_creator' || c.op === 'writer').length === 0,
    { db: d, ops: x.newCalls.map((c) => c.op) });

  // ===================================================== keyword/page mismatch
  x = await runArticles([kwRowInput('KW302', `${SITE}/housekeeping`, SCENARIOS.MISMATCH)]);
  d = dbKw('KW302');
  record('T4b', 'Keyword/page mismatch flagged for review instead of generating irrelevant content',
    d.status === 'REVIEW_REQUIRED' && /KEYWORD_PAGE_MISMATCH/.test(d.last_error) && x.newCalls.filter((c) => c.op === 'writer').length === 0, { db: d });

  // ===================================================== Test 6: editorial failure -> revision -> pass
  x = await runArticles([kwRowInput('KW401', `${SITE}/housekeeping`, SCENARIOS.EDIT_ONCE)]);
  d = dbKw('KW401');
  const rev401 = x.newCalls.filter((c) => c.op === 'reviser');
  const attempts401 = jsonAgg(`SELECT json_agg(json_build_object('n', attempt_no, 'editorial', editorial_status, 'plag', plagiarism_status, 'outcome', outcome) ORDER BY attempt_no) FROM seo.article_attempts WHERE article_id = '${d.current_article_id}'`);
  record('T6', 'Editorial failure: evaluator FAILs unsupported claims, correction report sent to reviser, revised article re-evaluated and approved',
    d.status === 'APPROVED' && rev401.length === 1 && /award|ISO|UNSUPPORTED/i.test(rev401[0].failed || '') && attempts401.length === 2 &&
    attempts401[0].editorial === 'FAIL' && attempts401[1].editorial === 'PASS' && attempts401[1].plag === 'PASS' && !/award-winning/.test(state.doc.body),
    { db: d, attempts: attempts401, reviserSaw: (rev401[0] || {}).failed });

  // ===================================================== Test 13: unsupported brand claim caught deterministically
  x = await runArticles([kwRowInput('KW402', `${SITE}/housekeeping`, SCENARIOS.DET_ONLY)]);
  d = dbKw('KW402');
  const att402 = jsonAgg(`SELECT json_agg(json_build_object('n', attempt_no, 'editorial', editorial_status, 'failed', failed_conditions) ORDER BY attempt_no) FROM seo.article_attempts WHERE article_id = '${d.current_article_id}'`);
  record('T13', 'Unsupported brand claim ("500+ clients") rejected even though the model evaluator said PASS; revised before approval',
    d.status === 'APPROVED' && att402.length === 2 && att402[0].editorial !== 'PASS' && JSON.stringify(att402[0].failed).includes('UNSUPPORTED_BRAND_STATISTIC') && !/500\+ clients/.test(state.doc.body),
    { db: d, attempts: att402 });

  // ===================================================== Test 7: plagiarism failure -> revision -> new scan -> pass
  x = await runArticles([kwRowInput('KW501', `${SITE}/housekeeping`, SCENARIOS.PLAG_ONCE)]);
  d = dbKw('KW501');
  const scans = x.newCalls.filter((c) => c.op === 'check');
  const att501 = jsonAgg(`SELECT json_agg(json_build_object('n', attempt_no, 'editorial', editorial_status, 'plag', plagiarism_status, 'pct', plagiarism_percent, 'sha', left(content_sha256, 12), 'scanned', left(plagiarism_content_sha256, 12)) ORDER BY attempt_no) FROM seo.article_attempts WHERE article_id = '${d.current_article_id}'`);
  record('T7', 'Plagiarism failure: revision triggered, revised text re-evaluated AND re-scanned (new report for new text), then approved',
    d.status === 'APPROVED' && att501.length === 2 && att501[0].plag === 'FAIL' && Number(att501[0].pct) > 10 && att501[1].plag === 'PASS' &&
    att501[0].sha !== att501[1].sha && att501.every((a) => a.sha === a.scanned) && att501[1].editorial === 'PASS' && new Set(scans.map((s) => s.sha)).size === scans.length && !/PLAGSENTINEL/.test(state.doc.body),
    { db: d, attempts: att501, scans });

  // ===================================================== Test 8: plagiarism API failure
  x = await runArticles([kwRowInput('KW601', `${SITE}/housekeeping`, SCENARIOS.PLAG_401)]);
  d = dbKw('KW601');
  record('T8', 'Plagiarism API auth failure: fail closed - not approved, no Docs write, CONFIGURATION error recorded',
    d.status === 'ERROR' && d.last_error_class === 'CONFIGURATION' && kwRow('KW601').Status === 'ERROR' && x.newCalls.filter((c) => c.op === 'batchUpdate').length === 0 && markerCount(d.current_article_id) === 0,
    { db: d, sheet: kwRow('KW601') });

  // ===================================================== Test 9: repeated failure -> attempt limit
  x = await runArticles([kwRowInput('KW701', `${SITE}/housekeeping`, SCENARIOS.ALWAYS_FAIL)]);
  d = dbKw('KW701');
  const ev = x.newCalls.filter((c) => c.op === 'evaluator' && !c.isCorrection).length;
  const rv = x.newCalls.filter((c) => c.op === 'reviser').length;
  record('T9', 'Repeated failure: stops at MAX_ARTICLE_ATTEMPTS=3 (3 evaluations, 2 revisions) and marks REVIEW_REQUIRED; latest article and reports kept',
    d.status === 'REVIEW_REQUIRED' && d.attempt_count === 3 && ev === 3 && rv === 2 && kwRow('KW701').Status === 'REVIEW_REQUIRED' &&
    logRow(d.current_article_id) && logRow(d.current_article_id).Status === 'REVIEW_REQUIRED' && markerCount(d.current_article_id) === 0 &&
    Number(sql(`SELECT count(*) FROM seo.article_attempts WHERE article_id='${d.current_article_id}' AND editorial_report IS NOT NULL`)) === 3,
    { db: d, evaluations: ev, revisions: rv, log: logRow(d.current_article_id) });

  // ===================================================== Test 10: Docs write failure
  state.faults.docsBatch = '403';
  x = await runArticles([kwRowInput('KW801', `${SITE}/housekeeping`, 'washroom hygiene services pune')]);
  d = dbKw('KW801');
  const t10a = d.status !== 'APPROVED' && d.ledger_state === 'FAILED' && markerCount(d.current_article_id) === 0 && kwRow('KW801').Status !== 'APPROVED';
  const t10evidence = { afterFailure: { db: d, sheet: kwRow('KW801') } };
  x = await runArticles([{ ...kwRow('KW801'), Status: 'READY' }]);
  d = dbKw('KW801');
  t10evidence.afterRetry = { db: d, sheet: kwRow('KW801'), markers: markerCount(d.current_article_id) };
  record('T10', 'Docs write failure (403): not marked APPROVED, ledger FAILED, nothing appended; a later retry succeeds exactly once',
    t10a && d.status === 'APPROVED' && markerCount(d.current_article_id) === 1, t10evidence);

  // ===================================================== Test 11a: uncertain Docs outcome (applied, then 500)
  state.faults.docsBatch = '500_after_apply';
  x = await runArticles([kwRowInput('KW901', `${SITE}/housekeeping`, 'pantry upkeep services pune')]);
  d = dbKw('KW901');
  record('T11a', 'Uncertain Docs write (update applied but API returned 500): verification finds the marker, approves without a second append',
    d.status === 'APPROVED' && d.ledger_state === 'VERIFIED' && markerCount(d.current_article_id) === 1 && x.newCalls.filter((c) => c.op === 'batchUpdate').length === 1,
    { db: d, ops: x.newCalls.filter((c) => c.service === 'docs').map((c) => c.op) });

  // ===================================================== Test 11b: Docs OK, Sheets status update fails -> recovery
  state.faults.sheets = { tab: 'Keywords', status: 'APPROVED', remaining: 3 };
  x = await runArticles([kwRowInput('KW902', `${SITE}/housekeeping`, 'reception area cleaning pune')]);
  d = dbKw('KW902');
  const t11bBefore = { db: d, sheet: { ...kwRow('KW902') }, markers: markerCount(d.current_article_id) };
  state.faults.sheets = null;
  const docLen = state.doc.body.length;
  before = state.calls.length;
  r = await webhook('e2e-recovery');
  const d2 = dbKw('KW902');
  record('T11b', 'Partial success (Docs written, Sheets update failed): article APPROVED in DB with sheet_synced=false; Error Recovery syncs Sheets without re-appending',
    t11bBefore.db.status === 'APPROVED' && t11bBefore.db.sheet_synced === false && t11bBefore.markers === 1 && kwRow('KW902').Status === 'APPROVED' &&
    d2.sheet_synced === true && logRow(d2.current_article_id) && state.doc.body.length === docLen && markerCount(d2.current_article_id) === 1 &&
    state.calls.slice(before).filter((c) => c.op === 'batchUpdate').length === 0,
    { before: t11bBefore, after: { db: d2, sheet: kwRow('KW902'), log: logRow(d2.current_article_id) }, recovery: r });

  // ===================================================== Test 11c: crash between Docs write and DB update
  x = await runArticles([kwRowInput('KW903', `${SITE}/housekeeping`, 'meeting room cleaning pune')]);
  d = dbKw('KW903');
  const art903 = d.current_article_id;
  sql(`UPDATE seo.articles SET status='IN_PROGRESS', sheet_synced=false, approved_at=NULL WHERE article_id='${art903}';
       UPDATE seo.doc_write_ledger SET state='PENDING', verified_at=NULL, updated_at=now()-interval '1 hour' WHERE article_id='${art903}';
       UPDATE seo.keyword_records SET status='PLAGIARISM_CHECK', claimed_by_execution='crashed-exec', lease_expires_at=now()+interval '1 hour' WHERE keyword_id='KW903';`);
  state.sheets.Keywords.find((row) => row.Keyword_ID === 'KW903').Status = 'PLAGIARISM_CHECK';
  const lenBefore = state.doc.body.length;
  r = await webhook('e2e-recovery');
  d = dbKw('KW903');
  record('T11c', 'Crash after Docs write (ledger PENDING): recovery finds the marker, marks VERIFIED, finalizes and syncs Sheets - no duplicate append',
    d.status === 'APPROVED' && d.ledger_state === 'VERIFIED' && d.sheet_synced === true && kwRow('KW903').Status === 'APPROVED' && markerCount(art903) === 1 && state.doc.body.length === lenBefore,
    { db: d, sheet: kwRow('KW903'), recovery: r });

  // ===================================================== Test 12: concurrency (two simultaneous runs)
  state.sheets.Keywords = [kwRowInput('KW950', `${SITE}/housekeeping`, 'lobby cleaning services pune')];
  before = state.calls.length;
  const [ra, rb] = await Promise.all([webhook('e2e-articles'), webhook('e2e-articles')]);
  d = dbKw('KW950');
  const writers = state.calls.slice(before).filter((c) => c.op === 'writer' && c.kw === 'lobby cleaning services pune').length;
  record('T12', 'Concurrency: two simultaneous executions see the same READY row; only one claims it, one article, one Docs append',
    d.status === 'APPROVED' && markerCount(d.current_article_id) === 1 && writers === 1 && Number(sql("SELECT count(*) FROM seo.articles WHERE keyword_id='KW950'")) === 1,
    { db: d, writerCalls: writers, responses: [ra.body, rb.body] });

  // ===================================================== input validation
  x = await runArticles([
    kwRowInput('KW990', 'ftp://example.com/x', 'housekeeping pune'),
    kwRowInput('KW991', `${SITE}/housekeeping`, ''),
    kwRowInput('KW992', `${SITE}/a`, 'gardening services pune'), kwRowInput('KW992', `${SITE}/b`, 'landscaping services pune'),
    kwRowInput('KW993', `${SITE}/housekeeping`, 'not ready keyword', { Status: 'DRAFT' }),
  ]);
  record('V1', 'Input validation: bad scheme, empty keyword and duplicate Keyword_IDs are rejected with reasons (not dropped); non-READY rows untouched',
    kwRow('KW990').Status === 'ERROR' && /scheme/.test(kwRow('KW990').Last_Error) && kwRow('KW991').Status === 'ERROR' && /Primary_Keyword/.test(kwRow('KW991').Last_Error) &&
    state.sheets.Keywords.filter((row) => row.Keyword_ID === 'KW992').every((row) => row.Status === 'ERROR' && /unique/.test(row.Last_Error)) && kwRow('KW993').Status === 'DRAFT' &&
    x.newCalls.filter((c) => c.service === 'gemini' && c.op !== 'embed').length === 0,
    { rows: state.sheets.Keywords });

  // ===================================================== Test 14: mixed batch of five
  const mixed = [
    kwRowInput('KW1401', `${SITE}/housekeeping`, 'restroom maintenance services pune'),
    kwRowInput('KW1402', `${SITE}/housekeeping`, 'janitorial services pune'),
    kwRowInput('KW1403', `${SITE}/services/deep`, SCENARIOS.ALWAYS_FAIL),
    kwRowInput('KW1404', `${SITE}/missing`, 'floor care services pune'),
    kwRowInput('KW1405', `${SITE}/services/pest`, SCENARIOS.PLAG_401),
  ];
  x = await runArticles(mixed);
  const st = Object.fromEntries(mixed.map((row) => [row.Keyword_ID, dbKw(row.Keyword_ID)]));
  const firstPass = st.KW1401.status === 'APPROVED' && st.KW1402.status === 'APPROVED' && st.KW1403.status === 'REVIEW_REQUIRED' &&
    st.KW1404.status === 'REVIEW_REQUIRED' && st.KW1405.status === 'ERROR' &&
    markerCount(st.KW1401.current_article_id) === 1 && markerCount(st.KW1402.current_article_id) === 1 &&
    [st.KW1403, st.KW1404, st.KW1405].every((s) => markerCount(s.current_article_id) === 0);
  // human re-queues every row (including approved ones) -> approved ones must not be regenerated or re-appended
  for (const row of state.sheets.Keywords) row.Status = 'READY';
  const len14 = state.doc.body.length;
  before = state.calls.length;
  await webhook('e2e-articles');
  const after = Object.fromEntries(mixed.map((row) => [row.Keyword_ID, dbKw(row.Keyword_ID)]));
  const writes2 = state.calls.slice(before).filter((c) => c.op === 'writer' && ['restroom maintenance services pune', 'janitorial services pune'].includes(c.kw)).length;
  record('T14', 'Five-article batch with mixed outcomes: passing articles stored exactly once, failures kept out of the doc and recoverable on re-queue',
    firstPass && writes2 === 0 && markerCount(st.KW1401.current_article_id) === 1 && markerCount(st.KW1402.current_article_id) === 1 &&
    kwRow('KW1401').Status === 'APPROVED' && after.KW1403.current_article_id !== st.KW1403.current_article_id && after.KW1403.status === 'REVIEW_REQUIRED' &&
    after.KW1405.status === 'ERROR' && state.doc.body.length === len14,
    { firstRun: st, secondRun: after, regeneratedApproved: writes2 });

  // ===================================================== asynchronous plagiarism report (bounded polling)
  x = await runArticles([kwRowInput('KW1501', `${SITE}/housekeeping`, SCENARIOS.PLAG_ASYNC)]);
  d = dbKw('KW1501');
  let polls = x.newCalls.filter((c) => c.op === 'poll');
  record('T7b', 'Asynchronous plagiarism report: job id captured, polled with Wait (bounded), completed report evaluated, then approved',
    d.status === 'APPROVED' && polls.length === 2 && markerCount(d.current_article_id) === 1, { db: d, polls });

  x = await runArticles([kwRowInput('KW1502', `${SITE}/housekeeping`, SCENARIOS.PLAG_NEVER)]);
  d = dbKw('KW1502');
  polls = x.newCalls.filter((c) => c.op === 'poll');
  record('T8b', 'Plagiarism report never ready: polling stops at PLAGIARISM_MAX_POLLS, fails closed (not approved, retry later)',
    d.status === 'ERROR' && /PLAGIARISM_POLL_TIMEOUT/.test(d.last_error) && kwRow('KW1502').Status === 'READY' && polls.length === 3 && markerCount(d.current_article_id) === 0,
    { db: d, polls: polls.length, sheet: kwRow('KW1502') });

  // ===================================================== malformed Gemini output -> one bounded correction each
  x = await runArticles([kwRowInput('KW1601', `${SITE}/housekeeping`, SCENARIOS.FLAKY_JSON)]);
  d = dbKw('KW1601');
  const byOp = (op) => x.newCalls.filter((c) => c.op === op);
  record('T-JSON', 'Malformed structured output (prompt creator non-JSON, writer missing field, evaluator truncated): one correction each, then approved',
    d.status === 'APPROVED' && byOp('prompt_creator').length === 2 && byOp('prompt_creator').filter((c) => c.isCorrection).length === 1 &&
    byOp('writer').length === 2 && byOp('writer').filter((c) => c.isCorrection).length === 1 && byOp('evaluator').length === 2 && byOp('evaluator').filter((c) => c.isCorrection).length === 1,
    { db: d, calls: x.newCalls.filter((c) => c.service === 'gemini' && c.op !== 'embed').map((c) => `${c.op}${c.isCorrection ? '(correction)' : ''}`) });

  // ===================================================== Gemini rate limit -> node retry with backoff
  x = await runArticles([kwRowInput('KW1602', `${SITE}/housekeeping`, SCENARIOS.RATE_LIMIT)]);
  d = dbKw('KW1602');
  record('T-429', 'Gemini rate limit (HTTP 429 twice): bounded node retry with backoff succeeds; not treated as a content failure',
    d.status === 'APPROVED' && byOp('writer').length === 3 && d.attempt_count === 1, { db: d, writerCalls: byOp('writer').length });

  // ===================================================== document lock: wait, then timeout
  sql("SELECT * FROM seo.acquire_doc_lock('TEST-DOC', 'other-execution', 5);");
  x = await runArticles([kwRowInput('KW1701', `${SITE}/housekeeping`, 'kitchen cleaning services pune')]);
  d = dbKw('KW1701');
  record('T12b', 'Master-doc lock held by another execution: bounded wait, lock acquired after expiry, written once',
    d.status === 'APPROVED' && markerCount(d.current_article_id) === 1 && sql("SELECT coalesce(holder,'') FROM seo.doc_locks WHERE doc_id='TEST-DOC'") === '', { db: d });

  sql("SELECT * FROM seo.acquire_doc_lock('TEST-DOC', 'stuck-execution', 600);");
  x = await runArticles([kwRowInput('KW1702', `${SITE}/housekeeping`, 'staircase cleaning services pune')]);
  d = dbKw('KW1702');
  const lockTimeout = { db: d, sheet: { ...kwRow('KW1702') } };
  sql("UPDATE seo.doc_locks SET holder = NULL, expires_at = NULL WHERE doc_id='TEST-DOC';");
  await runArticles([{ ...kwRow('KW1702') }]);
  const d2b = dbKw('KW1702');
  record('T12c', 'Master-doc lock never released: DOC_LOCK_TIMEOUT after DOC_LOCK_MAX_WAITS, not approved, retried successfully once the lock is free',
    lockTimeout.db.status === 'ERROR' && /DOC_LOCK_TIMEOUT/.test(lockTimeout.db.last_error) && lockTimeout.sheet.Status === 'READY' && d2b.status === 'APPROVED' && markerCount(d2b.current_article_id) === 1,
    { first: lockTimeout, retry: d2b });

  // ===================================================== Gemini authentication failure -> fail fast in preflight
  const realKey = state.expected.geminiKey;
  state.expected.geminiKey = 'rotated-key';
  x = await runArticles([kwRowInput('KW1801', `${SITE}/housekeeping`, 'terrace cleaning services pune')]);
  state.expected.geminiKey = realKey;
  record('T-AUTH', 'Gemini authentication failure: preflight stops the run before any record is claimed or generated',
    x.response.status >= 400 && kwRow('KW1801').Status === 'READY' && dbKw('KW1801') === null && x.newCalls.filter((c) => c.op === 'writer').length === 0,
    { http: x.response.status, sheet: kwRow('KW1801') });

  // ===================================================== Error Trigger workflow (unhandled failure)
  sql(`CREATE OR REPLACE FUNCTION seo.set_sheet_sync(p_article_id text, p_synced boolean, p_error text) RETURNS boolean LANGUAGE plpgsql AS $f$
       BEGIN
         IF p_synced AND EXISTS (SELECT 1 FROM seo.articles WHERE article_id = p_article_id AND keyword_id = 'KW-ERRTRIG') THEN
           RAISE EXCEPTION 'INJECTED_FAULT for the error-trigger test';
         END IF;
         UPDATE seo.articles SET sheet_synced = p_synced, sheet_sync_error = left(p_error, 4000), updated_at = now() WHERE article_id = p_article_id;
         RETURN p_synced;
       END $f$;`);
  const eventsBefore = Number(sql("SELECT count(*) FROM seo.processing_events WHERE stage = 'WORKFLOW_FAILED'"));
  x = await runArticles([kwRowInput('KW-ERRTRIG', `${SITE}/housekeeping`, 'glass facade cleaning pune')]);
  let failedEvents = 0;
  for (let i = 0; i < 30 && failedEvents <= eventsBefore; i++) {
    await sleep(1000);
    failedEvents = Number(sql("SELECT count(*) FROM seo.processing_events WHERE stage = 'WORKFLOW_FAILED'"));
  }
  const failEvent = sql("SELECT row_to_json(e) FROM (SELECT execution_id, workflow, message FROM seo.processing_events WHERE stage = 'WORKFLOW_FAILED' ORDER BY event_id DESC LIMIT 1) e");
  execSync(`${PSQL} -X -q -v ON_ERROR_STOP=1 -d ${DB} -f ${path.join(ROOT, 'database', '04_idempotency_and_recovery.sql')}`, { stdio: 'pipe' });
  d = dbKw('KW-ERRTRIG');
  const beforeRecovery = { ...d };
  await webhook('e2e-recovery');
  d = dbKw('KW-ERRTRIG');
  record('T15', 'Unhandled failure after a verified Docs write: Error Trigger workflow logs WORKFLOW_FAILED; article stays APPROVED/unsynced; scheduled recovery completes Sheets sync once',
    failedEvents > eventsBefore && /INJECTED_FAULT|Mark Sheet Synced/.test(failEvent) && beforeRecovery.status === 'APPROVED' && beforeRecovery.sheet_synced === false &&
    d.sheet_synced === true && kwRow('KW-ERRTRIG').Status === 'APPROVED' && markerCount(d.current_article_id) === 1,
    { failEvent, beforeRecovery, after: d });

  // ===================================================== document formatting sanity
  const markers = (state.doc.body.match(/SEO-ARTICLE-MARKER: (ART-[0-9A-Z-]+)/g) || []);
  const approvedCount = Number(sql("SELECT count(*) FROM seo.articles WHERE status='APPROVED'"));
  record('D1', 'Master doc integrity: one marker per approved article, no duplicates, every Docs batchUpdate accepted by index validation',
    markers.length === approvedCount && new Set(markers).size === markers.length && /Frequently Asked Questions/.test(state.doc.body) && /References/.test(state.doc.body) && !/\]\(http/.test(state.doc.body),
    { markers: markers.length, approvedCount, docChars: state.doc.body.length });
  fs.writeFileSync(path.join(ROOT, 'tests', 'results', 'e2e_master_doc_text.txt'), state.doc.body);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
