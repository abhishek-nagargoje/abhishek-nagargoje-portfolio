// End-to-end tests of the three workflows inside a REAL n8n engine
// (`n8n execute`), a REAL PostgreSQL + pgvector database and MOCKED external
// services (tests/mock_services.js). Labelled MOCKED: these runs prove the
// workflow logic, wiring, SQL and n8n node behaviour, not the live APIs.
//
// The harness changes only what must point at the mocks:
//   * Configuration node: API base URLs, allowed domain, polling interval
//   * Google Sheets nodes -> HTTP calls to the mock sheet (same expressions)
//   * Google Docs HTTP nodes: authentication none (mock has no OAuth)
// Everything else (all Code, Postgres, IF/Switch, HTTP, Wait nodes) runs as shipped.
//
// Env: N8N_BIN (wrapper script), PGHOST/PGPORT (superuser 'postgres', trust),
//      WORK (scratch dir). Usage: node tests/run_e2e_mocked.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const WORK = process.env.WORK;
const N8N = process.env.N8N_BIN;
const PG = { host: process.env.PGHOST || '127.0.0.1', port: process.env.PGPORT || '5433' };
const MOCK = 'https://127.0.0.1:9443';
const IDS = { w1: 'hrrW1BrandRagIng', w2: 'hrrW2SeoArticleA', w3: 'hrrW3ErrorRecovr', w2web: 'hrrW2ErrTestWebh' };
if (!WORK || !N8N) { console.error('set WORK and N8N_BIN'); process.exit(2); }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const psql = (db, sql) => execFileSync('psql', ['-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', db, '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const q = (sql) => psql('seo_e2e', sql);
function api(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = https.request(MOCK + pathname, { method: body ? 'POST' : 'GET', rejectUnauthorized: false, agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    r.on('error', reject); r.end(data);
  });
}
let passed = 0; const failed = [];
function check(name, cond, info) { if (cond) { passed++; console.log('    PASS', name); } else { failed.push(name); console.log('    FAIL', name, info !== undefined ? JSON.stringify(info).slice(0, 600) : ''); } }

// ------------------------------------------------------------- harness build
function harness(file, id) {
  const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
  wf.id = id;
  for (const n of wf.nodes) {
    if (n.name === 'Configuration') {
      n.parameters.jsCode = n.parameters.jsCode
        .replace("'https://generativelanguage.googleapis.com/v1beta'", "'" + MOCK + "/gemini/v1beta'")
        .replace("'https://www.duplichecker.com/api'", "'" + MOCK + "/dc'")
        .replace("'https://docs.googleapis.com/v1'", "'" + MOCK + "/docs/v1'")
        .replace("allowed_target_domains: ['hrremedyindia.com']", "allowed_target_domains: ['127.0.0.1']")
        .replace("official_domains: ['hrremedyindia.com']", "official_domains: ['127.0.0.1']")
        .replace('plagiarism_poll_interval_seconds: 20', 'plagiarism_poll_interval_seconds: 5')
        .replace('plagiarism_max_polls: 30', 'plagiarism_max_polls: 3');
    }
    if (n.type === 'n8n-nodes-base.googleSheets') {
      const expr = (rlv) => rlv.value.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
      const base = "'" + MOCK + "/sheets/" + n.parameters.operation + "?sheet=' + encodeURIComponent(" + expr(n.parameters.sheetName) + ") + '&doc=' + encodeURIComponent(" + expr(n.parameters.documentId) + ')';
      const match = n.parameters.columns ? n.parameters.columns.matchingColumns[0] : '';
      n.parameters = n.parameters.operation === 'read'
        ? { method: 'GET', url: '={{ ' + base + ' }}', options: {} }
        : { method: 'POST', url: '={{ ' + base + " + '&match=" + match + "' }}", sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json) }}', options: {} };
      n.type = 'n8n-nodes-base.httpRequest'; n.typeVersion = 4.2; delete n.credentials;
    }
    if (n.type === 'n8n-nodes-base.httpRequest' && n.parameters.nodeCredentialType === 'googleDocsOAuth2Api') {
      n.parameters.authentication = 'none'; delete n.parameters.nodeCredentialType; delete n.credentials;
    }
  }
  if (id === IDS.w2) wf.settings.errorWorkflow = IDS.w3;
  return wf;
}

