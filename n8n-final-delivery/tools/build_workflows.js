#!/usr/bin/env node
// Builds workflows/01_Brand_RAG_Ingestion.json, 02_SEO_Article_Automation.json
// and 03_Error_Recovery.json from the Code-node sources in tools/code and the
// SQL in database/. The JSON files in workflows/ are what you import into n8n;
// this script only exists so that the code, SQL and tests stay in sync.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CODE = path.join(__dirname, 'code');
const OUT = path.join(ROOT, 'workflows');

// ---------------------------------------------------------------- credentials
// Referenced by NAME with id = null. n8n binds them to your existing
// credentials of the same name and type when the workflow is saved/imported
// (no credential IDs from another instance are embedded).
const CRED = {
  postgres: { postgres: { id: null, name: 'SEO PostgreSQL' } },
  sheets: { googleSheetsOAuth2Api: { id: null, name: 'Google Sheets account' } },
  docs: { googleDocsOAuth2Api: { id: null, name: 'Google Docs account' } },
  gemini: { googlePalmApi: { id: null, name: 'Google Gemini(PaLM) Api account' } },
  dupli: { httpCustomAuth: { id: null, name: 'DupliChecker API' } },
};

// ---------------------------------------------------------------- helpers
function uuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const libCache = {};
function lib(name) { return libCache[name] || (libCache[name] = fs.readFileSync(path.join(CODE, 'lib', name + '.js'), 'utf8')); }
function codeSource(file) {
  const src = fs.readFileSync(path.join(CODE, file), 'utf8');
  const mode = (/^\/\/ @mode (each|all)/m.exec(src) || [])[1];
  if (!mode) throw new Error('missing @mode in ' + file);
  const libs = ((/^\/\/ @lib ([a-z,]+)/m.exec(src) || [])[1] || '').split(',').filter(Boolean);
  const body = src.replace(/^\/\/ @(mode|lib) .*\n/gm, '');
  return { mode, code: libs.map(lib).join('\n') + (libs.length ? '\n' : '') + body };
}

class WF {
  constructor(name, key) { this.name = name; this.key = key; this.nodes = []; this.connections = {}; this.byName = new Map(); }
  add(name, type, typeVersion, parameters, pos, extra = {}) {
    if (this.byName.has(name)) throw new Error('duplicate node name ' + name);
    const node = Object.assign({ parameters, id: uuid(this.key + '/' + name), name, type, typeVersion, position: [pos[0] * 260, pos[1] * 200] }, extra);
    this.nodes.push(node); this.byName.set(name, node); return name;
  }
  code(name, file, pos, extra) {
    const s = codeSource(file);
    const params = s.mode === 'each' ? { mode: 'runOnceForEachItem', jsCode: s.code } : { jsCode: s.code };
    return this.add(name, 'n8n-nodes-base.code', 2, params, pos, extra);
  }
  link(from, to, out = 0) {
    if (!this.byName.has(from)) throw new Error('link from unknown node ' + from);
    if (!this.byName.has(to)) throw new Error('link to unknown node ' + to);
    const c = this.connections[from] || (this.connections[from] = { main: [] });
    while (c.main.length <= out) c.main.push([]);
    c.main[out].push({ node: to, type: 'main', index: 0 });
  }
  chain(...names) { for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1]); }
  toJSON(settings) {
    return { name: this.name, nodes: this.nodes, connections: this.connections, active: false, settings, pinData: {},
      meta: { templateCredsSetupCompleted: false }, tags: [] };
  }
}
const SETTINGS = { executionOrder: 'v1', timezone: 'Asia/Kolkata', saveManualExecutions: true, saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'all', saveExecutionProgress: true, callerPolicy: 'workflowsFromSameOwner' };

