// End-to-end tests for workflows/02_SEO_Article_Automation_Gemini_Review.json in a
// REAL n8n engine with a REAL PostgreSQL + pgvector database and MOCKED Gemini,
// Google Sheets, Google Docs and target website (tests/mock_services.js).
// No DupliChecker credential is created: the workflow must not need one.
// Env: WORK, N8N_BIN, PGHOST, PGPORT (superuser 'postgres'). Usage: node tests/run_e2e_gemini_review.js
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
const IDS = { w1: 'hrrW1BrandRagIng', w2g: 'hrrW2GeminiRevie', w3: 'hrrW3ErrorRecovr' };
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const psql = (db, sql) => execFileSync('psql', ['-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', db, '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const q = (sql) => psql('seo_e2eg', sql);
function api(p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = https.request(MOCK + p, { method: body ? 'POST' : 'GET', rejectUnauthorized: false, agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(JSON.parse(s)));
    });
    r.on('error', reject); r.end(data);
  });
}
let passed = 0; const failed = [];
const check = (n, c, info) => { if (c) { passed++; console.log('    PASS', n); } else { failed.push(n); console.log('    FAIL', n, info !== undefined ? JSON.stringify(info).slice(0, 700) : ''); } };

function harness(file, id) {
  const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
  wf.id = id;
  for (const n of wf.nodes) {
    if (n.name === 'Configuration') {
      n.parameters.jsCode = n.parameters.jsCode
        .replace("'https://generativelanguage.googleapis.com/v1beta'", "'" + MOCK + "/gemini/v1beta'")
        .replace("'https://docs.googleapis.com/v1'", "'" + MOCK + "/docs/v1'")
        .replace("allowed_target_domains: ['hrremedyindia.com']", "allowed_target_domains: ['127.0.0.1']")
        .replace("official_domains: ['hrremedyindia.com']", "official_domains: ['127.0.0.1']");
    }
    if (n.type === 'n8n-nodes-base.googleSheets') {
      const expr = (v) => v.value.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
      const base = "'" + MOCK + '/sheets/' + n.parameters.operation + "?sheet=' + encodeURIComponent(" + expr(n.parameters.sheetName) + ") + '&doc=' + encodeURIComponent(" + expr(n.parameters.documentId) + ')';
      const match = n.parameters.columns ? n.parameters.columns.matchingColumns[0] : '';
      n.parameters = n.parameters.operation === 'read' ? { method: 'GET', url: '={{ ' + base + ' }}', options: {} }
        : { method: 'POST', url: '={{ ' + base + " + '&match=" + match + "' }}", sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json) }}', options: {} };
      n.type = 'n8n-nodes-base.httpRequest'; n.typeVersion = 4.2; delete n.credentials;
    }
    if (n.type === 'n8n-nodes-base.httpRequest' && n.parameters.nodeCredentialType === 'googleDocsOAuth2Api') {
      n.parameters.authentication = 'none'; delete n.parameters.nodeCredentialType; delete n.credentials;
    }
  }
  return wf;
}
function run(id, label) {
  const t0 = Date.now();
  const r = spawnSync(N8N, ['execute', '--id=' + id, '--rawOutput'], { encoding: 'utf8', env: process.env, maxBuffer: 512 * 1024 * 1024, timeout: 600000 });
  const lines = ((r.stdout || '') + '\n' + (r.stderr || '')).split('\n');
  let data = null;
  for (let k = 0; k < lines.length && !data; k++) {
    if (lines[k] !== '{') continue;
    for (let e = lines.length; e > k && !data; e--) { if (lines[e - 1] !== '}') continue; try { data = JSON.parse(lines.slice(k, e).join('\n')); } catch (x) { /* keep looking */ } }
  }
  console.log('  [' + label + '] exit ' + r.status + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  const rd = data && data.data && data.data.resultData ? data.data.resultData.runData : {};
  return { status: r.status, ran: (n) => !!rd[n], last: (n) => { const x = rd[n]; const o = x && x[x.length - 1].data && x[x.length - 1].data.main; return o && o[0] && o[0][0] ? o[0][0].json : null; } };
}
const KB = [
  { Knowledge_ID: 'KB-001', Category: 'Company Profile', Content: 'TEST FIXTURE: recruitment services, screening, interviews, onboarding and payroll support for employers in India.', Source_URL: MOCK + '/site/recruitment', Approved: true, Last_Updated: '2026-10-01' },
  { Knowledge_ID: 'KB-002', Category: 'Brand Voice', Content: 'TEST FIXTURE: professional, clear and practical tone for HR managers.', Source_URL: '', Approved: 'TRUE', Last_Updated: '2026-10-01' },
];
const kw = (id, keyword) => ({ Keyword_ID: id, Target_Page_URL: MOCK + '/site/recruitment', Primary_Keyword: keyword, Supporting_Keywords: 'hiring', Search_Intent: 'commercial',
  Target_Audience: 'HR managers', Target_Location: 'India', Language: 'English', Priority: 'High', Status: 'READY', Processing_Started_At: '', Processed_At: '', Last_Error: '' });
const row = (st, sheet, key, col = 'Keyword_ID') => st.sheets[sheet].find((r) => r[col] === key);
const resetJobs = () => q("TRUNCATE seo_article_jobs, seo_execution_errors CASCADE; DELETE FROM seo_settings WHERE setting_key IN ('master_doc','review_doc');");

(async () => {
  for (const db of ['seo_e2eg', 'n8n_e2eg']) { psql('postgres', 'DROP DATABASE IF EXISTS ' + db); psql('postgres', 'CREATE DATABASE ' + db + ' OWNER seo_n8n'); }
  psql('seo_e2eg', 'CREATE EXTENSION vector');
  Object.assign(process.env, { DB_TYPE: 'postgresdb', DB_POSTGRESDB_HOST: PG.host, DB_POSTGRESDB_PORT: PG.port, DB_POSTGRESDB_DATABASE: 'n8n_e2eg',
    DB_POSTGRESDB_USER: 'postgres', DB_POSTGRESDB_PASSWORD: 'x', N8N_USER_FOLDER: path.join(WORK, 'e2eg_home'), N8N_LOG_LEVEL: 'info', N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false' });
  fs.rmSync(process.env.N8N_USER_FOLDER, { recursive: true, force: true });
  // Deliberately NO DupliChecker credential.
  fs.writeFileSync(path.join(WORK, 'e2eg_creds.json'), JSON.stringify([
    { id: 'credPgE2EG000001', name: 'SEO PostgreSQL', type: 'postgres', data: { host: PG.host, port: Number(PG.port), database: 'seo_e2eg', user: 'seo_n8n', password: 'localtest', ssl: 'disable' } },
    { id: 'credGemE2EG00001', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi', data: { host: 'https://generativelanguage.googleapis.com', apiKey: 'MOCK-GEMINI-KEY' } }]));
  execFileSync(N8N, ['import:credentials', '--input=' + path.join(WORK, 'e2eg_creds.json')], { env: process.env, stdio: 'ignore' });
  for (const [file, id] of [['01_Brand_RAG_Ingestion.json', IDS.w1], ['02_SEO_Article_Automation_Gemini_Review.json', IDS.w2g], ['03_Error_Recovery.json', IDS.w3]]) {
    const p = path.join(WORK, 'harnessG_' + file); fs.writeFileSync(p, JSON.stringify(harness(file, id)));
    execFileSync(N8N, ['import:workflow', '--input=' + p], { env: process.env, stdio: 'ignore' });
  }
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock_services.js')], { env: Object.assign({}, process.env, { MOCK_KEY: path.join(WORK, 'mock.key'), MOCK_CERT: path.join(WORK, 'mock.crt') }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => mock.stdout.once('data', r)); mock.stdout.on('data', () => {});
  const setup = (o) => api('/__control', o);
  const state = () => api('/__state');
  try {
    await setup({ reset: true, sheets: { Brand_Knowledge: KB } });
    run(IDS.w1, 'W1 ingestion');

    console.log('\nG1 AI originality FAIL on attempt 1 -> revision -> editorial + AI review again -> PASS -> pending-human-review doc, REVIEW_REQUIRED (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { originality_fail_attempts: [1] }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-G1', 'Recruitment Services India')] } });
    let r = run(IDS.w2g, 'W2G happy path with revision');
    let st = await state();
    const g = st.calls.filter((c) => c.api === 'gemini.generateContent');
    const kinds = g.map((c) => c.kind);
    const res = r.last('Final Result');
    check('workflow ran without any DupliChecker credential or call', r.status === 0 && !st.calls.some((c) => /duplichecker/.test(c.api)), r.status);
    check('preflight went Resolve Gemini Models -> Ensure Database Schema (no DupliChecker preflight)', r.ran('Ensure Database Schema') && !r.ran('Check DupliChecker Account'));
    check('originality review runs after the E-E-A-T evaluation each attempt', kinds.join(',') === 'PROMPT,ARTICLE,EDITORIAL,ORIGINALITY,REVISION,EDITORIAL,ORIGINALITY', kinds);
    check('reviewer received target page and brand records as comparison material', g.filter((c) => c.kind === 'ORIGINALITY').every((c) => c.sawSources));
    check('reviser received the flagged passage and suggested rewrite', g.some((c) => c.kind === 'REVISION' && c.hasOriginality), g.filter((c) => c.kind === 'REVISION'));
    check('final status REVIEW_REQUIRED (human review), never APPROVED', res && res.status === 'REVIEW_REQUIRED' && row(st, 'Keywords', 'KW-G1').Status === 'REVIEW_REQUIRED', res || row(st, 'Keywords', 'KW-G1'));
    const aid = q("SELECT article_id FROM seo_article_jobs WHERE keyword_id='KW-G1'");
    const log = row(st, 'Article_Log', aid, 'Article_ID');
    check('Article_Log: Plagiarism_Percent blank, Plagiarism_Status AI_REVIEW_PASS, Plagiarism_Report_URL blank', log && log.Plagiarism_Percent === '' && log.Plagiarism_Status === 'AI_REVIEW_PASS' && log.Plagiarism_Report_URL === '', log && [log.Plagiarism_Percent, log.Plagiarism_Status, log.Plagiarism_Report_URL]);
    check('Article_Log status REVIEW_REQUIRED with human-review reason and doc link', log && log.Status === 'REVIEW_REQUIRED' && /Human review required/.test(log.Error) && /docs\.google\.com/.test(log.Google_Doc_URL), log && [log.Status, log.Error]);
    const docs = Object.values(st.docs);
    check('article written to the "Pending Human Review" document (not the approved library)', docs.length === 1 && docs[0].title === 'HR Remedy India — SEO Articles Pending Human Review', docs.map((d) => d.title));
    check('review doc ID stored under review_doc; master_doc untouched', q("SELECT count(*) FROM seo_settings WHERE setting_key='review_doc'") === '1' && q("SELECT count(*) FROM seo_settings WHERE setting_key='master_doc'") === '0');
    check('doc states PENDING HUMAN REVIEW and that it is not an external plagiarism check; no percentage', /PENDING HUMAN REVIEW/.test(docs[0].text) && /not an external plagiarism check/.test(docs[0].text) && !/DupliChecker|% plagiarism/.test(docs[0].text));
    check('DB: AI review stored per attempt as provider gemini_originality_review with no percentage', q("SELECT string_agg(p.provider || ':' || p.status || ':' || coalesce(p.plag_percent::text,'null') || ':' || p.passed, ',' ORDER BY p.attempt_no) FROM seo_plagiarism_checks p JOIN seo_article_jobs j USING (article_id) WHERE j.keyword_id='KW-G1'") === 'gemini_originality_review:COMPLETED:null:false,gemini_originality_review:COMPLETED:null:true');
    check('DB job REVIEW_REQUIRED, doc ledger VERIFIED, lease released', q("SELECT j.status || '|' || l.status || '|' || coalesce(j.lease_owner,'none') FROM seo_article_jobs j JOIN seo_document_ledger l USING (article_id) WHERE j.keyword_id='KW-G1'") === 'REVIEW_REQUIRED|VERIFIED|none');
    check('progress statuses still written', ['PROCESSING', 'PROMPT_CREATED', 'ARTICLE_GENERATED', 'QUALITY_REVIEW', 'PLAGIARISM_CHECK', 'REVISION_REQUIRED'].every((s) => st.calls.some((c) => c.api === 'sheets.update' && c.status === s)));
    check('Docs batchUpdate requests stayed in range', st.errors.length === 0, st.errors);

    console.log('\nG2 Re-queued (READY) after human review: no regeneration, no duplicate section, still REVIEW_REQUIRED (MOCKED)');
    const before = st.calls.length; const text1 = docs[0].text;
    await setup({ sheets: { Keywords: st.sheets.Keywords.map((x) => Object.assign({}, x, { Status: 'READY' })) } });
    r = run(IDS.w2g, 'W2G re-queued');
    st = await state();
    const after = st.calls.slice(before);
    check('no Gemini call and no document write on re-queue', !after.some((c) => c.api === 'gemini.generateContent' || c.api === 'docs.batchUpdate'), after.map((c) => c.api));
    check('document unchanged (marker found, no duplicate)', Object.values(st.docs)[0].text === text1);
    check('row stays REVIEW_REQUIRED (automation never self-approves)', row(st, 'Keywords', 'KW-G1').Status === 'REVIEW_REQUIRED');

    console.log('\nG3 Reviewer claims an internet scan and a percentage -> rejected -> corrective retry (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { originality_claims_scan_once: true }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-G3', 'Recruitment Services India')] } });
    r = run(IDS.w2g, 'W2G scan claim');
    st = await state();
    const o3 = st.calls.filter((c) => c.kind === 'ORIGINALITY');
    check('invalid claim triggered exactly one corrective retry, then the valid review was used', o3.length === 2 && o3[1].corrective === true && row(st, 'Keywords', 'KW-G3').Status === 'REVIEW_REQUIRED' && row(st, 'Article_Log', q("SELECT article_id FROM seo_article_jobs WHERE keyword_id='KW-G3'"), 'Article_ID').Plagiarism_Status === 'AI_REVIEW_PASS', o3);
    check('stored limitations state AI-only review and no percentage', /no plagiarism percentage exists/.test(q("SELECT p.result::text FROM seo_plagiarism_checks p JOIN seo_article_jobs j USING (article_id) WHERE j.keyword_id='KW-G3'")));

    console.log('\nG4 Invalid originality JSON twice -> REVIEW_REQUIRED, nothing written to Docs (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { originality_invalid: true }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-G4', 'Recruitment Services India')] } });
    r = run(IDS.w2g, 'W2G invalid review');
    st = await state();
    const l4 = row(st, 'Article_Log', q("SELECT article_id FROM seo_article_jobs WHERE keyword_id='KW-G4'"), 'Article_ID');
    check('fails safely to REVIEW_REQUIRED after one corrective retry; no document', st.calls.filter((c) => c.kind === 'ORIGINALITY').length === 2 && row(st, 'Keywords', 'KW-G4').Status === 'REVIEW_REQUIRED' && Object.keys(st.docs).length === 0);
    check('Article_Log Plagiarism_Status REVIEW_REQUIRED, percent and URL blank', l4 && l4.Plagiarism_Status === 'REVIEW_REQUIRED' && l4.Plagiarism_Percent === '' && l4.Plagiarism_Report_URL === '', l4 && [l4.Plagiarism_Status, l4.Plagiarism_Percent]);
    check('lease released', q("SELECT coalesce(lease_owner,'none') FROM seo_article_jobs WHERE keyword_id='KW-G4'") === 'none');

    console.log('\nG5 AI review fails on all 3 attempts -> max attempts -> REVIEW_REQUIRED with AI_REVIEW_FAIL, no document (MOCKED)');
    resetJobs();
    await setup({ reset: true, scenario: { originality_fail_attempts: [1, 2, 3] }, sheets: { Brand_Knowledge: KB, Keywords: [kw('KW-G5', 'Recruitment Services India')] } });
    r = run(IDS.w2g, 'W2G always failing review');
    st = await state();
    const k5 = st.calls.filter((c) => c.api === 'gemini.generateContent').map((c) => c.kind);
    const l5 = row(st, 'Article_Log', q("SELECT article_id FROM seo_article_jobs WHERE keyword_id='KW-G5'"), 'Article_ID');
    check('exactly 3 attempts and 3 originality reviews', k5.filter((k) => k === 'ARTICLE').length === 1 && k5.filter((k) => k === 'REVISION').length === 2 && k5.filter((k) => k === 'ORIGINALITY').length === 3, k5);
    check('REVIEW_REQUIRED, Plagiarism_Status AI_REVIEW_FAIL, nothing in Docs', row(st, 'Keywords', 'KW-G5').Status === 'REVIEW_REQUIRED' && l5 && l5.Plagiarism_Status === 'AI_REVIEW_FAIL' && Object.keys(st.docs).length === 0, l5 && l5.Plagiarism_Status);
  } finally { mock.kill(); }
  console.log('\n' + passed + ' passed, ' + failed.length + ' failed (Gemini, Google Sheets, Google Docs and the website MOCKED; n8n engine and PostgreSQL real)');
  if (failed.length) { console.log('Failed:', failed); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