// ------------------------------------------------------------- n8n runner
function runWorkflow(id, label) {
  const t0 = Date.now();
  const r = spawnSync(N8N, ['execute', '--id=' + id, '--rawOutput'], { encoding: 'utf8', env: process.env, maxBuffer: 512 * 1024 * 1024, timeout: 600000 });
  // The CLI prints the run data as pretty JSON (via the logger, so at info
  // level) after other log lines: parse from the first line that is "{".
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  let data = null;
  const lines = out.split('\n');
  for (let k = 0; k < lines.length && !data; k++) {
    if (lines[k] !== '{') continue;
    for (let e = lines.length; e > k && !data; e--) { if (lines[e - 1] !== '}') continue; try { data = JSON.parse(lines.slice(k, e).join('\n')); } catch (x) { /* keep looking */ } }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const runData = data && data.data && data.data.resultData ? data.data.resultData.runData : null;
  const error = r.status !== 0 ? ((r.stderr || '') + out).split('\n').filter((l) => /error|Error/.test(l)).slice(0, 6).join(' | ') : null;
  console.log('  [' + label + '] exit ' + r.status + ' in ' + secs + 's');
  const last = (node) => { const runs = runData && runData[node]; if (!runs || !runs.length) return null; const o = runs[runs.length - 1].data && runs[runs.length - 1].data.main; return o && o[0] && o[0][0] ? o[0][0].json : null; };
  const runs = (node) => (runData && runData[node] ? runData[node].length : 0);
  return { status: r.status, data, runData, last, runs, error, stderr: r.stderr };
}
const sheetRow = (st, sheet, key, col = 'Keyword_ID') => st.sheets[sheet].find((r) => r[col] === key);

// ------------------------------------------------------------- fixtures (TEST DATA - not verified company information)
const KB = [
  { Knowledge_ID: 'KB-001', Category: 'Company Profile', Content: 'TEST FIXTURE: recruitment services, screening, interviews, onboarding and payroll support for employers in India.', Source_URL: MOCK + '/site/recruitment', Approved: true, Last_Updated: '2026-10-01' },
  { Knowledge_ID: 'KB-002', Category: 'Brand Voice', Content: 'TEST FIXTURE: professional, clear and practical tone for HR managers.', Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
  { Knowledge_ID: 'KB-003', Category: 'Draft', Content: 'TEST FIXTURE: unapproved draft text that must never be ingested.', Source_URL: '', Approved: 'FALSE', Last_Updated: '' },
  { Knowledge_ID: 'KB-004', Category: 'Draft', Content: 'TEST FIXTURE: blank approval.', Source_URL: '', Approved: '', Last_Updated: '' },
  { Knowledge_ID: '', Category: 'Broken', Content: 'TEST FIXTURE: no id.', Source_URL: '', Approved: true, Last_Updated: '' },
];
const kw = (id, url, keyword, extra = {}) => Object.assign({ Keyword_ID: id, Target_Page_URL: url, Primary_Keyword: keyword, Supporting_Keywords: 'hiring, staffing', Search_Intent: 'commercial',
  Target_Audience: 'HR managers', Target_Location: 'India', Language: 'English', Priority: 'High', Status: 'READY', Processing_Started_At: '', Processed_At: '', Last_Error: '' }, extra);
const resetJobs = () => q('TRUNCATE seo_article_jobs, seo_execution_errors CASCADE; DELETE FROM seo_settings WHERE setting_key = \'master_doc\';');

(async () => {
  // ---------------- setup
  for (const db of ['seo_e2e', 'n8n_e2e']) { psql('postgres', 'DROP DATABASE IF EXISTS ' + db); psql('postgres', 'CREATE DATABASE ' + db + ' OWNER seo_n8n'); }
  psql('seo_e2e', 'CREATE EXTENSION vector');
  Object.assign(process.env, { DB_TYPE: 'postgresdb', DB_POSTGRESDB_HOST: PG.host, DB_POSTGRESDB_PORT: PG.port, DB_POSTGRESDB_DATABASE: 'n8n_e2e',
    DB_POSTGRESDB_USER: 'postgres', DB_POSTGRESDB_PASSWORD: 'x', N8N_USER_FOLDER: path.join(WORK, 'e2e_home'), N8N_LOG_LEVEL: 'info',
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false', EXECUTIONS_MODE: 'regular' });
  fs.rmSync(process.env.N8N_USER_FOLDER, { recursive: true, force: true });
  const creds = [
    { id: 'credPgE2E0000001', name: 'SEO PostgreSQL', type: 'postgres', data: { host: PG.host, port: Number(PG.port), database: 'seo_e2e', user: 'seo_n8n', password: 'localtest', ssl: 'disable' } },
    { id: 'credGeminiE2E001', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi', data: { host: 'https://generativelanguage.googleapis.com', apiKey: 'MOCK-GEMINI-KEY' } },
    { id: 'credDupliE2E0001', name: 'DupliChecker API', type: 'httpCustomAuth', data: { json: '{"body":{"token":"MOCK-TOKEN"}}' } },
  ];
  fs.writeFileSync(path.join(WORK, 'e2e_creds.json'), JSON.stringify(creds));
  execFileSync(N8N, ['import:credentials', '--input=' + path.join(WORK, 'e2e_creds.json')], { env: process.env, stdio: 'ignore' });
  for (const [file, id] of [['01_Brand_RAG_Ingestion.json', IDS.w1], ['02_SEO_Article_Automation.json', IDS.w2], ['03_Error_Recovery.json', IDS.w3]]) {
    const p = path.join(WORK, 'harness_' + file); fs.writeFileSync(p, JSON.stringify(harness(file, id)));
    execFileSync(N8N, ['import:workflow', '--input=' + p], { env: process.env, stdio: 'ignore' });
  }
  {
    const wf = harness('02_SEO_Article_Automation.json', IDS.w2);
    wf.id = IDS.w2web; wf.name += ' (error-workflow test copy)';
    wf.nodes.push({ parameters: { httpMethod: 'POST', path: 'hrr-error-test', responseMode: 'onReceived', options: {} }, id: 'b1f0c0de-0000-4000-a000-00000000e2e1',
      name: 'Test Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 600], webhookId: 'b1f0c0de-0000-4000-a000-00000000e2e2' });
    wf.connections['Test Webhook'] = { main: [[{ node: 'Configuration', type: 'main', index: 0 }]] };
    const p = path.join(WORK, 'harness_w2_webhook.json'); fs.writeFileSync(p, JSON.stringify(wf));
    execFileSync(N8N, ['import:workflow', '--input=' + p], { env: process.env, stdio: 'ignore' });
    // n8n 2.x activates by publishing; n8n 1.x uses the active flag. Run both.
    // n8n 2.x only runs an error workflow that is published, so publish W3 too (as documented for users).
    for (const args of [['publish:workflow', '--id=' + IDS.w2web], ['update:workflow', '--id=' + IDS.w2web, '--active=true'],
      ['publish:workflow', '--id=' + IDS.w3], ['update:workflow', '--id=' + IDS.w3, '--active=true']]) {
      try { execFileSync(N8N, args, { env: process.env, stdio: 'ignore' }); } catch (e) { /* command not available in this version */ }
    }
  }
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock_services.js')], { env: Object.assign({}, process.env, { MOCK_KEY: path.join(WORK, 'mock.key'), MOCK_CERT: path.join(WORK, 'mock.crt') }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => mock.stdout.once('data', r));
  const setup = (o) => api('/__control', o);
  const state = () => api('/__state');
  try {
    const ONLY = process.env.E2E_ONLY || '';
    let r; let res; let st;
    if (ONLY !== 'T11') {
    // ================================================================= W1
    console.log('\nT1 Brand RAG ingestion (MOCKED Sheets/Gemini, real PostgreSQL)');
    await setup({ reset: true, sheets: { Brand_Knowledge: KB } });
    r = runWorkflow(IDS.w1, 'W1 first run');
    res = r.last('Ingestion Result');
    check('schema initialisation succeeded (Ensure Database Schema ran)', r.runs('Ensure Database Schema') === 1 && Number(q("SELECT count(*) FROM pg_proc WHERE proname='seo_claim_next_job'")) === 1, r.error);
    check('ingestion reads approved rows only (2 inserted)', res && res.inserted === 2 && res.unapproved_rows_ignored === 2, res || r.error);
    check('"FALSE" string and blank Approved are not treated as approved', q("SELECT string_agg(knowledge_id, ',' ORDER BY knowledge_id) FROM seo_brand_knowledge") === 'KB-001,KB-002');
    check('blank Knowledge_ID row skipped and reported', res && res.failures.some((f) => /blank Knowledge_ID/.test(f.reason || '')), res && res.failures);
    st = await state();
    check('document embeddings use RETRIEVAL_DOCUMENT with 768 dims', st.calls.filter((c) => c.api === 'gemini.embedContent').every((c) => c.taskType === 'RETRIEVAL_DOCUMENT'));
    check('Gemini API key sent by the n8n credential, never in a request body', st.errors.length === 0, st.errors);
    r = runWorkflow(IDS.w1, 'W1 second run');
    res = r.last('Ingestion Result');
    check('repeated ingestion: no duplicates, no re-embedding', res && res.inserted === 0 && res.unchanged === 2 && Number(q('SELECT count(*) FROM seo_brand_knowledge')) === 2, res || r.error);
    await setup({ sheets: { Brand_Knowledge: [Object.assign({}, KB[0], { Content: KB[0].Content + ' Updated.' }), KB[1], Object.assign({}, KB[2], { Approved: 'FALSE' })] } });
    r = runWorkflow(IDS.w1, 'W1 changed record');
    res = r.last('Ingestion Result');
    check('changed record is re-embedded and updated', res && res.updated === 1 && res.unchanged === 1, res || r.error);

    // ================================================================= W2 empty / invalid
    console.log('\nT2 Article automation - empty and invalid input (MOCKED)');
    await setup({ sheets: { Keywords: [] } });
    r = runWorkflow(IDS.w2, 'W2 empty sheet');
    res = r.last('No Eligible Keywords');
    check('empty Keywords sheet stops gracefully with guidance', r.status === 0 && res && res.status === 'NO_ELIGIBLE_KEYWORDS' && /at least one row/.test(res.message), res || r.error);
    check('no article generated for empty sheet', !(await state()).calls.some((c) => c.api === 'gemini.generateContent'));
    check('Gemini "auto" picked the newest stable flash model and skipped previews (verified against ListModels)', (r.last('Resolve Gemini Models') || { ctx: { models: {} } }).ctx.models.text_model === 'gemini-8.5-flash', r.last('Resolve Gemini Models') && r.last('Resolve Gemini Models').ctx.models);
    await setup({ sheets: { Keywords: [kw('KW-BAD', 'https://evil.example.com/x', 'recruitment'), kw('', MOCK + '/site/recruitment', 'x'), kw('KW-DONE', MOCK + '/site/recruitment', 'done', { Status: 'APPROVED' })] } });
    r = runWorkflow(IDS.w2, 'W2 invalid rows');
    st = await state();
    check('invalid target URL rejected and row marked ERROR', sheetRow(st, 'Keywords', 'KW-BAD').Status === 'ERROR' && /allowed_target_domains/.test(sheetRow(st, 'Keywords', 'KW-BAD').Last_Error), sheetRow(st, 'Keywords', 'KW-BAD'));
    check('row with blank Keyword_ID marked ERROR by row number', st.sheets.Keywords[1].Status === 'ERROR', st.sheets.Keywords[1]);
    check('non-READY rows untouched', sheetRow(st, 'Keywords', 'KW-DONE').Status === 'APPROVED');

    // ================================================================= W2 inaccessible page
    console.log('\nT3 Inaccessible / JavaScript-only target page (MOCKED)');
    await setup({ reset: true, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-JS', MOCK + '/site/js-shell', 'recruitment services india'), kw('KW-404', MOCK + '/site/missing', 'payroll services india', { Priority: 'Low' })] } });
    r = runWorkflow(IDS.w2, 'W2 js shell');
    st = await state();
    const js = sheetRow(st, 'Keywords', 'KW-JS');
    check('JS-only page is not treated as analysed -> REVIEW_REQUIRED', js.Status === 'REVIEW_REQUIRED' && /JavaScript/.test(js.Last_Error), js);
    check('no Gemini article call for an unanalysed page', !st.calls.some((c) => c.api === 'gemini.generateContent'));
    check('lease released after in-flow failure (manual runs never leave locks)', q("SELECT coalesce(lease_owner,'none') FROM seo_article_jobs WHERE keyword_id='KW-JS'") === 'none');
    check('Article_Log row written for the review case (upsert by Article_ID)', st.sheets.Article_Log.length === 1 && st.sheets.Article_Log[0].Status === 'REVIEW_REQUIRED');
    r = runWorkflow(IDS.w2, 'W2 404 page');
    st = await state();
    check('HTTP 404 page -> REVIEW_REQUIRED', sheetRow(st, 'Keywords', 'KW-404').Status === 'REVIEW_REQUIRED' && /HTTP 404/.test(sheetRow(st, 'Keywords', 'KW-404').Last_Error), sheetRow(st, 'Keywords', 'KW-404'));

    // ================================================================= W2 happy path with revision
    console.log('\nT4 Full run: prompt -> article -> editorial -> plagiarism FAIL -> revision -> both checks again -> APPROVED -> Google Doc (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { plag_by_attempt: { 1: 25, 2: 3, 3: 3 } }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-001', MOCK + '/site/recruitment', 'Recruitment Services India')] } });
    r = runWorkflow(IDS.w2, 'W2 happy path');
    res = r.last('Final Result');
    st = await state();
    const gen = st.calls.filter((c) => c.api === 'gemini.generateContent').map((c) => c.kind);
    check('execution succeeded and article APPROVED', r.status === 0 && res && res.status === 'APPROVED', res || r.error);
    check('prompt creation and article writing are separate Gemini calls (PROMPT before ARTICLE)', gen[0] === 'PROMPT' && gen[1] === 'ARTICLE', gen);
    check('Gemini calls use JSON response mode', st.calls.filter((c) => c.api === 'gemini.generateContent').every((c) => c.json_mode === 'application/json'));
    check('failed plagiarism (25%) triggered the reviser', gen.includes('REVISION'), gen);
    check('revised article evaluated by the editor again (2 editorial calls)', gen.filter((k) => k === 'EDITORIAL').length === 2, gen);
    check('revised text submitted to DupliChecker again (2 checkplag calls)', st.calls.filter((c) => c.api === 'duplichecker.checkplag').length === 2);
    check('DupliChecker account status checked first (api/info)', st.calls.findIndex((c) => c.api === 'duplichecker.info') < st.calls.findIndex((c) => c.api === 'duplichecker.checkplag'));
    check('DupliChecker token delivered by the credential (JSON body)', st.calls.filter((c) => c.api === 'duplichecker.checkplag').every((c) => /json/.test(c.content_type)));
    check('asynchronous polling used the documented callback (>= 2 polls per job)', st.calls.filter((c) => c.api === 'duplichecker.query-footprint').length >= 4);
    check('attempts recorded in PostgreSQL (2)', q("SELECT count(*) FROM seo_article_attempts a JOIN seo_article_jobs j USING (article_id) WHERE j.keyword_id='KW-001'") === '2');
    check('plagiarism checks recorded per attempt with distinct text hashes', q("SELECT count(DISTINCT content_sha256) FROM seo_plagiarism_checks p JOIN seo_article_jobs j USING (article_id) WHERE j.keyword_id='KW-001'") === '2');
    const docs = Object.keys(st.docs);
    check('master Google Doc created automatically with the required title', docs.length === 1 && st.docs[docs[0]].title === 'HR Remedy India — SEO Article Library', st.calls.filter((c) => c.api === 'docs.create'));
    check('master doc ID stored in PostgreSQL', q("SELECT setting_value->>'doc_id' FROM seo_settings WHERE setting_key='master_doc'") === docs[0]);
    const doc = st.docs[docs[0]];
    const aid = q("SELECT article_id FROM seo_article_jobs WHERE keyword_id='KW-001'");
    check('unique searchable marker inserted', doc.text.includes('[[HRR-ARTICLE:' + aid + ']]'));
    check('article body inserted with H1/H2/H3 heading styles', ['HEADING_1', 'HEADING_2', 'HEADING_3'].every((h) => (doc.headings || []).some((x) => x.style === h)), doc.headings);
    check('headings map to the right text', (doc.headings || []).some((x) => x.style === 'HEADING_2' && x.text === 'Why structured recruitment matters'), doc.headings);
    check('verified internal link hyperlinked; anchor text matches', (doc.links || []).some((l) => l.text === 'recruitment services' && /site\/recruitment$/.test(l.url)), doc.links);
    check('only verified/listed URLs are hyperlinked', (doc.links || []).every((l) => /127\.0\.0\.1:9443\/site\/recruitment|labour\.gov\.in/.test(l.url)), doc.links);
    check('metadata lines present (SEO title, meta description, slug, editorial, plagiarism)', ['SEO title:', 'Meta description:', 'Suggested URL slug: recruitment-services-india-guide', 'Editorial result: PASS', 'Plagiarism result: PASS'].every((s) => doc.text.includes(s)));
    check('long body not truncated', doc.text.includes('feedback loops in plain language for HR teams.') && doc.text.length > 5000, doc.text.length);
    const log = sheetRow(st, 'Article_Log', aid, 'Article_ID');
    check('Article_Log row written with doc URL, 2 attempts, plagiarism 3%', log && log.Status === 'APPROVED' && String(log.Attempts) === '2' && Number(log.Plagiarism_Percent) === 3 && /docs\.google\.com\/document\/d\/mockdoc1/.test(log.Google_Doc_URL), log);
    check('EETA_Report column filled (exact header name)', log && /overall_status/.test(log.EETA_Report));
    check('Keywords row marked APPROVED only after verified insertion', sheetRow(st, 'Keywords', 'KW-001').Status === 'APPROVED' && q("SELECT doc_verified_at IS NOT NULL FROM seo_article_jobs WHERE article_id='" + aid + "'") === 't');
    check('progress statuses written along the way', ['PROCESSING', 'PROMPT_CREATED', 'ARTICLE_GENERATED', 'QUALITY_REVIEW', 'PLAGIARISM_CHECK', 'REVISION_REQUIRED'].every((s) => st.calls.some((c) => c.api === 'sheets.update' && c.status === s)), [...new Set(st.calls.filter((c) => c.api === 'sheets.update').map((c) => c.status))]);
    check('Docs mock saw no out-of-range indexes', st.errors.length === 0, st.errors);

    // ================================================================= second article reuses doc
    console.log('\nT5 Second article reuses the master doc; duplicate protection (MOCKED)');
    await setup({ scenario: { plag_by_attempt: { 1: 2 } }, sheets: { Keywords: st.sheets.Keywords.concat([kw('KW-002', MOCK + '/site/recruitment', 'practical recruitment guide')]) } });
    r = runWorkflow(IDS.w2, 'W2 second keyword');
    st = await state();
    check('second article APPROVED on first attempt', sheetRow(st, 'Keywords', 'KW-002').Status === 'APPROVED', sheetRow(st, 'Keywords', 'KW-002'));
    check('master doc reused (still one document)', Object.keys(st.docs).length === 1 && st.calls.filter((c) => c.api === 'docs.create').length === 1);
    check('second article starts on a new page', st.docs[Object.keys(st.docs)[0]].page_breaks === 1, st.docs[Object.keys(st.docs)[0]].page_breaks);
    check('batchUpdate pinned to the read revision (writeControl)', st.calls.filter((c) => c.api === 'docs.batchUpdate').every((c) => /^rev-/.test(c.targetRevision || '')));
    const textBefore = st.docs[Object.keys(st.docs)[0]].text;
    await setup({ sheets: { Keywords: st.sheets.Keywords.map((row) => row.Keyword_ID === 'KW-001' ? Object.assign({}, row, { Status: 'READY' }) : row) } });
    r = runWorkflow(IDS.w2, 'W2 re-queued approved keyword');
    st = await state();
    check('re-queued approved keyword -> SKIPPED_DUPLICATE, nothing appended', sheetRow(st, 'Keywords', 'KW-001').Status === 'SKIPPED_DUPLICATE' && st.docs[Object.keys(st.docs)[0]].text === textBefore, sheetRow(st, 'Keywords', 'KW-001'));

    // ================================================================= failure after doc insert
    console.log('\nT6 Google Docs insert succeeded but the Sheets update failed -> reconcile, never re-append (MOCKED)');
    await setup({ scenario: { plag_by_attempt: { 1: 1 }, sheet_fail: { Article_Log: true } }, sheets: { Keywords: st.sheets.Keywords.concat([kw('KW-003', MOCK + '/site/recruitment', 'recruitment services in india guide')]) } });
    r = runWorkflow(IDS.w2, 'W2 sheet failure');
    st = await state();
    const aid3 = q("SELECT article_id FROM seo_article_jobs WHERE keyword_id='KW-003'");
    check('job APPROVED in DB with Article_Log sync pending', q("SELECT status || '/' || (article_log_synced_at IS NULL) FROM seo_article_jobs WHERE article_id='" + aid3 + "'") === 'APPROVED/true');
    const markerCount = (t) => t.split('[[HRR-ARTICLE:' + aid3 + ']]').length - 1;
    check('article inserted exactly once', markerCount(st.docs[Object.keys(st.docs)[0]].text) === 1);
    await setup({ scenario: { sheet_fail: {} } });
    q("UPDATE seo_article_jobs SET completed_at = now() - interval '10 minutes' WHERE article_id='" + aid3 + "'");
    const callsBefore = st.calls.length;
    r = runWorkflow(IDS.w3, 'W3 recovery sweep');
    st = await state();
    const sweepCalls = st.calls.slice(callsBefore);
    check('recovery sweep reconciled Article_Log without regenerating or re-appending', st.sheets.Article_Log.some((x) => x.Article_ID === aid3 && x.Status === 'APPROVED') && !sweepCalls.some((c) => c.api === 'gemini.generateContent' || c.api === 'docs.batchUpdate'), { sweepCalls, log: st.sheets.Article_Log.map((x) => [x.Article_ID, x.Status]), w3: r.last('Recovery Result') || r.error });
    check('reconciliation marked as synced in PostgreSQL', q("SELECT (article_log_synced_at IS NOT NULL)::text FROM seo_article_jobs WHERE article_id='" + aid3 + "'") === 'true');
    check('still exactly one copy of the article in the doc', markerCount(st.docs[Object.keys(st.docs)[0]].text) === 1);

    console.log('\nT6b Keywords sheet completely unavailable during a run -> article still approved in DB, sheet reconciled later (MOCKED)');
    await setup({ scenario: { plag_by_attempt: { 1: 1 }, sheet_fail: { Keywords: true } }, sheets: { Keywords: st.sheets.Keywords.concat([kw('KW-004', MOCK + '/site/recruitment', 'recruitment guide india')]) } });
    r = runWorkflow(IDS.w2, 'W2 Keywords sheet down');
    res = r.last('Final Result');
    check('run completes despite failing progress/status writes', r.status === 0 && res && res.status === 'APPROVED' && res.sheets.keywords_updated === false, res || r.error);
    st = await state();
    check('Keywords row was left READY (sheet unavailable), database says APPROVED', sheetRow(st, 'Keywords', 'KW-004').Status === 'READY' && q("SELECT status FROM seo_article_jobs WHERE keyword_id='KW-004'") === 'APPROVED');
    await setup({ scenario: { sheet_fail: {} } });
    const before6b = st.calls.length;
    r = runWorkflow(IDS.w2, 'W2 next run reconciles (RECONCILE mode)');
    st = await state();
    const calls6b = st.calls.slice(before6b);
    check('next run claimed in RECONCILE mode: sheet APPROVED, no Gemini call, no Docs write', sheetRow(st, 'Keywords', 'KW-004').Status === 'APPROVED' &&
      !calls6b.some((c) => c.api === 'gemini.generateContent' || c.api === 'docs.batchUpdate' || c.api === 'docs.create'), calls6b.map((c) => c.api));
    check('lease released after reconciliation', q("SELECT coalesce(lease_owner,'none') FROM seo_article_jobs WHERE keyword_id='KW-004'") === 'none');

    // ================================================================= max attempts
    console.log('\nT7 Critical editorial failure on every attempt -> max 3 attempts -> REVIEW_REQUIRED, kept out of the doc (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { editorial_fail_attempts: [1, 2, 3], plag_by_attempt: { 1: 1, 2: 1, 3: 1 } }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-010', MOCK + '/site/recruitment', 'recruitment services india')] } });
    r = runWorkflow(IDS.w2, 'W2 always failing editorial');
    st = await state();
    const g7 = st.calls.filter((c) => c.api === 'gemini.generateContent').map((c) => c.kind);
    check('exactly 3 writing attempts (1 article + 2 revisions)', g7.filter((k) => k === 'ARTICLE').length === 1 && g7.filter((k) => k === 'REVISION').length === 2, g7);
    check('critical factual failure blocked approval even with 1% plagiarism', sheetRow(st, 'Keywords', 'KW-010').Status === 'REVIEW_REQUIRED', sheetRow(st, 'Keywords', 'KW-010'));
    check('nothing written to Google Docs', Object.keys(st.docs).length === 0 && !st.calls.some((c) => c.api === 'docs.batchUpdate'));

    // ================================================================= invalid model output
    console.log('\nT8 Invalid structured output from Gemini -> one corrective retry -> fail safely (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { prompt_invalid: true }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-020', MOCK + '/site/recruitment', 'recruitment services india')] } });
    r = runWorkflow(IDS.w2, 'W2 invalid prompt JSON');
    st = await state();
    const g8 = st.calls.filter((c) => c.api === 'gemini.generateContent');
    check('exactly one corrective retry for the prompt call', g8.length === 2 && g8[1].corrective === true, g8);
    check('invalid output -> REVIEW_REQUIRED, no article written', sheetRow(st, 'Keywords', 'KW-020').Status === 'REVIEW_REQUIRED' && !g8.some((c) => c.kind === 'ARTICLE'), sheetRow(st, 'Keywords', 'KW-020'));
    resetJobs();
    await setup({ reset: true, scenario: { article_invalid: true }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-021', MOCK + '/site/recruitment', 'recruitment services india')] } });
    r = runWorkflow(IDS.w2, 'W2 invalid article JSON');
    st = await state();
    check('truncated article JSON -> corrective retry -> REVIEW_REQUIRED', st.calls.filter((c) => c.kind === 'ARTICLE').length === 2 && sheetRow(st, 'Keywords', 'KW-021').Status === 'REVIEW_REQUIRED', sheetRow(st, 'Keywords', 'KW-021'));

    // ================================================================= plagiarism timeout + recovery
    console.log('\nT9 Plagiarism report never completes -> bounded polling -> TIMEOUT (not PASS) -> recovery collects the report later (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { plag_never_completes: true, plag_by_attempt: { 1: 2 } }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-030', MOCK + '/site/recruitment', 'recruitment services india')] } });
    r = runWorkflow(IDS.w2, 'W2 plagiarism timeout');
    st = await state();
    check('polling terminated after plagiarism_max_polls (3)', st.calls.filter((c) => c.api === 'duplichecker.query-footprint').length === 3, st.calls.filter((c) => c.api === 'duplichecker.query-footprint').length);
    check('no approval without a completed report', sheetRow(st, 'Keywords', 'KW-030').Status === 'REVIEW_REQUIRED' && Object.keys(st.docs).length === 0, sheetRow(st, 'Keywords', 'KW-030'));
    check('timeout recorded as TIMEOUT with provider hash kept', q("SELECT p.status || ':' || (p.provider_hash IS NOT NULL) FROM seo_plagiarism_checks p JOIN seo_article_jobs j USING (article_id) WHERE j.keyword_id='KW-030'") === 'TIMEOUT:true');
    await setup({ scenario: { plag_never_completes: false } });
    q("UPDATE seo_plagiarism_checks SET submitted_at = now() - interval '20 minutes'");
    r = runWorkflow(IDS.w3, 'W3 re-poll timed-out report');
    st = await state();
    check('recovery used the documented callback and re-queued the keyword (READY)', sheetRow(st, 'Keywords', 'KW-030').Status === 'READY', sheetRow(st, 'Keywords', 'KW-030'));
    r = runWorkflow(IDS.w2, 'W2 resume after recovered report');
    st = await state();
    check('resumed run published without regenerating (RESUME_DOC)', sheetRow(st, 'Keywords', 'KW-030').Status === 'APPROVED' && st.calls.filter((c) => c.api === 'gemini.generateContent').length === 3, st.calls.filter((c) => c.api === 'gemini.generateContent').map((c) => c.kind));

    // ================================================================= concurrency
    console.log('\nT10 Two executions started at the same time with one READY keyword (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { plag_by_attempt: { 1: 1 } }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-040', MOCK + '/site/recruitment', 'recruitment services india')] } });
    const both = await Promise.all([0, 1].map((k) => new Promise((resolve) => {
      // each n8n process needs its own task-runner broker port on one host
      const p = spawn(N8N, ['execute', '--id=' + IDS.w2, '--rawOutput'], { env: Object.assign({}, process.env, { N8N_RUNNERS_BROKER_PORT: String(5701 + k) }) });
      let out = ''; p.stdout.on('data', (c) => { out += c; }); p.on('close', (code) => resolve({ code, out }));
    })));
    st = await state();
    const claimedBoth = both.map((b) => (/"NOTHING_CLAIMED"/.test(b.out) ? 'NOTHING_CLAIMED' : /"APPROVED"/.test(b.out) ? 'APPROVED' : 'OTHER:' + b.code));
    check('exactly one execution processed the keyword; the other claimed nothing', claimedBoth.sort().join(',') === 'APPROVED,NOTHING_CLAIMED', claimedBoth);
    check('only one article generated and appended', st.calls.filter((c) => c.kind === 'ARTICLE').length === 1 && st.calls.filter((c) => c.api === 'docs.batchUpdate').length === 1);

    // ================================================================= error workflow
    } else { await setup({ reset: true, sheets: { Brand_Knowledge: KB } }); r = runWorkflow(IDS.w1, 'W1 ingestion (prerequisite for T11)'); } // end of T1-T10
    console.log('\nT11 Production failure (n8n server, webhook-triggered copy of W2) -> Error Trigger -> Error Recovery records it and releases the job (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { plag_by_attempt: { 1: 1 }, docs_batch_status: 403 }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-050', MOCK + '/site/recruitment', 'recruitment services india')] } });
    const srv = spawn(N8N, ['start'], { env: Object.assign({}, process.env, { N8N_PORT: '5691', N8N_LISTEN_ADDRESS: '127.0.0.1', N8N_RUNNERS_BROKER_PORT: '5692', N8N_LOG_LEVEL: 'warn' }), stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      let up = false;
      for (let k = 0; k < 120 && !up; k++) { try { up = (await fetch('http://127.0.0.1:5691/healthz')).ok; } catch (e) { /* starting */ } if (!up) await new Promise((s) => setTimeout(s, 1000)); }
      // /healthz is up before active workflows are registered: retry while the webhook is 404.
      let hook = { ok: false, status: 0 };
      for (let k = 0; k < 60 && !hook.ok; k++) {
        try { hook = await fetch('http://127.0.0.1:5691/webhook/hrr-error-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch (e) { hook = { ok: false, status: 0 }; }
        if (!hook.ok) await new Promise((s) => setTimeout(s, 2000));
      }
      check('production execution started by webhook', hook.ok, hook.status);
      let errRow = '';
      for (let k = 0; k < 90 && !errRow; k++) { await new Promise((s) => setTimeout(s, 2000)); errRow = q("SELECT recovery_status || '|' || coalesce(keyword_id,'') || '|' || failure_stage || '|' || left(error_message, 120) FROM seo_execution_errors WHERE failure_stage IS DISTINCT FROM 'STALE_LEASE' LIMIT 1"); }
      check('Error Trigger workflow recorded the failure with Keyword_ID and failing node', /^REQUEUED\|KW-050\|Check Created Master Doc|^REQUEUED\|KW-050\|Check Append Response/.test(errRow), errRow);
      check('error text explains the Docs permission problem', /lacks permission/.test(errRow), errRow);
      check('job released (no lease) and re-queued safely (ledger PENDING -> resume checks marker first)', q("SELECT coalesce(lease_owner,'none') || '|' || status || '|' || coalesce((SELECT status FROM seo_document_ledger l WHERE l.article_id = j.article_id), 'no-ledger') FROM seo_article_jobs j WHERE keyword_id='KW-050'") === 'none|ERROR|PENDING');
      for (let k = 0; k < 15; k++) { st = await state(); if (sheetRow(st, 'Keywords', 'KW-050').Status === 'READY') break; await new Promise((s) => setTimeout(s, 2000)); }
      check('Keywords row set back to READY with an explanation (bounded auto-retry)', sheetRow(st, 'Keywords', 'KW-050').Status === 'READY' && /Auto-retry 1\/3/.test(sheetRow(st, 'Keywords', 'KW-050').Last_Error), sheetRow(st, 'Keywords', 'KW-050'));
      await setup({ scenario: { docs_batch_status: 200 } });
    } finally { srv.kill('SIGTERM'); await new Promise((s) => setTimeout(s, 3000)); }
    const before11 = (await state()).calls.length;
    r = runWorkflow(IDS.w2, 'W2 retry after Docs permission fixed');
    st = await state();
    const calls11 = st.calls.slice(before11);
    check('retry resumed at the Docs stage (no new Gemini calls) and published once', sheetRow(st, 'Keywords', 'KW-050').Status === 'APPROVED' &&
      !calls11.some((c) => c.api === 'gemini.generateContent') && calls11.filter((c) => c.api === 'docs.batchUpdate').length === 1 &&
      Object.values(st.docs).every((d) => d.text.split('[[HRR-ARTICLE:').length - 1 <= 1), { row: sheetRow(st, 'Keywords', 'KW-050'), calls: calls11.map((c) => c.api) });
  } finally {
    mock.kill();
  }
  console.log('\n' + passed + ' passed, ' + failed.length + ' failed (all external services MOCKED)');
  if (failed.length) { console.log('Failed:', failed); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