// IF v2 on a boolean expression (always produces a real boolean).
function ifParams(expr) {
  return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ id: uuid('if/' + expr), leftValue: '={{ ' + expr + ' }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and' }, options: {} };
}
// Switch v3 (rules mode) on a string expression; unmatched items go to `fallback`.
function switchParams(expr, keys, fallback) {
  return {
    rules: { values: keys.map((k) => ({
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: uuid('sw/' + expr + '/' + k), leftValue: '={{ ' + expr + ' }}', rightValue: k, operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and' },
      renameOutput: true, outputKey: k })) },
    options: { fallbackOutput: keys.indexOf(fallback) },
  };
}
function pg(wf, name, query, replacement, pos, extra = {}) {
  const parameters = { operation: 'executeQuery', query, options: replacement ? { queryReplacement: '={{ ' + replacement + ' }}' } : {} };
  return wf.add(name, 'n8n-nodes-base.postgres', 2.5, parameters, pos, Object.assign({ credentials: CRED.postgres }, extra));
}
function http(wf, name, o, pos) {
  const p = { method: o.method || 'GET', url: o.url };
  if (o.cred === 'gemini') Object.assign(p, { authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi' });
  else if (o.cred === 'docs') Object.assign(p, { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDocsOAuth2Api' });
  else if (o.cred === 'dupli') Object.assign(p, { authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth' });
  if (o.headers) Object.assign(p, { sendHeaders: true, headerParameters: { parameters: o.headers.map(([name, value]) => ({ name, value })) } });
  if (o.json) Object.assign(p, { sendBody: true, specifyBody: 'json', jsonBody: '={{ ' + o.json + ' }}' });
  const options = { timeout: o.timeout || 60000 };
  if (o.full) options.response = { response: { fullResponse: true, neverError: true, responseFormat: o.format || 'json' } };
  p.options = options;
  const extra = { onError: 'continueRegularOutput' };
  if (o.retry) Object.assign(extra, { retryOnFail: true, maxTries: o.retry, waitBetweenTries: 5000 });
  if (o.cred) extra.credentials = CRED[o.cred];
  return wf.add(name, 'n8n-nodes-base.httpRequest', 4.2, p, pos, extra);
}
const rl = (value, mode) => ({ __rl: true, value, mode });
function sheetsSchema(cols) { return cols.map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })); }
function sheetsWrite(wf, name, op, docExpr, sheetExpr, match, cols, pos, extra = {}) {
  return wf.add(name, 'n8n-nodes-base.googleSheets', 4.5, {
    authentication: 'oAuth2', resource: 'sheet', operation: op,
    documentId: rl('={{ ' + docExpr + ' }}', 'id'), sheetName: rl('={{ ' + sheetExpr + ' }}', 'name'),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [match], schema: sheetsSchema(cols) },
    // "Ignore it" = fields that are not existing headers are never written,
    // so the existing header rows are never changed.
    options: { handlingExtraData: 'ignoreIt' },
  }, pos, Object.assign({ credentials: CRED.sheets }, extra));
}
function sheetsRead(wf, name, docExpr, sheetExpr, pos) {
  return wf.add(name, 'n8n-nodes-base.googleSheets', 4.5, {
    authentication: 'oAuth2', resource: 'sheet', operation: 'read',
    documentId: rl('={{ ' + docExpr + ' }}', 'id'), sheetName: rl('={{ ' + sheetExpr + ' }}', 'name'), filtersUI: {}, options: {},
  }, pos, { credentials: CRED.sheets, alwaysOutputData: true });
}
const passThrough = '// Pass-through used as a stable reference point for loops (retry / revision / polling).\nreturn { json: $json };\n';
function queue(wf, name, pos) { return wf.add(name, 'n8n-nodes-base.code', 2, { mode: 'runOnceForEachItem', jsCode: passThrough }, pos); }

const KEYWORD_COLS = ['Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Supporting_Keywords', 'Search_Intent', 'Target_Audience', 'Target_Location',
  'Language', 'Priority', 'Status', 'Processing_Started_At', 'Processed_At', 'Last_Error'];
const LOG_COLS = ['Article_ID', 'Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Article_Title', 'SEO_Title', 'Meta_Description', 'URL_Slug',
  'Quality_Status', 'EETA_Report', 'Plagiarism_Percent', 'Plagiarism_Status', 'Plagiarism_Report_URL', 'Attempts', 'Google_Doc_ID', 'Google_Doc_URL',
  'Status', 'Error', 'Created_At', 'Updated_At'];

const SCHEMA_SQL = ['01_pgvector_setup.sql', '02_brand_knowledge_schema.sql', '03_article_processing_history.sql', '04_idempotency_and_recovery.sql']
  .map((f) => fs.readFileSync(path.join(ROOT, 'database', f), 'utf8')).join('\n');
const STICKY = (wf, name, text, pos, w = 520, h = 300) => wf.add(name, 'n8n-nodes-base.stickyNote', 1, { content: text, width: w, height: h }, pos);

// =====================================================================
// Workflow 01 - Brand RAG Ingestion
// =====================================================================
function buildW1() {
  const w = new WF('HR Remedy India - Brand RAG Ingestion', 'w1');
  STICKY(w, 'Read Me', '## HR Remedy India – Brand RAG Ingestion\nReads **approved** rows (Approved = TRUE) from the `Brand_Knowledge` tab, embeds them with **gemini-embedding-001 (768 dims)** and upserts them into PostgreSQL/pgvector.\n\n* Only edit the **Configuration** node.\n* Credentials: SEO PostgreSQL, Google Sheets account, Google Gemini(PaLM) Api.\n* Safe to re-run: unchanged rows are skipped, changed rows are re-embedded, no duplicates are created.', [0, -2], 620, 260);
  w.add('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 0]);
  w.code('Configuration', 'w1/configuration.js', [1, 0]);
  w.code('Validate Configuration', 'w1/validate_configuration.js', [2, 0]);
  pg(w, 'Ensure Database Schema', SCHEMA_SQL, null, [3, 0]);
  pg(w, 'Check Schema & Settings',
    'SELECT s.*, $6::jsonb AS ctx FROM seo_schema_status($1, $2, $3, $4::boolean, $5::jsonb) s',
    "[ $('Validate Configuration').item.json.ctx.config.brand_id, $('Validate Configuration').item.json.ctx.config.spreadsheet_id, $('Validate Configuration').item.json.ctx.config.embedding_model, $('Validate Configuration').item.json.ctx.config.allow_spreadsheet_change, null, JSON.stringify($('Validate Configuration').item.json.ctx) ]", [4, 0]);
  w.code('Verify Schema', 'w1/verify_schema.js', [5, 0]);
  http(w, 'List Gemini Models', { url: "={{ $json.ctx.config.gemini_api_base }}/models?pageSize=1000", cred: 'gemini', retry: 3, timeout: 30000 }, [6, 0]);
  w.code('Verify Embedding Model', 'w1/verify_embedding_model.js', [7, 0]);
  sheetsRead(w, 'Read Brand_Knowledge Sheet', "$('Configuration').first().json.config.spreadsheet_id", "$('Configuration').first().json.config.sheets.brand_knowledge", [8, 0]);
  w.code('Filter Approved Records', 'w1/filter_approved_records.js', [9, 0]);
  w.add('Loop Over Records', 'n8n-nodes-base.splitInBatches', 3, { batchSize: 1, options: {} }, [10, 0]);
  w.code('Validate Each Record', 'w1/validate_each_record.js', [11, 1]);
  w.add('Record Valid?', 'n8n-nodes-base.if', 2, ifParams('$json.valid === true'), [12, 1]);
  pg(w, 'Check Content Hash',
    'SELECT h.action, h.knowledge_id, h.content_hash, h.existing_hash, h.record, $5::jsonb AS ctx FROM seo_brand_check($1, $2::jsonb, $3, $4) h',
    '[ $json.ctx.config.brand_id, JSON.stringify($json.record), $json.ctx.embedding.model, $json.ctx.embedding.dimensions, JSON.stringify($json.ctx) ]', [13, 1]);
  w.add('Needs Embedding?', 'n8n-nodes-base.if', 2, ifParams("$json.action === 'INSERT' || $json.action === 'UPDATE'"), [14, 1]);
  w.code('Build Embedding Request', 'w1/build_embedding_request.js', [15, 1]);
  http(w, 'Generate Embedding', { method: 'POST', url: "={{ $json.ctx.config.gemini_api_base }}/models/{{ $json.ctx.embedding.model }}:embedContent",
    cred: 'gemini', json: 'JSON.stringify($json.embedding_request)', retry: 3, timeout: 60000 }, [16, 1]);
  w.code('Validate Embedding', 'w1/validate_embedding.js', [17, 1]);
  w.add('Embedding Valid?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [18, 1]);
  pg(w, 'Insert or Update Knowledge Record',
    'SELECT * FROM seo_brand_upsert($1, $2::jsonb, $3, $4, $5, $6::jsonb)',
    '[ $json.ctx.config.brand_id, JSON.stringify($json.record), $json.vector, $json.ctx.embedding.model, $json.ctx.embedding.dimensions, JSON.stringify($json.record.metadata) ]', [19, 1]);
  w.code('Verify Database Result', 'w1/verify_database_result.js', [20, 1]);
  w.code('Collect Record Outcome', 'w1/collect_record_outcome.js', [21, 2]);
  w.code('Summarize Ingestion', 'w1/summarize_ingestion.js', [11, -1]);
  pg(w, 'Log Ingestion Outcome',
    'SELECT * FROM seo_brand_finish_ingestion($1, $2, $3, $4::jsonb, $5::jsonb)',
    '[ $json.ctx.config.brand_id, $json.ctx.run.execution_id, $json.ctx.embedding.model, JSON.stringify($json.approved_ids), JSON.stringify($json.summary) ]', [12, -1]);
  w.code('Ingestion Result', 'w1/ingestion_result.js', [13, -1]);

  w.chain('Manual Trigger', 'Configuration', 'Validate Configuration', 'Ensure Database Schema', 'Check Schema & Settings', 'Verify Schema',
    'List Gemini Models', 'Verify Embedding Model', 'Read Brand_Knowledge Sheet', 'Filter Approved Records', 'Loop Over Records');
  w.link('Loop Over Records', 'Summarize Ingestion', 0); // done
  w.link('Loop Over Records', 'Validate Each Record', 1); // loop
  w.link('Validate Each Record', 'Record Valid?');
  w.link('Record Valid?', 'Check Content Hash', 0);
  w.link('Record Valid?', 'Collect Record Outcome', 1);
  w.link('Check Content Hash', 'Needs Embedding?');
  w.link('Needs Embedding?', 'Build Embedding Request', 0);
  w.link('Needs Embedding?', 'Collect Record Outcome', 1);
  w.chain('Build Embedding Request', 'Generate Embedding', 'Validate Embedding', 'Embedding Valid?');
  w.link('Embedding Valid?', 'Insert or Update Knowledge Record', 0);
  w.link('Embedding Valid?', 'Collect Record Outcome', 1);
  w.chain('Insert or Update Knowledge Record', 'Verify Database Result', 'Collect Record Outcome', 'Loop Over Records');
  w.chain('Summarize Ingestion', 'Log Ingestion Outcome', 'Ingestion Result');
  return w.toJSON(SETTINGS);
}

// =====================================================================
// Workflow 02 - SEO Article Automation
// =====================================================================
function buildW2() {
  const w = new WF('HR Remedy India - SEO Article Automation', 'w2');
  const CFG = "$('Configuration').first().json.config";
  const EV = (event, payload) => '[ $json.ctx.job.article_id, $json.ctx.run.execution_id, \'' + event + '\', JSON.stringify(' + payload + '), $json.ctx.config.lease_minutes, JSON.stringify($json.ctx) ]';
  const EVQ = 'SELECT e.lease_ok, e.status AS job_status, e.run_no, e.attempts, e.detail, $6::jsonb AS ctx FROM seo_job_event($1, $2, $3, $4::jsonb, $5) e';

  STICKY(w, 'Read Me', '## HR Remedy India – SEO Article Automation\nOne READY keyword per execution: page analysis → RAG → Gemini prompt → Gemini article → editorial (E-E-A-T-oriented) check → DupliChecker → revise (max 3 attempts) → master Google Doc → Article_Log / Keywords.\n\n* Only edit the **Configuration** node.\n* The daily schedule (08:00 Asia/Kolkata) is **disabled** until a manual test succeeds.\n* Set *Workflow Settings → Error workflow* to **HR Remedy India - Error Recovery**.', [0, -2], 640, 280);
  w.add('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 0]);
  w.add('Daily Schedule 08:00 IST', 'n8n-nodes-base.scheduleTrigger', 1.2,
    { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 8, triggerAtMinute: 0 }] } }, [0, 1], { disabled: true });
  w.code('Configuration', 'w2/configuration.js', [1, 0]);
  w.code('Validate Configuration', 'w2/validate_configuration.js', [2, 0]);
  http(w, 'Check Gemini Models', { url: "={{ $json.ctx.config.gemini_api_base }}/models?pageSize=1000", cred: 'gemini', retry: 3, timeout: 30000 }, [3, 0]);
  w.code('Resolve Gemini Models', 'w2/resolve_gemini_models.js', [4, 0]);
  http(w, 'Check DupliChecker Account', { method: 'POST', url: "={{ $json.ctx.config.duplichecker_api_base }}/info", cred: 'dupli',
    json: 'JSON.stringify({})', full: true, timeout: 30000 }, [5, 0]);
  w.code('Validate DupliChecker Account', 'w2/validate_duplichecker_account.js', [6, 0]);
  pg(w, 'Ensure Database Schema', SCHEMA_SQL, null, [7, 0]);
  const VC = "$('Validate DupliChecker Account').item.json.ctx";
  pg(w, 'Check Schema & Settings',
    'SELECT s.*, $6::jsonb AS ctx FROM seo_schema_status($1, $2, $3, $4::boolean, $5::jsonb) s',
    `[ ${VC}.config.brand_id, ${VC}.config.spreadsheet_id, ${VC}.config.embedding_model, ${VC}.config.allow_spreadsheet_change, ` +
    `JSON.stringify({ spreadsheet_id: ${VC}.config.spreadsheet_id, sheets: ${VC}.config.sheets, timezone: ${VC}.config.timezone, duplichecker_api_base: ${VC}.config.duplichecker_api_base, ` +
    `plagiarism_threshold_percent: ${VC}.config.plagiarism_threshold_percent, plagiarism_max_rephrased_percent: ${VC}.config.plagiarism_max_rephrased_percent, ` +
    `max_attempts: ${VC}.config.max_attempts, brand_id: ${VC}.config.brand_id, updated_by_execution: ${VC}.run.execution_id }), JSON.stringify(${VC}) ]`, [8, 0]);
  w.code('Verify Schema & Settings', 'w2/verify_schema_settings.js', [9, 0]);
  sheetsRead(w, 'Read Keywords Sheet', CFG + '.spreadsheet_id', CFG + '.sheets.keywords', [10, 0]);
  w.code('Validate Target URL and Keyword', 'w2/validate_keywords.js', [11, 0]);
  w.add('Any Valid Keywords?', 'n8n-nodes-base.if', 2, ifParams('$json.candidates.length > 0'), [12, 0]);
  w.code('No Eligible Keywords', 'w2/no_eligible_keywords.js', [13, -1]);
  w.code('Expand Invalid Rows', 'w2/expand_invalid_rows.js', [12, 1]);
  sheetsWrite(w, 'Mark Invalid Keyword Rows', 'update', CFG + '.spreadsheet_id', CFG + '.sheets.keywords', 'row_number', ['row_number'].concat(KEYWORD_COLS), [13, 1], { onError: 'continueRegularOutput' });
  pg(w, 'Claim Processing Record',
    'SELECT c.outcome, c.article_id, c.keyword_id, c.job, c.skipped, c.message, $5::jsonb AS ctx FROM seo_claim_next_job($1::jsonb, $2, $3, $4) c',
    '[ JSON.stringify($json.candidates), $json.ctx.run.execution_id, $json.ctx.config.lease_minutes, $json.ctx.config.max_attempts, JSON.stringify($json.ctx) ]', [13, 0]);
  w.code('Expand Skipped Duplicates', 'w2/expand_skipped_duplicates.js', [14, 1]);
  sheetsWrite(w, 'Mark Skipped Duplicates', 'update', CFG + '.spreadsheet_id', CFG + '.sheets.keywords', 'Keyword_ID', KEYWORD_COLS, [15, 1], { onError: 'continueRegularOutput' });
  w.code('Route Claim Result', 'w2/route_claim_result.js', [14, 0]);
  w.add('Claim Mode', 'n8n-nodes-base.switch', 3, switchParams('$json.mode', ['GENERATE', 'RESUME_DOC', 'RECONCILE', 'NONE'], 'NONE'), [15, 0]);
  w.code('Nothing Claimed', 'w2/nothing_claimed.js', [16, -1]);

  // ---- generation
  w.code('Start Generation', 'w2/start_generation.js', [16, 2]);
  http(w, 'Retrieve Target Website Page', { url: '={{ $json.ctx.keyword.Target_Page_URL }}', full: true, format: 'text', retry: 2, timeout: 30000,
    headers: [['User-Agent', 'Mozilla/5.0 (compatible; HRRemedyIndia-SEO-Automation/1.0; +https://www.hrremedyindia.com/)'], ['Accept', 'text/html,application/xhtml+xml']] }, [17, 2]);
  w.code('Extract Target Page Content', 'w2/extract_target_page.js', [18, 2]);
  w.add('Page Content Usable?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [19, 2]);
  w.code('Build Query Embedding Request', 'w2/build_query_embedding_request.js', [20, 2]);
  http(w, 'Generate Query Embedding', { method: 'POST', url: "={{ $json.ctx.config.gemini_api_base }}/models/{{ $json.ctx.models.embedding_model }}:embedContent",
    cred: 'gemini', json: 'JSON.stringify($json.ctx.embedding_request)', retry: 3, timeout: 60000 }, [21, 2]);
  w.code('Validate Query Embedding', 'w2/validate_query_embedding.js', [22, 2]);
  w.add('Query Embedding OK?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [23, 2]);
  pg(w, 'Retrieve Relevant Brand Context',
    'SELECT seo_brand_retrieve($1, $2, $3, $4, $5, $6::jsonb) AS rag, $7::jsonb AS ctx',
    '[ $json.ctx.config.brand_id, $json.ctx.query_vector, $json.ctx.models.embedding_model, $json.ctx.config.rag_top_k, $json.ctx.config.rag_min_similarity, JSON.stringify($json.ctx.config.rag_always_include_categories), JSON.stringify($json.ctx) ]', [24, 2]);
  w.code('Build Gemini Prompt Input', 'w2/build_gemini_prompt_input.js', [25, 2]);
  w.add('Prompt Input Ready?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [26, 2]);
  queue(w, 'Gemini Call 1 Request', [27, 2]);
  const GEN_URL = "={{ $json.ctx.config.gemini_api_base }}/models/{{ $json.ctx.models.text_model }}:generateContent";
  http(w, 'Gemini Call 1: Create Article-Writing Prompt', { method: 'POST', url: GEN_URL, cred: 'gemini', json: 'JSON.stringify($json.ctx.gemini.request)', retry: 3, timeout: 300000 }, [28, 2]);
  w.code('Validate Prompt Output', 'w2/validate_prompt_output.js', [29, 2]);
  w.add('Prompt Output Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['VALID', 'RETRY', 'FAIL'], 'FAIL'), [30, 2]);
  pg(w, 'Record Prompt Created', EVQ, EV('PROMPT_CREATED', '({ prompt: $json.ctx.prompt })'), [31, 2]);
  w.code('Build Article Request', 'w2/build_article_request.js', [32, 2]);
  queue(w, 'Article Request', [33, 2]);
  w.add('Is Revision?', 'n8n-nodes-base.if', 2, ifParams("$json.ctx.article_kind === 'REVISION'"), [34, 2]);
  http(w, 'Gemini Call 2: Generate Complete Article', { method: 'POST', url: GEN_URL, cred: 'gemini', json: 'JSON.stringify($json.ctx.gemini.request)', retry: 3, timeout: 300000 }, [35, 3]);
  http(w, 'Gemini Article Reviser', { method: 'POST', url: GEN_URL, cred: 'gemini', json: 'JSON.stringify($json.ctx.gemini.request)', retry: 3, timeout: 300000 }, [35, 1]);
  w.code('Validate Article JSON', 'w2/validate_article_json.js', [36, 2]);
  w.add('Article Output Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['VALID', 'RETRY', 'FAIL'], 'FAIL'), [37, 2]);
  pg(w, 'Record Article Attempt', EVQ, EV('ARTICLE_GENERATED',
    '({ attempt_no: $json.ctx.attempt, kind: $json.ctx.article_kind === \'REVISION\' ? \'REVISION\' : \'INITIAL\', article: $json.ctx.article, check_text: $json.ctx.check_text, word_count: $json.ctx.article.Word_Count })'), [38, 2]);
  w.code('Build Editorial Request', 'w2/build_editorial_request.js', [39, 2]);
  queue(w, 'Editorial Request', [40, 2]);
  http(w, 'Gemini Editorial Evaluator', { method: 'POST', url: GEN_URL, cred: 'gemini', json: 'JSON.stringify($json.ctx.gemini.request)', retry: 3, timeout: 300000 }, [41, 2]);
  w.code('Validate Editorial Report', 'w2/validate_editorial_report.js', [42, 2]);
  w.add('Editorial Report Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['VALID', 'RETRY', 'FAIL'], 'FAIL'), [43, 2]);
  w.code('Check Editorial Acceptance Criteria', 'w2/check_editorial_acceptance.js', [44, 2]);
  pg(w, 'Record Editorial Result', EVQ, EV('EDITORIAL_DONE',
    '({ attempt_no: $json.ctx.attempt, overall_status: $json.ctx.editorial.overall_status, passed: $json.ctx.editorial.passed, report: $json.ctx.editorial })'), [45, 2]);
  w.code('Prepare Plagiarism Submission', 'w2/prepare_plagiarism_submission.js', [46, 2]);
  w.add('Within Plagiarism Word Limit?', 'n8n-nodes-base.if', 2, ifParams('$json.submit === true'), [47, 2]);
  http(w, 'Submit Plagiarism Check', { method: 'POST', url: "={{ $json.ctx.config.duplichecker_api_base }}/checkplag", cred: 'dupli',
    json: 'JSON.stringify($json.ctx.plag_request)', full: true, timeout: 120000 }, [48, 2]);
  w.code('Parse Plagiarism Submission', 'w2/parse_plagiarism_submission.js', [49, 2]);
  w.add('Submission Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['SUBMITTED', 'NOT_SUBMITTED'], 'NOT_SUBMITTED'), [50, 2]);
  pg(w, 'Record Plagiarism Submission', EVQ, EV('PLAG_SUBMITTED',
    '({ attempt_no: $json.ctx.attempt, submitted_text: $json.ctx.check_text, provider_hash: $json.ctx.plagiarism.provider_hash, provider_key: $json.ctx.plagiarism.provider_key, word_count: $json.ctx.check_word_count, threshold_percent: $json.ctx.config.plagiarism_threshold_percent, raw: null })'), [51, 1]);
  w.code('Prepare Plagiarism Polling', 'w2/prepare_plagiarism_polling.js', [52, 1]);
  w.add('Needs Polling?', 'n8n-nodes-base.if', 2, ifParams('$json.poll === true'), [53, 1]);
  w.add('Wait Before Poll', 'n8n-nodes-base.wait', 1.1, { amount: '={{ $json.ctx.config.plagiarism_poll_interval_seconds }}', unit: 'seconds' }, [54, 0]);
  http(w, 'Retrieve Completed Plagiarism Report', { url: "={{ $json.ctx.config.duplichecker_api_base }}/query-footprint/{{ encodeURIComponent($json.ctx.plagiarism.provider_hash) }}/{{ encodeURIComponent($json.ctx.plagiarism.provider_key) }}",
    full: true, timeout: 60000 }, [55, 0]);
  w.code('Evaluate Plagiarism Poll', 'w2/evaluate_plagiarism_poll.js', [56, 0]);
  w.add('Poll Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['PENDING', 'DONE'], 'DONE'), [57, 0]);
  w.code('Check Plagiarism Acceptance Criteria', 'w2/check_plagiarism_acceptance.js', [58, 2]);
  pg(w, 'Record Plagiarism Result', EVQ, EV('PLAG_RESULT',
    "({ attempt_no: $json.ctx.attempt, provider_hash: $json.ctx.plagiarism.provider_hash || null, status: ['COMPLETED', 'TIMEOUT'].includes($json.ctx.plagiarism.status) ? $json.ctx.plagiarism.status : 'FAILED', poll_count: $json.ctx.plagiarism.poll_count, plag_percent: $json.ctx.plagiarism.plag_percent ?? null, unique_percent: $json.ctx.plagiarism.unique_percent ?? null, rephrased_percent: $json.ctx.plagiarism.rephrased_percent ?? null, exact_percent: $json.ctx.plagiarism.exact_percent ?? null, passed: $json.ctx.plagiarism.passed === true, error: $json.ctx.plagiarism.error || null, result: { matches: $json.ctx.plagiarism.matches || [], reasons: $json.ctx.plagiarism.reasons || [], report_reference: $json.ctx.plagiarism.report_reference || '' } })"), [59, 2]);
  w.code('Pass / Revise / Human Review Decision', 'w2/decide_pass_revise_review.js', [60, 2]);
  pg(w, 'Record Decision', EVQ, EV('DECISION', '({ attempt_no: $json.ctx.attempt, decision: $json.ctx.decision.decision, reasons: $json.ctx.decision.reasons })'), [61, 2]);
  w.add('Decision Route', 'n8n-nodes-base.switch', 3, switchParams('$json.ctx.decision.decision', ['APPROVE', 'REVISE', 'REVIEW'], 'REVIEW'), [62, 2]);
  w.code('Build Revision Request', 'w2/build_revision_request.js', [63, 4]);

  // ---- approval & Google Docs
  w.code('Prepare Resumed Approval', 'w2/prepare_resumed_approval.js', [62, 6]);
  w.code('Format Approved Article', 'w2/format_approved_article.js', [63, 2]);
  pg(w, 'Record Approval Ready', EVQ, EV('APPROVAL_READY', '({ attempt_no: $json.ctx.attempt, approval_payload: $json.ctx.approval_payload })'), [64, 2]);
  pg(w, 'Load Master Doc Setting', "SELECT seo_get_setting('master_doc') AS master_doc, $1::boolean AS lease_ok, $2::jsonb AS ctx", '[ $json.lease_ok, JSON.stringify($json.ctx) ]', [65, 2]);
  w.code('Plan Master Doc Access', 'w2/plan_master_doc_access.js', [66, 2]);
  w.add('Master Doc Known?', 'n8n-nodes-base.if', 2, ifParams('$json.known === true'), [67, 2]);
  queue(w, 'Master Doc Request', [68, 2]);
  http(w, 'Fetch Master Doc', { url: "={{ $json.ctx.config.docs_api_base }}/documents/{{ $json.ctx.doc.doc_id }}", cred: 'docs', full: true, retry: 2, timeout: 60000 }, [69, 2]);
  w.code('Inspect Master Doc', 'w2/inspect_master_doc.js', [70, 2]);
  w.add('Master Doc Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['MARKER_PRESENT', 'APPEND', 'CREATE', 'FAIL'], 'FAIL'), [71, 2]);
  w.code('Create Master Doc Request', 'w2/create_master_doc_request.js', [68, 4]);
  http(w, 'Create Master Google Doc', { method: 'POST', url: "={{ $json.ctx.config.docs_api_base }}/documents", cred: 'docs',
    json: 'JSON.stringify({ title: $json.ctx.doc.new_title })', full: true, timeout: 60000 }, [69, 4]);
  w.code('Check Created Master Doc', 'w2/check_created_master_doc.js', [70, 4]);
  w.add('Master Doc Created?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [71, 4]);
  pg(w, 'Save Master Doc ID', 'SELECT m.won, m.master_doc, $3::jsonb AS ctx FROM seo_set_master_doc($1, $2::jsonb) m',
    "[ $json.ctx.doc.previous_doc_id || '', JSON.stringify($json.ctx.doc.stored), JSON.stringify($json.ctx) ]", [72, 4]);
  w.code('Use Stored Master Doc', 'w2/use_stored_master_doc.js', [73, 4]);
  pg(w, 'Record Doc Write Pending', EVQ, EV('DOC_WRITE_PENDING', '({ doc_id: $json.ctx.doc.doc_id })'), [72, 2]);
  w.code('Build Docs Append Request', 'w2/build_docs_append_request.js', [73, 2]);
  w.add('Append Request Ready?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [74, 2]);
  http(w, 'Append Approved Article', { method: 'POST', url: "={{ $json.ctx.config.docs_api_base }}/documents/{{ $json.ctx.doc.doc_id }}:batchUpdate", cred: 'docs',
    json: 'JSON.stringify($json.ctx.docs_request)', full: true, timeout: 120000 }, [75, 2]);
  w.code('Check Append Response', 'w2/check_append_response.js', [76, 2]);
  w.add('Append Accepted?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [77, 2]);
  http(w, 'Verify Document Write', { url: "={{ $json.ctx.config.docs_api_base }}/documents/{{ $json.ctx.doc.doc_id }}", cred: 'docs', full: true, retry: 3, timeout: 60000 }, [78, 2]);
  w.code('Confirm Marker In Document', 'w2/confirm_marker_in_document.js', [79, 2]);
  w.add('Document Write Verified?', 'n8n-nodes-base.if', 2, ifParams('$json.ok === true'), [80, 2]);
  pg(w, 'Record Document Verified', EVQ, EV('DOC_VERIFIED', "({ doc_id: $json.ctx.doc.doc_id, doc_url: 'https://docs.google.com/document/d/' + $json.ctx.doc.doc_id + '/edit' })"), [81, 2]);
  pg(w, 'Finalize Approved Job', EVQ, EV('FINALIZE', "({ final_status: 'APPROVED', quality_status: 'PASS' })"), [82, 2]);

  // ---- terminal & sheets
  w.code('Prepare Unapproved Outcome', 'w2/prepare_unapproved_outcome.js', [81, 6]);
  pg(w, 'Finalize Unapproved Job', EVQ, EV('FINALIZE', '$json.ctx.finalize_payload'), [82, 6]);
  w.code('Prepare Reconcile', 'w2/prepare_reconcile.js', [82, 8]);
  w.code('Prepare Sheet Updates', 'w2/prepare_sheet_updates.js', [83, 4]);
  w.code('Article_Log Row', 'w2/article_log_row.js', [84, 4]);
  sheetsWrite(w, 'Update Article_Log', 'appendOrUpdate', CFG + '.spreadsheet_id', CFG + '.sheets.article_log', 'Article_ID', LOG_COLS, [85, 4], { onError: 'continueRegularOutput' });
  w.code('Keywords Final Row', 'w2/keywords_final_row.js', [86, 4]);
  sheetsWrite(w, 'Update Keywords Status', 'update', CFG + '.spreadsheet_id', CFG + '.sheets.keywords', 'Keyword_ID', KEYWORD_COLS, [87, 4], { onError: 'continueRegularOutput' });
  pg(w, 'Mark Final Processing Result',
    "SELECT e.lease_ok, e.status, e.detail FROM seo_job_event($1, $2, 'SHEETS_SYNCED', $3::jsonb, $4) e",
    "[ $('Prepare Sheet Updates').item.json.ctx.job.article_id, $('Prepare Sheet Updates').item.json.ctx.run.execution_id, JSON.stringify({ keywords: !$json.error, article_log: $('Keywords Final Row').item.json._article_log_ok === true }), $('Prepare Sheet Updates').item.json.ctx.config.lease_minutes ]", [88, 4]);
  w.code('Final Result', 'w2/final_result.js', [89, 4]);

  // Inline progress update: Status Row -> Sheet Status -> Continue After (restores the item).
  const progress = (stage, from, to, pos) => {
    const row = 'Status Row: ' + stage, sheet = 'Sheet Status: ' + stage, cont = 'Continue After ' + stage;
    w.code(row, 'w2/status_row.js', [pos[0], pos[1] + 1]);
    sheetsWrite(w, sheet, 'update', CFG + '.spreadsheet_id', CFG + '.sheets.keywords', 'Keyword_ID', KEYWORD_COLS, [pos[0] + 0.5, pos[1] + 2], { onError: 'continueRegularOutput' });
    w.add(cont, 'n8n-nodes-base.code', 2, { mode: 'runOnceForEachItem', jsCode:
      "// Restores the main-line item after the best-effort progress update (also when the Sheets write failed).\n" +
      "let pass = null;\ntry { pass = $('" + row + "').item.json._pass; } catch (e) { pass = null; }\n" +
      "if (!pass) pass = $('" + row + "').first().json._pass;\nreturn { json: pass };\n" }, [pos[0] + 1, pos[1] + 1]);
    w.chain(from, row, sheet, cont, to);
  };
  // ---- connections
  w.link('Manual Trigger', 'Configuration');
  w.link('Daily Schedule 08:00 IST', 'Configuration');
  w.chain('Configuration', 'Validate Configuration', 'Check Gemini Models', 'Resolve Gemini Models', 'Check DupliChecker Account', 'Validate DupliChecker Account',
    'Ensure Database Schema', 'Check Schema & Settings', 'Verify Schema & Settings', 'Read Keywords Sheet', 'Validate Target URL and Keyword', 'Any Valid Keywords?');
  w.link('Validate Target URL and Keyword', 'Expand Invalid Rows');
  w.link('Expand Invalid Rows', 'Mark Invalid Keyword Rows');
  w.link('Any Valid Keywords?', 'Claim Processing Record', 0);
  w.link('Any Valid Keywords?', 'No Eligible Keywords', 1);
  w.link('Claim Processing Record', 'Expand Skipped Duplicates');
  w.link('Expand Skipped Duplicates', 'Mark Skipped Duplicates');
  w.link('Claim Processing Record', 'Route Claim Result');
  w.link('Route Claim Result', 'Claim Mode');
  w.link('Claim Mode', 'Start Generation', 0);
  w.link('Claim Mode', 'Prepare Resumed Approval', 1);
  w.link('Claim Mode', 'Prepare Reconcile', 2);
  w.link('Claim Mode', 'Nothing Claimed', 3);
  progress('PROCESSING', 'Start Generation', 'Retrieve Target Website Page', [16, 2]);
  w.chain('Retrieve Target Website Page', 'Extract Target Page Content', 'Page Content Usable?');
  w.link('Page Content Usable?', 'Build Query Embedding Request', 0);
  w.link('Page Content Usable?', 'Prepare Unapproved Outcome', 1);
  w.chain('Build Query Embedding Request', 'Generate Query Embedding', 'Validate Query Embedding', 'Query Embedding OK?');
  w.link('Query Embedding OK?', 'Retrieve Relevant Brand Context', 0);
  w.link('Query Embedding OK?', 'Prepare Unapproved Outcome', 1);
  w.chain('Retrieve Relevant Brand Context', 'Build Gemini Prompt Input', 'Prompt Input Ready?');
  w.link('Prompt Input Ready?', 'Gemini Call 1 Request', 0);
  w.link('Prompt Input Ready?', 'Prepare Unapproved Outcome', 1);
  w.chain('Gemini Call 1 Request', 'Gemini Call 1: Create Article-Writing Prompt', 'Validate Prompt Output', 'Prompt Output Route');
  w.link('Prompt Output Route', 'Record Prompt Created', 0);
  w.link('Prompt Output Route', 'Gemini Call 1 Request', 1);
  w.link('Prompt Output Route', 'Prepare Unapproved Outcome', 2);
  progress('PROMPT_CREATED', 'Record Prompt Created', 'Build Article Request', [31, 2]);
  w.chain('Build Article Request', 'Article Request', 'Is Revision?');
  w.link('Is Revision?', 'Gemini Article Reviser', 0);
  w.link('Is Revision?', 'Gemini Call 2: Generate Complete Article', 1);
  w.link('Gemini Article Reviser', 'Validate Article JSON');
  w.link('Gemini Call 2: Generate Complete Article', 'Validate Article JSON');
  w.link('Validate Article JSON', 'Article Output Route');
  w.link('Article Output Route', 'Record Article Attempt', 0);
  w.link('Article Output Route', 'Article Request', 1);
  w.link('Article Output Route', 'Prepare Unapproved Outcome', 2);
  progress('ARTICLE_GENERATED', 'Record Article Attempt', 'Build Editorial Request', [38, 2]);
  progress('QUALITY_REVIEW', 'Build Editorial Request', 'Editorial Request', [39, 2]);
  w.chain('Editorial Request', 'Gemini Editorial Evaluator', 'Validate Editorial Report', 'Editorial Report Route');
  w.link('Editorial Report Route', 'Check Editorial Acceptance Criteria', 0);
  w.link('Editorial Report Route', 'Editorial Request', 1);
  w.link('Editorial Report Route', 'Prepare Unapproved Outcome', 2);
  w.chain('Check Editorial Acceptance Criteria', 'Record Editorial Result', 'Prepare Plagiarism Submission');
  progress('PLAGIARISM_CHECK', 'Prepare Plagiarism Submission', 'Within Plagiarism Word Limit?', [46, 2]);
  w.link('Within Plagiarism Word Limit?', 'Submit Plagiarism Check', 0);
  w.link('Within Plagiarism Word Limit?', 'Check Plagiarism Acceptance Criteria', 1);
  w.chain('Submit Plagiarism Check', 'Parse Plagiarism Submission', 'Submission Route');
  w.link('Submission Route', 'Record Plagiarism Submission', 0);
  w.link('Submission Route', 'Check Plagiarism Acceptance Criteria', 1);
  w.chain('Record Plagiarism Submission', 'Prepare Plagiarism Polling', 'Needs Polling?');
  w.link('Needs Polling?', 'Wait Before Poll', 0);
  w.link('Needs Polling?', 'Check Plagiarism Acceptance Criteria', 1);
  w.chain('Wait Before Poll', 'Retrieve Completed Plagiarism Report', 'Evaluate Plagiarism Poll', 'Poll Route');
  w.link('Poll Route', 'Wait Before Poll', 0);
  w.link('Poll Route', 'Check Plagiarism Acceptance Criteria', 1);
  w.chain('Check Plagiarism Acceptance Criteria', 'Record Plagiarism Result', 'Pass / Revise / Human Review Decision', 'Record Decision', 'Decision Route');
  w.link('Decision Route', 'Format Approved Article', 0);
  w.link('Decision Route', 'Build Revision Request', 1);
  w.link('Decision Route', 'Prepare Unapproved Outcome', 2);
  progress('REVISION_REQUIRED', 'Build Revision Request', 'Article Request', [63, 4]);
  w.link('Prepare Resumed Approval', 'Format Approved Article');
  w.chain('Format Approved Article', 'Record Approval Ready', 'Load Master Doc Setting', 'Plan Master Doc Access', 'Master Doc Known?');
  w.link('Master Doc Known?', 'Master Doc Request', 0);
  w.link('Master Doc Known?', 'Create Master Doc Request', 1);
  w.chain('Master Doc Request', 'Fetch Master Doc', 'Inspect Master Doc', 'Master Doc Route');
  w.link('Master Doc Route', 'Record Document Verified', 0);
  w.link('Master Doc Route', 'Record Doc Write Pending', 1);
  w.link('Master Doc Route', 'Create Master Doc Request', 2);
  w.link('Master Doc Route', 'Prepare Unapproved Outcome', 3);
  w.chain('Create Master Doc Request', 'Create Master Google Doc', 'Check Created Master Doc', 'Master Doc Created?');
  w.link('Master Doc Created?', 'Save Master Doc ID', 0);
  w.link('Master Doc Created?', 'Prepare Unapproved Outcome', 1);
  w.chain('Save Master Doc ID', 'Use Stored Master Doc', 'Master Doc Request');
  w.chain('Record Doc Write Pending', 'Build Docs Append Request', 'Append Request Ready?');
  w.link('Append Request Ready?', 'Append Approved Article', 0);
  w.link('Append Request Ready?', 'Prepare Unapproved Outcome', 1);
  w.chain('Append Approved Article', 'Check Append Response', 'Append Accepted?');
  w.link('Append Accepted?', 'Verify Document Write', 0);
  w.link('Append Accepted?', 'Prepare Unapproved Outcome', 1);
  w.chain('Verify Document Write', 'Confirm Marker In Document', 'Document Write Verified?');
  w.link('Document Write Verified?', 'Record Document Verified', 0);
  w.link('Document Write Verified?', 'Prepare Unapproved Outcome', 1);
  w.chain('Record Document Verified', 'Finalize Approved Job', 'Prepare Sheet Updates');
  w.chain('Prepare Unapproved Outcome', 'Finalize Unapproved Job', 'Prepare Sheet Updates');
  w.link('Prepare Reconcile', 'Prepare Sheet Updates');
  w.chain('Prepare Sheet Updates', 'Article_Log Row', 'Update Article_Log', 'Keywords Final Row', 'Update Keywords Status', 'Mark Final Processing Result', 'Final Result');
  // Canvas layout only (no effect on execution): wrap the long flow into four labelled lanes.
  const LANES = [[0, 16, '1. Setup, validation and claim'], [16, 38, '2. Page analysis, RAG and Gemini call 1 (prompt)'],
    [38, 62, '3. Article, editorial check, DupliChecker and revision loop'], [62, 95, '4. Approval gate, Google Docs and Google Sheets']];
  for (const n of w.nodes) {
    const col = n.position[0] / 260;
    const lane = LANES.findIndex(([from, to]) => col >= from && col < to);
    n.position = [Math.round((col - LANES[lane][0]) * 260), n.position[1] + lane * 2600];
  }
  LANES.forEach(([from, to, title], i) => { if (i > 0) STICKY(w, 'Lane ' + (i + 1), '## ' + title, [0, i * 13 - 3], 900, 120); });
  return w.toJSON(SETTINGS);
}

// =====================================================================
// Workflow 02 variant - Gemini originality review instead of DupliChecker
// =====================================================================
// Built FROM the original graph: every node not listed below is identical.
const W2G_REMOVED = ['Check DupliChecker Account', 'Validate DupliChecker Account', 'Prepare Plagiarism Submission',
  'Within Plagiarism Word Limit?', 'Submit Plagiarism Check', 'Parse Plagiarism Submission', 'Submission Route',
  'Record Plagiarism Submission', 'Prepare Plagiarism Polling', 'Needs Polling?', 'Wait Before Poll',
  'Retrieve Completed Plagiarism Report', 'Evaluate Plagiarism Poll', 'Poll Route', 'Check Plagiarism Acceptance Criteria',
  'Record Plagiarism Result', 'Finalize Approved Job'];
function buildW2Gemini() {
  const base = buildW2();
  const w = new WF('HR Remedy India - SEO Article Automation (Gemini Originality Review)', 'w2g');
  const posOf = (n) => base.nodes.find((x) => x.name === n).position;
  const removedPos = Object.fromEntries(W2G_REMOVED.map((n) => [n, posOf(n)]));
  for (const n of base.nodes) if (!W2G_REMOVED.includes(n.name)) { w.nodes.push(n); w.byName.set(n.name, n); }
  for (const [from, c] of Object.entries(base.connections)) {
    if (W2G_REMOVED.includes(from) || ['Record Editorial Result', 'Record Document Verified', 'Resolve Gemini Models', 'Continue After PLAGIARISM_CHECK'].includes(from)) continue;
    w.connections[from] = { main: c.main.map((ts) => ts.filter((t) => !W2G_REMOVED.includes(t.node) && t.node !== 'Status Row: PLAGIARISM_CHECK')) };
  }
  const setCode = (name, file) => { const s = codeSource(file); w.byName.get(name).parameters = s.mode === 'each' ? { mode: 'runOnceForEachItem', jsCode: s.code } : { jsCode: s.code }; };
  const at = (name, px) => { w.byName.get(name).position = [px[0], px[1]]; };
  const EV = (event, payload) => '[ $json.ctx.job.article_id, $json.ctx.run.execution_id, \'' + event + '\', JSON.stringify(' + payload + '), $json.ctx.config.lease_minutes, JSON.stringify($json.ctx) ]';
  const EVQ = 'SELECT e.lease_ok, e.status AS job_status, e.run_no, e.attempts, e.detail, $6::jsonb AS ctx FROM seo_job_event($1, $2, $3, $4::jsonb, $5) e';

  // Configuration without DupliChecker; review document instead of the approved library.
  setCode('Configuration', 'w2g/configuration.js');
  setCode('Validate Configuration', 'w2g/validate_configuration.js');
  const css = w.byName.get('Check Schema & Settings');
  let qr = css.parameters.options.queryReplacement.split("$('Validate DupliChecker Account')").join("$('Resolve Gemini Models')");
  const VC = "$('Resolve Gemini Models').item.json.ctx";
  qr = qr.replace('duplichecker_api_base: ' + VC + '.config.duplichecker_api_base, ', '')
    .replace('plagiarism_threshold_percent: ' + VC + '.config.plagiarism_threshold_percent, plagiarism_max_rephrased_percent: ' + VC + '.config.plagiarism_max_rephrased_percent, ',
      'originality_reviewer: ' + VC + '.config.originality_reviewer, external_plagiarism_check_performed: false, ');
  if (/duplichecker|plagiarism_threshold/i.test(qr)) throw new Error('runtime config still references DupliChecker');
  css.parameters.options.queryReplacement = qr;
  w.byName.get('Load Master Doc Setting').parameters = { operation: 'executeQuery',
    query: 'SELECT seo_get_setting($3) AS master_doc, $1::boolean AS lease_ok, $2::jsonb AS ctx',
    options: { queryReplacement: '={{ [ $json.lease_ok, JSON.stringify($json.ctx), $json.ctx.config.doc_setting_key ] }}' } };
  w.byName.get('Save Master Doc ID').parameters = { operation: 'executeQuery',
    query: 'SELECT m.won, m.master_doc, $4::jsonb AS ctx FROM seo_set_doc_setting($1, $2, $3::jsonb) m',
    options: { queryReplacement: "={{ [ $json.ctx.config.doc_setting_key, $json.ctx.doc.previous_doc_id || '', JSON.stringify($json.ctx.doc.stored), JSON.stringify($json.ctx) ] }}" } };
  w.byName.get('Read Me').parameters.content = '## HR Remedy India – SEO Article Automation (Gemini originality review)\nOne READY keyword per execution: page analysis → RAG → Gemini prompt → Gemini article → E-E-A-T editorial check → **Gemini originality review** (AI review only, no plagiarism percentage, no external database) → revise (max 3 attempts) → document **"Pending Human Review"** → Article_Log / Keywords.\n\n* No DupliChecker credential is needed.\n* Articles that pass every check end as **REVIEW_REQUIRED** (human review before publication), never APPROVED automatically.\n* Only edit the **Configuration** node. Schedule disabled by default. Error workflow: **HR Remedy India - Error Recovery** (publish it on n8n 2.x).';
  w.byName.get('Lane 3').parameters.content = '## 3. Article, editorial check, Gemini originality review and revision loop';
  w.byName.get('Lane 4').parameters.content = '## 4. Approval gate, pending-human-review Google Doc and Google Sheets';

  // New nodes, placed where the removed plagiarism nodes were.
  const P = (n) => removedPos[n];
  w.code('Build Originality Review Request', 'w2g/build_originality_review_request.js', [0, 0]); at('Build Originality Review Request', P('Prepare Plagiarism Submission'));
  pg(w, 'Record Originality Review Start', EVQ, EV('PLAG_SUBMITTED',
    '({ attempt_no: $json.ctx.attempt, submitted_text: $json.ctx.check_text, provider: $json.ctx.plagiarism.provider, provider_hash: $json.ctx.plagiarism.provider_hash, provider_key: null, word_count: $json.ctx.check_word_count, threshold_percent: null, raw: null })'), [0, 0]);
  at('Record Originality Review Start', P('Record Plagiarism Submission'));
  w.code('Originality Review Request', 'w2g/originality_review_request.js', [0, 0]); at('Originality Review Request', P('Within Plagiarism Word Limit?'));
  const GEN_URL = "={{ $json.ctx.config.gemini_api_base }}/models/{{ $json.ctx.models.text_model }}:generateContent";
  http(w, 'Gemini Originality Review', { method: 'POST', url: GEN_URL, cred: 'gemini', json: 'JSON.stringify($json.ctx.gemini.request)', retry: 3, timeout: 300000 }, [0, 0]);
  at('Gemini Originality Review', P('Submit Plagiarism Check'));
  w.code('Validate Originality Review', 'w2g/validate_originality_review.js', [0, 0]); at('Validate Originality Review', P('Parse Plagiarism Submission'));
  w.add('Originality Review Route', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['VALID', 'RETRY', 'FAIL'], 'FAIL'), [0, 0]);
  at('Originality Review Route', P('Submission Route'));
  w.code('Check Originality Acceptance Criteria', 'w2g/check_originality_acceptance.js', [0, 0]); at('Check Originality Acceptance Criteria', P('Check Plagiarism Acceptance Criteria'));
  pg(w, 'Record Originality Result', EVQ, EV('PLAG_RESULT',
    "({ attempt_no: $json.ctx.attempt, provider: $json.ctx.plagiarism.provider, provider_hash: $json.ctx.plagiarism.provider_hash, status: 'COMPLETED', result_label: $json.ctx.plagiarism.result_label, review_status: $json.ctx.plagiarism.review_status, plag_percent: null, passed: $json.ctx.plagiarism.passed === true, error: null, result: { originality: $json.ctx.plagiarism.originality, reasons: $json.ctx.plagiarism.reasons } })"), [0, 0]);
  at('Record Originality Result', P('Record Plagiarism Result'));
  w.code('Require Human Review', 'w2g/require_human_review.js', [0, 0]);
  const fin = P('Finalize Approved Job');
  at('Require Human Review', [fin[0], fin[1] - 200]);
  pg(w, 'Finalize Pending Human Review', EVQ, EV('FINALIZE', '$json.ctx.finalize_payload'), [0, 0]); at('Finalize Pending Human Review', fin);

  // Connections
  w.link('Resolve Gemini Models', 'Ensure Database Schema');
  w.chain('Record Editorial Result', 'Build Originality Review Request', 'Status Row: PLAGIARISM_CHECK');
  w.chain('Continue After PLAGIARISM_CHECK', 'Record Originality Review Start', 'Originality Review Request', 'Gemini Originality Review',
    'Validate Originality Review', 'Originality Review Route');
  w.link('Originality Review Route', 'Check Originality Acceptance Criteria', 0);
  w.link('Originality Review Route', 'Originality Review Request', 1);
  w.link('Originality Review Route', 'Prepare Unapproved Outcome', 2);
  w.chain('Check Originality Acceptance Criteria', 'Record Originality Result', 'Pass / Revise / Human Review Decision');
  w.chain('Record Document Verified', 'Require Human Review', 'Finalize Pending Human Review', 'Prepare Sheet Updates');
  for (const [from, c] of Object.entries(w.connections)) { c.main = c.main.map((ts) => ts); if (c.main.every((ts) => !ts.length)) delete w.connections[from]; }
  return w.toJSON(SETTINGS);
}

// =====================================================================
// Workflow 03 - Error Recovery
// =====================================================================
function buildW3() {
  const w = new WF('HR Remedy India - Error Recovery', 'w3');
  STICKY(w, 'Read Me', '## HR Remedy India – Error Recovery\n* **Error Trigger**: select this workflow as the *Error workflow* in the settings of "HR Remedy India - SEO Article Automation". Production (scheduled) failures are recorded and the job owned by the failed execution is released (bounded auto-retry, permanent errors are not retried, articles already in Google Docs are reconciled instead of regenerated).\n* **Recovery sweep** (manual, or enable the 30-minute schedule): releases expired leases only, reconciles sheet rows, and collects timed-out DupliChecker reports via the documented callback.\n* n8n does not run error workflows for manual test executions; use the sweep.', [0, -2], 700, 300);
  // The manual sweep is the first trigger in the file so that `n8n execute`
  // (which starts at the first trigger) runs the sweep, not the Error Trigger.
  w.add('Manual Recovery Sweep', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 2]);
  w.add('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, {}, [0, 0]);
  w.code('Extract Failure Context', 'w3/extract_failure_context.js', [1, 0]);
  pg(w, 'Record Execution Failure',
    "SELECT r.*, seo_get_setting('runtime_config') AS runtime_config FROM seo_record_execution_error($1, $2, $3, $4, $5, $6, $7) r",
    '[ $json.execution_id, $json.workflow_id, $json.workflow_name, $json.mode, $json.last_node, $json.error_message, 3 ]', [2, 0]);
  w.add('Every 30 Minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } }, [0, 3], { disabled: true });
  w.code('Recovery Sweep Settings', 'w3/sweep_settings.js', [1, 2]);
  pg(w, 'Run Recovery Sweep',
    "SELECT s.*, seo_get_setting('runtime_config') AS runtime_config FROM seo_recovery_sweep($1, $2, $3, $4) s",
    '[ $json.settings.owner, $json.settings.grace_minutes, $json.settings.max_recovery_attempts, $json.settings.plagiarism_hash_valid_hours ]', [2, 2], { alwaysOutputData: true });
  w.code('Normalize Recovery Item', 'w3/normalize_recovery_item.js', [3, 1]);
  w.add('Route Recovery Action', 'n8n-nodes-base.switch', 3, switchParams('$json.route', ['SYNC_SHEETS', 'KEYWORD_STATUS', 'REPOLL', 'NONE'], 'NONE'), [4, 1]);
  w.code('No Recovery Needed', 'w3/no_recovery_needed.js', [5, 3]);
  // sync sheets
  w.code('Build Reconciliation Rows', 'w3/build_reconciliation_rows.js', [5, -1]);
  w.code('Reconcile Article_Log Row', 'w3/reconcile_article_log_row.js', [6, -1]);
  sheetsWrite(w, 'Reconcile Article_Log', 'appendOrUpdate', '$json._spreadsheet_id', '$json._sheet', 'Article_ID', LOG_COLS, [7, -1], { onError: 'continueRegularOutput' });
  w.code('Reconcile Keywords Row', 'w3/reconcile_keywords_row.js', [8, -1]);
  sheetsWrite(w, 'Reconcile Keywords Status', 'update', '$json._spreadsheet_id', '$json._sheet', 'Keyword_ID', KEYWORD_COLS, [9, -1], { onError: 'continueRegularOutput' });
  pg(w, 'Mark Reconciled', "SELECT e.lease_ok, e.article_id, e.status, e.detail FROM seo_job_event($1, $2, 'SHEETS_SYNCED', $3::jsonb, 20) e",
    "[ $('Build Reconciliation Rows').item.json.article_id, $('Build Reconciliation Rows').item.json.owner, JSON.stringify({ keywords: !$json.error, article_log: $('Reconcile Keywords Row').item.json._article_log_ok === true }) ]", [10, -1]);
  // keyword status (retry / error / recovered report)
  w.code('Build Keyword Status Row', 'w3/build_keyword_status_row.js', [6, 1]);
  sheetsWrite(w, 'Update Keyword Status', 'update', '$json._spreadsheet_id', '$json._sheet', 'Keyword_ID', KEYWORD_COLS, [7, 1], { onError: 'continueRegularOutput' });
  pg(w, 'Mark Keyword Status Synced', "SELECT e.lease_ok, e.article_id, e.status, e.detail FROM seo_job_event($1, $2, 'SHEETS_SYNCED', $3::jsonb, 20) e",
    "[ $('Build Keyword Status Row').item.json._article_id, 'recovery-' + $execution.id, JSON.stringify({ keywords: !$json.error, article_log: false }) ]", [8, 1]);
  // re-poll timed-out plagiarism report
  http(w, 'Poll Recovered Plagiarism Report', { url: "={{ $json.runtime_config.duplichecker_api_base }}/query-footprint/{{ encodeURIComponent($json.plagiarism.provider_hash) }}/{{ encodeURIComponent($json.plagiarism.provider_key) }}",
    full: true, timeout: 60000 }, [5, 2]);
  w.code('Evaluate Recovered Report', 'w3/evaluate_recovered_report.js', [6, 2]);
  pg(w, 'Apply Recovered Report',
    'SELECT r.action, r.sheet_status, r.sheet_last_error, r.job, $1 AS article_id, $5 AS keyword_id, $6::jsonb AS runtime_config FROM seo_recovery_plagiarism_result($1, $2, $3, $4::jsonb) r',
    '[ $json.article_id, $json.plagiarism.check_id, $json.plagiarism.provider_hash, JSON.stringify($json.recovered_result), $json.keyword_id, JSON.stringify($json.runtime_config) ]', [7, 2]);
  w.add('Sheet Update Needed?', 'n8n-nodes-base.if', 2, ifParams("!!$json.sheet_status"), [8, 2]);
  w.code('Recovery Result', 'w3/recovery_result.js', [11, 0]);

  w.chain('Error Trigger', 'Extract Failure Context', 'Record Execution Failure', 'Normalize Recovery Item');
  w.chain('Manual Recovery Sweep', 'Recovery Sweep Settings');
  w.link('Every 30 Minutes', 'Recovery Sweep Settings');
  w.chain('Recovery Sweep Settings', 'Run Recovery Sweep', 'Normalize Recovery Item', 'Route Recovery Action');
  w.link('Route Recovery Action', 'Build Reconciliation Rows', 0);
  w.link('Route Recovery Action', 'Build Keyword Status Row', 1);
  w.link('Route Recovery Action', 'Poll Recovered Plagiarism Report', 2);
  w.link('Route Recovery Action', 'No Recovery Needed', 3);
  w.chain('Build Reconciliation Rows', 'Reconcile Article_Log Row', 'Reconcile Article_Log', 'Reconcile Keywords Row', 'Reconcile Keywords Status', 'Mark Reconciled', 'Recovery Result');
  w.chain('Build Keyword Status Row', 'Update Keyword Status', 'Mark Keyword Status Synced', 'Recovery Result');
  w.chain('Poll Recovered Plagiarism Report', 'Evaluate Recovered Report', 'Apply Recovered Report', 'Sheet Update Needed?');
  w.link('Sheet Update Needed?', 'Build Keyword Status Row', 0);
  w.link('Sheet Update Needed?', 'No Recovery Needed', 1);
  return w.toJSON(SETTINGS);
}

fs.mkdirSync(OUT, { recursive: true });
const outputs = [['01_Brand_RAG_Ingestion.json', buildW1()], ['02_SEO_Article_Automation.json', buildW2()], ['03_Error_Recovery.json', buildW3()],
  ['02_SEO_Article_Automation_Gemini_Review.json', buildW2Gemini()]];
for (const [file, wf] of outputs) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(wf, null, 2) + '\n');
  console.log('wrote workflows/' + file + ' (' + wf.nodes.length + ' nodes)');
}
