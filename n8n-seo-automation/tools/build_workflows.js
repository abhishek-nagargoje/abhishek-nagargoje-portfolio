#!/usr/bin/env node
// Builds the importable n8n workflow exports in workflows/ from:
//   tools/code/**   Code-node sources (+ tools/code/lib shared, unit-tested helpers)
//   prompts/*.md    system instructions (text between the BEGIN/END markers)
//   tools/schemas.js Gemini responseSchema objects
// Usage: node tools/build_workflows.js
const fs = require('fs');
const path = require('path');
const { ROOT, readPromptSection, loadCode, Workflow, P, code, pg, http, ifNode, switchNode, setTag, sheets, sticky } = require('./lib/n8n');
const SCHEMAS = require('./schemas');

const REPL = {
  __PROMPT_01__: readPromptSection('01_Gemini_Prompt_Creator.md'),
  __PROMPT_02__: readPromptSection('02_Gemini_Article_Writer.md'),
  __PROMPT_03__: readPromptSection('03_Gemini_EETA_Evaluator.md'),
  __PROMPT_04__: readPromptSection('04_Gemini_Article_Reviser.md'),
  __POLICY__: readPromptSection('05_Brand_Context_Policy.md'),
  __SCHEMA_PROMPT_CREATOR__: SCHEMAS.PROMPT_CREATOR_SCHEMA,
  __SCHEMA_ARTICLE__: SCHEMAS.ARTICLE_SCHEMA,
  __SCHEMA_REVISION__: SCHEMAS.REVISION_SCHEMA,
  __SCHEMA_EVALUATOR__: SCHEMAS.EVALUATOR_SCHEMA,
  __CHECK_NAMES__: SCHEMAS.CHECK_NAMES,
};
const src = (rel) => loadCode(rel, REPL);

const SETTINGS = {
  executionOrder: 'v1',
  timezone: 'Asia/Kolkata',
  saveManualExecutions: true,
  saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'all',
  saveExecutionProgress: true,
  callerPolicy: 'workflowsFromSameOwner',
};

const ARTICLE_LOG_COLUMNS = ['Article_ID', 'Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Article_Title', 'SEO_Title',
  'Meta_Description', 'URL_Slug', 'Quality_Status', 'EETA_Report', 'Plagiarism_Percent', 'Plagiarism_Status', 'Plagiarism_Report_URL',
  'Attempts', 'Google_Doc_ID', 'Google_Doc_URL', 'Status', 'Error', 'Created_At', 'Updated_At'];

// ============================================================================
// 01 Brand RAG Ingestion
// ============================================================================
function buildIngestion() {
  const W = new Workflow('01 Brand RAG Ingestion');
  const wn = W.name;
  const CFG = "$('Ingestion Configuration').first(0).json.config";
  const RUN = "$('Start Ingestion Run').first(0).json.run_id";

  W.add({ name: 'Manual Ingestion Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: P(0, 0), parameters: {} });
  W.add({ name: 'Scheduled Knowledge Sync', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: P(0, 1),
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 7 * * *' }] } } });
  W.add(code('Ingestion Configuration', P(1, 0.5), src('wf01/config.js')));
  W.add(pg('Start Ingestion Run', P(2, 0.5),
    "INSERT INTO seo.brand_ingestion_runs (brand_id, execution_id) VALUES ($1, $2)\nRETURNING run_id,\n  (SELECT model_id FROM seo.embedding_config WHERE config_key = 'active') AS db_model,\n  (SELECT dimensions FROM seo.embedding_config WHERE config_key = 'active') AS db_dims;",
    [`${CFG}.BRAND_ID`, "$('Ingestion Configuration').first(0).json.execution_id"]));
  W.add(sheets('Read Brand Knowledge', P(3, 0.5), {
    operation: 'read', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.BRAND_KNOWLEDGE_SHEET }}`,
  }, { alwaysOutputData: true, retry: true }));
  W.add(code('Validate Knowledge Rows', P(4, 0.5), src('wf01/validate_rows.js')));
  W.add(switchNode(wn, 'Route Knowledge Rows', P(5, 0.5), '$json.route', [
    { key: 'CHUNK', equals: 'CHUNK' }, { key: 'INVALID', equals: 'INVALID' }, { key: 'DEACTIVATE', equals: 'DEACTIVATE' }]));
  W.add({ name: 'Hash Content', type: 'n8n-nodes-base.crypto', typeVersion: 1, position: P(6, -0.5),
    parameters: { action: 'hash', type: 'SHA256', value: '={{ $json.hash_input }}', dataPropertyName: 'content_hash', encoding: 'hex' } });
  W.add(pg('Fetch Existing Hashes', P(7, -0.5),
    'SELECT chunk_id, content_hash, is_active FROM seo.brand_knowledge_chunks WHERE brand_id = $1;',
    [`${CFG}.BRAND_ID`], { executeOnce: true, alwaysOutputData: true }));
  W.add(code('Classify Changes', P(8, -0.5), src('wf01/classify_changes.js')));
  W.add(ifNode(wn, 'Needs Embedding?', P(9, -0.5), "$json.change !== 'UNCHANGED'"));
  W.add(http('Generate Embeddings', P(10, -1), {
    method: 'POST', auth: 'gemini',
    url: `={{ ${CFG}.GEMINI_API_BASE }}/models/{{ ${CFG}.EMBEDDING_MODEL }}:embedContent`,
    jsonBody: '={{ JSON.stringify($json.embedding_request) }}', batch: [5, 1000], timeout: 60000,
  }, { retry: 3, onError: 'continueRegularOutput' }));
  W.add(code('Validate Embedding Response', P(11, -1), src('wf01/validate_embeddings.js')));
  W.add(ifNode(wn, 'Embedding Valid?', P(12, -1), '$json.embedding_ok === true'));
  W.add(pg('Upsert Brand Chunk', P(13, -1.3),
    `WITH u AS (
  SELECT * FROM seo.upsert_brand_chunk($1, $2, $3::int, $4, $5, $6, $7, $8, $9, $10, $11::int, $12::jsonb)
), c AS (
  UPDATE seo.brand_ingestion_runs r
     SET chunks_inserted = r.chunks_inserted + (SELECT count(*) FROM u WHERE u.action = 'INSERTED'),
         chunks_updated  = r.chunks_updated  + (SELECT count(*) FROM u WHERE u.action = 'UPDATED'),
         chunks_unchanged = r.chunks_unchanged + (SELECT count(*) FROM u WHERE u.action = 'UNCHANGED')
   WHERE r.run_id = $13
  RETURNING r.run_id
)
SELECT u.chunk_id, u.action, (SELECT count(*) FROM c) AS run_counted FROM u;`,
    ['$json.brand_id', '$json.knowledge_id', '$json.chunk_index', '$json.category', '$json.content', '$json.source_url',
      '$json.content_hash', '$json.last_updated', '$json.vector', `${CFG}.EMBEDDING_MODEL`, `${CFG}.EMBEDDING_DIMENSIONS`,
      'JSON.stringify($json.metadata)', RUN], { onError: 'continueErrorOutput' }));
  W.add(pg('Mark Unchanged Chunks Seen', P(10, 0),
    `WITH t AS (
  UPDATE seo.brand_knowledge_chunks SET last_seen_at = now(), source_last_updated = NULLIF($2, '')
   WHERE chunk_id = $1 AND content_hash = $3
  RETURNING chunk_id
), c AS (
  UPDATE seo.brand_ingestion_runs r SET chunks_unchanged = r.chunks_unchanged + (SELECT count(*) FROM t)
   WHERE r.run_id = $4 RETURNING r.run_id
)
SELECT (SELECT count(*) FROM t) AS touched, (SELECT count(*) FROM c) AS run_counted;`,
    ['$json.chunk_id', '$json.last_updated', '$json.content_hash', RUN]));
  W.add(pg('Record Ingestion Error', P(14, 0.5),
    'INSERT INTO seo.brand_ingestion_errors (run_id, execution_id, brand_id, knowledge_id, error_class, message)\nVALUES ($1, $2, $3, $4, $5, left($6, 4000)) RETURNING error_id;',
    [RUN, "$('Ingestion Configuration').first(0).json.execution_id", `${CFG}.BRAND_ID`, "$json.knowledge_id || $json.chunk_id || 'unknown'",
      "$json.error_class || 'DATABASE'", "$json.message || (($json.error && ($json.error.message || $json.error)) + '')"]));
  W.add(pg('Deactivate Unapproved Knowledge', P(6, 2),
    `WITH d AS (
  SELECT * FROM seo.deactivate_brand_knowledge($1, ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), $3::jsonb)
)
UPDATE seo.brand_ingestion_runs r
   SET chunks_deactivated = (SELECT count(*) FROM d)
 WHERE r.run_id = $4
RETURNING r.run_id, r.chunks_deactivated;`,
    [`${CFG}.BRAND_ID`, 'JSON.stringify($json.unapproved_ids)', 'JSON.stringify($json.chunk_counts)', RUN]));
  W.add(pg('Finalize Ingestion Run', P(7, 2),
    `UPDATE seo.brand_ingestion_runs r
   SET finished_at = now(), rows_read = $2::int, rows_approved = $3::int, rows_invalid = $4::int,
       errors = (SELECT count(*) FROM seo.brand_ingestion_errors e WHERE e.run_id = r.run_id),
       status = CASE
         WHEN (SELECT count(*) FROM seo.brand_ingestion_errors e WHERE e.run_id = r.run_id) = 0 THEN 'SUCCESS'
         WHEN r.chunks_inserted + r.chunks_updated + r.chunks_unchanged > 0 THEN 'PARTIAL'
         ELSE 'FAILED' END
 WHERE r.run_id = $1
RETURNING r.*;`,
    [RUN, "$('Route Knowledge Rows').all(2)[0].json.rows_read", "$('Route Knowledge Rows').all(2)[0].json.rows_approved",
      "$('Route Knowledge Rows').all(2)[0].json.rows_invalid"]));
  W.add(code('Report Ingestion Outcome', P(8, 2), src('wf01/report_outcome.js')));
  W.add(sticky('Note - Ingestion', P(0, -2.2), '## 01 Brand RAG Ingestion\nReads **Brand_Knowledge**, keeps rows with Approved = TRUE, validates and normalises them, embeds new/changed chunks with **gemini-embedding-001 (768 dims, RETRIEVAL_DOCUMENT)** and upserts into `seo.brand_knowledge_chunks`.\n\n* Unchanged rows (same SHA-256) are **not** re-embedded.\n* Unapproved rows are soft-deactivated, never deleted.\n* Branch order matters: the DEACTIVATE/finalize lane is placed lowest so it runs last (execution order v1).\n* Errors are logged in `seo.brand_ingestion_errors`.', 520, 300));

  W.link('Manual Ingestion Trigger', 'Ingestion Configuration');
  W.link('Scheduled Knowledge Sync', 'Ingestion Configuration');
  W.chain('Ingestion Configuration', 'Start Ingestion Run', 'Read Brand Knowledge', 'Validate Knowledge Rows', 'Route Knowledge Rows');
  W.link('Route Knowledge Rows', 'Hash Content', 0);
  W.link('Route Knowledge Rows', 'Record Ingestion Error', 1);
  W.link('Route Knowledge Rows', 'Deactivate Unapproved Knowledge', 2);
  W.chain('Hash Content', 'Fetch Existing Hashes', 'Classify Changes', 'Needs Embedding?');
  W.link('Needs Embedding?', 'Generate Embeddings', 0);
  W.link('Needs Embedding?', 'Mark Unchanged Chunks Seen', 1);
  W.chain('Generate Embeddings', 'Validate Embedding Response', 'Embedding Valid?');
  W.link('Embedding Valid?', 'Upsert Brand Chunk', 0);
  W.link('Embedding Valid?', 'Record Ingestion Error', 1);
  W.link('Upsert Brand Chunk', 'Record Ingestion Error', 1);
  W.chain('Deactivate Unapproved Knowledge', 'Finalize Ingestion Run', 'Report Ingestion Outcome');
  return W.toJSON({ ...SETTINGS });
}

// ============================================================================
// 02 SEO Article Automation (orchestrator + per-keyword sub-execution)
// ============================================================================
function buildArticleAutomation() {
  const W = new Workflow('02 SEO Article Automation');
  const wn = W.name;
  const OC = "$('Confirm Preflight').first(0).json.config"; // orchestrator config
  const C = "$('Keyword Context').first(0).json";
  const CFG = `${C}.config`;
  const CL = "$('Claim Keyword Record').first(0).json";
  const ATT = "$('Prepare Attempt').first(0).json";
  const EXEC = `${C}.execution_id`;
  const geminiUrl = `={{ ${CFG}.GEMINI_API_BASE }}/models/{{ $json.model }}:generateContent`;
  const gemini = (name, pos) => http(name, pos, { method: 'POST', auth: 'gemini', url: geminiUrl, jsonBody: '={{ JSON.stringify($json.gemini_request) }}', timeout: 300000 }, { retry: 3, onError: 'continueErrorOutput' });
  const kwSheet = (name, pos, values, opts) => sheets(name, pos, {
    operation: 'update', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.KEYWORDS_SHEET }}`, matchOn: 'Keyword_ID',
    values: { Keyword_ID: `={{ ${C}.keyword_id }}`, ...values },
  }, opts || { onError: 'continueRegularOutput' });
  const stage = (name, pos, status) => kwSheet(name, pos, { Status: status });

  // ---------------- Orchestrator ----------------
  W.add({ name: 'Manual Test Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: P(0, 0), parameters: {} });
  W.add({ name: 'Daily SEO Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: P(0, 1),
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * *' }] } } });
  W.add(code('Workflow Configuration', P(1, 0.5), src('wf02/config.js')));
  W.add(pg('Preflight - Check Database', P(2, 0.5),
    `SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector_version,
       (SELECT model_id FROM seo.embedding_config WHERE config_key = 'active') AS embedding_model,
       (SELECT dimensions FROM seo.embedding_config WHERE config_key = 'active') AS embedding_dimensions,
       (SELECT count(*) FROM seo.brand_knowledge_chunks WHERE brand_id = $1 AND is_active) AS active_chunks,
       (SELECT string_agg(version, ',' ORDER BY version) FROM seo.schema_migrations) AS migrations;`,
    ["$('Workflow Configuration').first(0).json.config.BRAND_ID"]));
  W.add(code('Preflight - Validate Configuration', P(3, 0.5), src('wf02/preflight_validate.js')));
  W.add(http('Preflight - Verify Gemini Models', P(4, 0.5), {
    auth: 'gemini', url: "={{ $('Workflow Configuration').first(0).json.config.GEMINI_API_BASE }}/models/{{ $json.model }}", timeout: 30000,
  }, { retry: 2 }));
  W.add(http('Preflight - Verify Plagiarism Account', P(5, 0.5), {
    method: 'POST', auth: 'plagiarism', url: "={{ $('Workflow Configuration').first(0).json.config.PLAGIARISM_INFO_URL }}",
    fullResponse: true, neverError: true, responseFormat: 'text', timeout: 30000,
  }, { executeOnce: true, onError: 'continueRegularOutput' }));
  W.add(code('Confirm Preflight', P(6, 0.5), src('wf02/confirm_preflight.js')));
  W.add(sheets('Read Keywords', P(7, 0.5), { operation: 'read', documentId: `={{ ${OC}.SPREADSHEET_ID }}`, sheetName: `={{ ${OC}.KEYWORDS_SHEET }}` }, { alwaysOutputData: true, retry: true }));
  W.add(code('Filter READY Records', P(8, 0.5), src('wf02/filter_ready.js')));
  W.add(code('Validate URL and Keyword', P(9, 0.5), src('wf02/validate_records.js')));
  W.add(switchNode(wn, 'Route Records', P(10, 0.5), '$json.route', [
    { key: 'PROCESS', equals: 'PROCESS' }, { key: 'INVALID', equals: 'INVALID' }, { key: 'DUPLICATE_IN_BATCH', equals: 'DUPLICATE_IN_BATCH' }, { key: 'DEFERRED', equals: 'DEFERRED' }]));
  W.add(sheets('Mark Invalid Records', P(11, 1.5), {
    operation: 'update', documentId: `={{ ${OC}.SPREADSHEET_ID }}`, sheetName: `={{ ${OC}.KEYWORDS_SHEET }}`, matchOn: 'row_number',
    values: { row_number: '={{ $json.row_number }}', Status: '={{ $json.sheet_status }}', Last_Error: '={{ $json.reason }}', Processed_At: '={{ $json.validated_at }}' },
  }, { onError: 'continueRegularOutput' }));
  W.add({ name: 'Deferred To Next Run', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: P(11, 2.4), parameters: {} });
  W.add(ifNode(wn, 'Keyword ID Generated?', P(11, 0), '$json.keyword_id_generated === true'));
  W.add(sheets('Write Generated Keyword IDs', P(12, -0.8), {
    operation: 'update', documentId: `={{ ${OC}.SPREADSHEET_ID }}`, sheetName: `={{ ${OC}.KEYWORDS_SHEET }}`, matchOn: 'row_number',
    values: { row_number: '={{ $json.row_number }}', Keyword_ID: '={{ $json.keyword_id }}' },
  }, { retry: true }));
  W.add(code('Restore Records After ID Write', P(13, -0.8), src('wf02/restore_records.js')));
  W.add({ name: 'Process Keyword (Sub-Execution)', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: P(14, 0),
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: '={{ $workflow.id }}' },
      mode: 'each',
      options: { waitForSubWorkflow: true },
    },
    onError: 'continueRegularOutput' });
  W.add(code('Summarize Run', P(15, 0), src('wf02/summarize_run.js')));

  // Build the sub-execution payload inside the Execute node's input: a Code node keeps it explicit.
  W.add(code('Build Sub-Execution Payload', P(13.5, 0.9), `// One self-contained payload per keyword: configuration + validated record.
const cfg = $('Confirm Preflight').first(0).json;
return $input.all().map((i) => ({ json: { config: cfg.config, parent_run_id: cfg.run_id, record: i.json } }));`));

  W.link('Manual Test Trigger', 'Workflow Configuration');
  W.link('Daily SEO Schedule', 'Workflow Configuration');
  W.chain('Workflow Configuration', 'Preflight - Check Database', 'Preflight - Validate Configuration', 'Preflight - Verify Gemini Models',
    'Preflight - Verify Plagiarism Account', 'Confirm Preflight', 'Read Keywords', 'Filter READY Records', 'Validate URL and Keyword', 'Route Records');
  W.link('Route Records', 'Keyword ID Generated?', 0);
  W.link('Route Records', 'Mark Invalid Records', 1);
  W.link('Route Records', 'Mark Invalid Records', 2);
  W.link('Route Records', 'Deferred To Next Run', 3);
  W.link('Keyword ID Generated?', 'Write Generated Keyword IDs', 0);
  W.link('Keyword ID Generated?', 'Build Sub-Execution Payload', 1);
  W.chain('Write Generated Keyword IDs', 'Restore Records After ID Write', 'Build Sub-Execution Payload', 'Process Keyword (Sub-Execution)', 'Summarize Run');

  // ---------------- Per-keyword sub-execution ----------------
  const Y = 5; // lane offset
  W.add({ name: 'When Called By Orchestrator', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: P(0, Y), parameters: { inputSource: 'passthrough' } });
  W.add(code('Keyword Context', P(1, Y), src('wf02/keyword_context.js')));
  W.add(pg('Claim Keyword Record', P(2, Y),
    'SELECT * FROM seo.claim_keyword($1, $2, $3, $4, $5, $6, $7, $8::int, $9::boolean, $10::int);',
    [`${C}.keyword_id`, `${CFG}.BRAND_ID`, `${C}.target_page_url`, `${C}.normalized_url`, `${C}.primary_keyword`, `${C}.normalized_keyword`,
      EXEC, `${CFG}.CLAIM_LEASE_MINUTES`, `${C}.regenerate`, `${CFG}.MAX_ARTICLE_ATTEMPTS`], { onError: 'continueErrorOutput', retry: true }));
  W.add(switchNode(wn, 'Route Claim Result', P(3, Y), '$json.outcome', [
    { key: 'CLAIMED', equals: 'CLAIMED' }, { key: 'RECOVER', equals: 'RECOVER' }, { key: 'IN_PROGRESS', equals: 'IN_PROGRESS' }], 'SKIP'));
  // ALREADY_COMPLETED keeps the row APPROVED (the DB is the source of truth);
  // SKIPPED_DUPLICATE is used when another Keyword_ID owns the same keyword+URL.
  W.add(kwSheet('Mark Skipped Record', P(4, Y + 2.2), {
    Status: `={{ ${CL}.outcome === 'KEYWORD_ID_CONFLICT' ? 'ERROR' : (${CL}.outcome === 'ALREADY_COMPLETED' ? 'APPROVED' : 'SKIPPED_DUPLICATE') }}`,
    Last_Error: `={{ (${CL}.outcome === 'ALREADY_COMPLETED' ? 'Re-submission skipped (no duplicate generated): article ' + ${CL}.article_id + ' is already approved. ' : '') + ${CL}.reason }}`,
    Processed_At: `={{ ${C}.started_at_ist }}`,
  }));
  W.add({ name: 'Already Claimed Elsewhere', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: P(4, Y + 1.4), parameters: {} });
  W.add(kwSheet('Mark PROCESSING', P(4, Y), { Status: 'PROCESSING', Processing_Started_At: `={{ ${C}.started_at_ist }}`, Last_Error: '' }));
  W.add(http('Fetch Target Page', P(5, Y), {
    url: `={{ ${C}.target_page_url }}`, headers: { 'User-Agent': `={{ ${CFG}.USER_AGENT }}`, Accept: 'text/html,application/xhtml+xml' },
    fullResponse: true, neverError: true, responseFormat: 'text', redirects: 5, timeout: 30000,
  }, { retry: 2, onError: 'continueErrorOutput' }));
  W.add({ name: 'Extract Target Page Content', type: 'n8n-nodes-base.html', typeVersion: 1.2, position: P(6, Y), onError: 'continueRegularOutput',
    parameters: {
      operation: 'extractHtmlContent', sourceData: 'json', dataPropertyName: 'data', // HTTP fullResponse+text -> "data"
      extractionValues: { values: [
        { key: 'title', cssSelector: 'title', returnValue: 'text' },
        { key: 'meta_description', cssSelector: 'meta[name="description"]', returnValue: 'attribute', attribute: 'content' },
        { key: 'meta_robots', cssSelector: 'meta[name="robots"]', returnValue: 'attribute', attribute: 'content', returnArray: true },
        { key: 'canonical', cssSelector: 'link[rel="canonical"]', returnValue: 'attribute', attribute: 'href' },
        { key: 'og_title', cssSelector: 'meta[property="og:title"]', returnValue: 'attribute', attribute: 'content' },
        { key: 'h1', cssSelector: 'h1', returnValue: 'text', returnArray: true },
        { key: 'h2', cssSelector: 'h2', returnValue: 'text', returnArray: true },
        { key: 'h3', cssSelector: 'h3', returnValue: 'text', returnArray: true },
        { key: 'main_text', cssSelector: 'body', returnValue: 'text', skipSelectors: 'script,style,noscript,svg,nav,footer,header,form,iframe,template' },
        { key: 'links', cssSelector: 'a[href]', returnValue: 'attribute', attribute: 'href', returnArray: true },
        { key: 'link_texts', cssSelector: 'a[href]', returnValue: 'text', returnArray: true },
        { key: 'ctas', cssSelector: 'a.button, a.btn, button, [class*="cta"] a, a[class*="cta"]', returnValue: 'text', returnArray: true },
      ] },
      options: { trimValues: true, cleanUpText: true },
    } });
  W.add(code('Analyze Target Page', P(7, Y), src('wf02/analyze_page.js')));
  W.add(switchNode(wn, 'Validate Retrieved Page', P(8, Y), '$json.page_outcome', [
    { key: 'OK', equals: 'OK' }, { key: 'REVIEW', equals: 'REVIEW' }, { key: 'TRANSIENT', equals: 'TRANSIENT' }]));
  W.add(code('Build RAG Query', P(9, Y), src('wf02/build_rag_query.js')));
  W.add(http('Generate RAG Query Embedding', P(10, Y), {
    method: 'POST', auth: 'gemini', url: `={{ ${CFG}.GEMINI_API_BASE }}/models/{{ ${CFG}.EMBEDDING_MODEL }}:embedContent`,
    jsonBody: '={{ JSON.stringify($json.embedding_request) }}', timeout: 60000,
  }, { retry: 3, onError: 'continueErrorOutput' }));
  W.add(code('Validate Query Embedding', P(11, Y), src('wf02/validate_query_embedding.js'), { onError: 'continueErrorOutput' }));
  W.add(pg('Retrieve Brand RAG Context', P(12, Y),
    'SELECT * FROM seo.match_brand_knowledge($1, $2, $3::int, $4::float8, ARRAY(SELECT jsonb_array_elements_text($5::jsonb)), $6::int);',
    [`${CFG}.BRAND_ID`, '$json.query_vector', `${CFG}.RAG_TOP_K`, `${CFG}.RAG_MIN_SIMILARITY`, `JSON.stringify(${CFG}.RAG_PINNED_CATEGORIES)`, `${CFG}.RAG_PINNED_PER_CATEGORY`],
    { onError: 'continueErrorOutput', alwaysOutputData: true, retry: true }));
  W.add(code('Validate Brand Context', P(13, Y), src('wf02/validate_brand_context.js')));
  W.add(ifNode(wn, 'Brand Context Sufficient?', P(14, Y), '$json.rag_ok === true'));
  W.add(code('Build Gemini Prompt Creator Input', P(15, Y), src('wf02/build_prompt_creator_input.js')));
  W.add(gemini('Gemini - Create Article Prompt', P(16, Y)));
  W.add(code('Validate Article Prompt', P(17, Y), src('wf02/validate_article_prompt.js')));
  W.add(switchNode(wn, 'Article Prompt Valid?', P(18, Y), '$json.outcome', [
    { key: 'VALID', equals: 'VALID' }, { key: 'RETRY', equals: 'RETRY' }, { key: 'FAILED', equals: 'FAILED' }, { key: 'MISMATCH', equals: 'MISMATCH' }]));
  W.add(code('Build Prompt Correction Request', P(17, Y - 1.2), src('wf02/build_prompt_correction.js')));
  W.add(pg('Record PROMPT_CREATED', P(19, Y), 'SELECT seo.set_stage($1, $2, $3) AS stage;', [`${C}.keyword_id`, EXEC, "'PROMPT_CREATED'"], { onError: 'continueErrorOutput' }));
  W.add(stage('Sheet - PROMPT_CREATED', P(20, Y), 'PROMPT_CREATED'));
  W.add(code('Build Article Writer Input', P(21, Y), src('wf02/build_writer_input.js')));
  W.add(gemini('Gemini - Generate Article', P(22, Y)));
  W.add(code('Validate Article Structure', P(23, Y), src('wf02/validate_article_structure.js')));
  W.add(switchNode(wn, 'Article Structure Valid?', P(24, Y), '$json.outcome', [
    { key: 'VALID', equals: 'VALID' }, { key: 'USABLE_INVALID', equals: 'USABLE_INVALID' }, { key: 'RETRY', equals: 'RETRY' }, { key: 'FAILED', equals: 'FAILED' }]));
  W.add(code('Build Article Correction Request', P(23, Y - 1.2), src('wf02/build_article_correction.js')));
  W.add(stage('Sheet - ARTICLE_GENERATED', P(25, Y), 'ARTICLE_GENERATED'));
  W.add(code('Restore Generated Article', P(26, Y), `// The Sheets node output replaced the item; continue with the validated article.
return [{ json: $('Validate Article Structure').first(0).json }];`));

  // ---------------- Attempt loop (lane Y2) ----------------
  const Y2 = Y + 4;
  W.add(code('Prepare Attempt', P(0, Y2), src('wf02/prepare_attempt.js')));
  W.add(pg('Record Article Attempt', P(1, Y2),
    `SELECT r.attempt_no, r.content_sha256, seo.set_stage($2, $3, 'QUALITY_REVIEW') AS stage
  FROM seo.record_attempt($1, $2, $3, $4::int, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb) r;`,
    [`${CL}.article_id`, `${C}.keyword_id`, EXEC, '$json.attempt_no', '$json.origin', 'JSON.stringify($json.article)',
      '$json.article.Article_Markdown', 'JSON.stringify($json.structure_errors)', '$json.revision_corrections ? JSON.stringify($json.revision_corrections) : null'],
    { onError: 'continueErrorOutput' }));
  W.add(stage('Sheet - QUALITY_REVIEW', P(2, Y2), 'QUALITY_REVIEW'));
  W.add(code('Prepare Source Checks', P(3, Y2), src('wf02/prepare_source_checks.js')));
  W.add(ifNode(wn, 'Source URL To Check?', P(4, Y2), '$json.check === true'));
  W.add(http('Verify External Source URLs', P(5, Y2 - 0.6), {
    url: '={{ $json.url }}', headers: { 'User-Agent': `={{ ${CFG}.USER_AGENT }}` }, fullResponse: true, neverError: true, responseFormat: 'text',
    redirects: 5, timeout: 20000, batch: [2, 500],
  }, { onError: 'continueRegularOutput' }));
  W.add(code('Aggregate Source Checks', P(6, Y2), src('wf02/aggregate_source_checks.js')));
  W.add(code('Build Evaluator Input', P(7, Y2), src('wf02/build_evaluator_input.js')));
  W.add(gemini('Gemini - Evaluate Editorial Quality', P(8, Y2)));
  W.add(code('Validate Editorial Report', P(9, Y2), src('wf02/validate_editorial_report.js')));
  W.add(switchNode(wn, 'Editorial Report Valid?', P(10, Y2), '$json.outcome', [
    { key: 'VALID', equals: 'VALID' }, { key: 'RETRY', equals: 'RETRY' }, { key: 'FAILED', equals: 'FAILED' }]));
  W.add(code('Build Evaluator Correction Request', P(9, Y2 - 1.2), src('wf02/build_evaluator_correction.js')));
  W.add(code('Check Editorial Conditions', P(11, Y2), src('wf02/check_editorial_conditions.js')));
  W.add(pg('Record Editorial Result', P(12, Y2),
    `SELECT seo.record_editorial_result($1, $2, $3, $4::int, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb) AS editorial_status,
       seo.set_stage($2, $3, CASE WHEN $5 = 'PASS' THEN 'PLAGIARISM_CHECK' ELSE 'REVISION_REQUIRED' END) AS stage;`,
    [`${CL}.article_id`, `${C}.keyword_id`, EXEC, '$json.attempt_no', '$json.editorial_status', 'JSON.stringify($json.report)',
      'JSON.stringify($json.deterministic_checks)', 'JSON.stringify($json.source_checks)', 'JSON.stringify($json.failed_conditions)'],
    { onError: 'continueErrorOutput' }));
  W.add(ifNode(wn, 'Editorial Passed?', P(13, Y2), "$('Check Editorial Conditions').first(0).json.editorial_pass === true"));
  W.add(stage('Sheet - PLAGIARISM_CHECK', P(14, Y2 - 0.6), 'PLAGIARISM_CHECK'));
  W.add(code('Prepare Plagiarism Submission', P(15, Y2 - 0.6), src('wf02/prepare_plagiarism.js')));
  W.add(http('Submit Plagiarism Scan', P(16, Y2 - 0.6), {
    method: 'POST', auth: 'plagiarism', url: `={{ ${CFG}.PLAGIARISM_CHECK_URL }}`,
    formBody: { data: '={{ $json.text }}', rephrased: `={{ ${CFG}.PLAGIARISM_REPHRASED_DETECTION ? 'true' : 'false' }}` },
    fullResponse: true, neverError: true, responseFormat: 'text', timeout: 120000, batch: [1, 2000],
  }, { onError: 'continueErrorOutput' }));
  W.add(code('Normalize Plagiarism Response', P(17, Y2 - 0.6), src('wf02/normalize_plagiarism.js')));
  W.add(switchNode(wn, 'Plagiarism Report Status', P(18, Y2 - 0.6), '$json.state', [
    { key: 'COMPLETE', equals: 'COMPLETE' }, { key: 'PENDING', equals: 'PENDING' }, { key: 'ERROR', equals: 'ERROR' }]));
  W.add({ name: 'Wait For Plagiarism Report', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: P(18, Y2 - 2),
    parameters: { resume: 'timeInterval', amount: `={{ ${CFG}.PLAGIARISM_POLL_INTERVAL_SECONDS }}`, unit: 'seconds' }, webhookId: 'a7c9e1f2-0b3d-4e5f-8a9b-1c2d3e4f5a6b' });
  W.add(code('Build Poll Requests', P(19, Y2 - 2), src('wf02/build_poll_requests.js')));
  W.add(http('Retrieve Plagiarism Report', P(20, Y2 - 2), {
    auth: 'plagiarism', url: '={{ $json.poll_url }}', fullResponse: true, neverError: true, responseFormat: 'text', timeout: 60000, batch: [1, 1000],
  }, { onError: 'continueErrorOutput' }));
  W.add(code('Normalize Poll Response', P(21, Y2 - 2), src('wf02/normalize_poll.js')));
  W.add(code('Evaluate Plagiarism Result', P(19, Y2 - 0.6), src('wf02/evaluate_plagiarism.js')));
  W.add(pg('Record Plagiarism Result', P(20, Y2 - 0.6),
    'SELECT seo.record_plagiarism_result($1, $2, $3, $4::int, $5, $6, $7::numeric, $8::jsonb, $9, $10::jsonb) AS plagiarism_status;',
    [`${CL}.article_id`, `${C}.keyword_id`, EXEC, '$json.attempt_no', '$json.content_sha256', '$json.plagiarism_status', '$json.plagiarism_percent',
      'JSON.stringify($json.report)', '$json.plagiarism_report_ref', 'JSON.stringify($json.failed_conditions)'],
    { onError: 'continueErrorOutput' }));
  W.add(ifNode(wn, 'Plagiarism Passed?', P(21, Y2 - 0.6), "$('Evaluate Plagiarism Result').first(0).json.plagiarism_status === 'PASS'"));
  W.add(code('Collect Attempt Failure', P(14, Y2 + 1.2), src('wf02/collect_attempt_failure.js')));
  W.add(ifNode(wn, 'Check Attempt Limit', P(15, Y2 + 1.2), '$json.can_retry === true'));
  W.add(stage('Sheet - REVISION_REQUIRED', P(16, Y2 + 1.2), 'REVISION_REQUIRED'));
  W.add(code('Build Article Revision Brief', P(17, Y2 + 1.2), src('wf02/build_revision_brief.js')));
  W.add(gemini('Gemini - Revise Article', P(18, Y2 + 1.2)));
  W.add(code('Revalidate Revised Article', P(19, Y2 + 1.2), src('wf02/revalidate_revised.js')));

  // ---------------- Approval & Google Docs (lane Y3) ----------------
  const Y3 = Y + 8;
  W.add(code('Format Approved Article', P(0, Y3), src('wf02/format_approved_article.js'), { onError: 'continueErrorOutput' }));
  W.add(pg('Acquire Master Doc Lock', P(1, Y3), 'SELECT * FROM seo.acquire_doc_lock($1, $2, $3::int);',
    [`${CFG}.MASTER_DOC_ID`, EXEC, `${CFG}.DOC_LOCK_TTL_SECONDS`], { onError: 'continueErrorOutput', retry: true }));
  W.add(ifNode(wn, 'Doc Lock Acquired?', P(2, Y3), '$json.acquired === true'));
  W.add(code('Count Doc Lock Wait', P(2, Y3 + 1.2), src('wf02/count_lock_wait.js')));
  W.add(ifNode(wn, 'Lock Wait Allowed?', P(3, Y3 + 1.2), '$json.wait_allowed === true'));
  W.add({ name: 'Wait For Doc Lock', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: P(4, Y3 + 1.2),
    parameters: { resume: 'timeInterval', amount: `={{ ${CFG}.DOC_LOCK_WAIT_SECONDS }}`, unit: 'seconds' }, webhookId: 'b8d0f2a3-1c4e-4f6a-9b0c-2d3e4f5a6b7c' });
  W.add(pg('Check Article Idempotency', P(3, Y3), 'SELECT * FROM seo.begin_doc_write($1, $2, $3, $4, $5, $6::int);',
    [`${CL}.article_id`, `${C}.keyword_id`, EXEC, `${CFG}.MASTER_DOC_ID`, "$('Format Approved Article').first(0).json.marker",
      "$('Format Approved Article').first(0).json.expected_chars"], { onError: 'continueErrorOutput' }));
  W.add(switchNode(wn, 'Route Idempotency Decision', P(4, Y3), '$json.decision', [
    { key: 'PROCEED', equals: 'PROCEED' }, { key: 'ALREADY_WRITTEN', equals: 'ALREADY_WRITTEN' }, { key: 'RECONCILE', equals: 'RECONCILE' }, { key: 'NOT_APPROVABLE', equals: 'NOT_APPROVABLE' }]));
  W.add(http('Get Master Doc', P(5, Y3 - 0.6), { auth: 'docs', url: `={{ ${CFG}.DOCS_API_BASE }}/documents/{{ ${CFG}.MASTER_DOC_ID }}`, timeout: 60000 }, { retry: 3, onError: 'continueErrorOutput' }));
  W.add(code('Build Docs Requests', P(6, Y3 - 0.6), src('wf02/build_docs_requests.js')));
  W.add(ifNode(wn, 'Marker Already Present?', P(7, Y3 - 0.6), '$json.already_present === true'));
  W.add(http('Append Article to Master Google Doc', P(8, Y3 - 1.2), {
    method: 'POST', auth: 'docs', url: `={{ ${CFG}.DOCS_API_BASE }}/documents/{{ ${CFG}.MASTER_DOC_ID }}:batchUpdate`,
    jsonBody: '={{ JSON.stringify($json.batch_update) }}', timeout: 120000,
  }, { onError: 'continueErrorOutput' }));
  W.add(pg('Mark Doc Write UNCERTAIN', P(9, Y3 - 2), 'SELECT seo.set_doc_write_state($1, $2, $3) AS ledger_state;',
    [`${CL}.article_id`, "'UNCERTAIN'", "String(($json.error && ($json.error.message || $json.error)) || 'batchUpdate returned an error').slice(0, 1000)"], { onError: 'continueErrorOutput' }));
  W.add(http('Read Master Doc For Verification', P(10, Y3 - 0.6), { auth: 'docs', url: `={{ ${CFG}.DOCS_API_BASE }}/documents/{{ ${CFG}.MASTER_DOC_ID }}`, timeout: 60000 }, { retry: 3, onError: 'continueErrorOutput' }));
  W.add(code('Verify Google Docs Write', P(11, Y3 - 0.6), src('wf02/verify_docs_write.js')));
  W.add(switchNode(wn, 'Docs Write Verified?', P(12, Y3 - 0.6), '$json.verification', [
    { key: 'VERIFIED', equals: 'VERIFIED' }, { key: 'MISSING', equals: 'MISSING' }, { key: 'INCOMPLETE', equals: 'INCOMPLETE' }]));
  W.add(pg('Ledger - Mark VERIFIED', P(13, Y3 - 0.6), "SELECT seo.set_doc_write_state($1, 'VERIFIED', NULL) AS ledger_state;", [`${CL}.article_id`], { onError: 'continueErrorOutput', retry: true }));
  W.add(pg('Ledger - Mark FAILED', P(13, Y3 + 0.4), "SELECT seo.set_doc_write_state($1, 'FAILED', $2) AS ledger_state;",
    [`${CL}.article_id`, "$('Verify Google Docs Write').first(0).json.message"], { onError: 'continueErrorOutput' }));
  W.add(code('Recover Partial Success', P(13, Y3 + 1.6), src('wf02/recover_partial_success.js')));
  W.add(pg('Finalize Approved Article', P(14, Y3), 'SELECT * FROM seo.finalize_approved_article($1, $2, $3, $4);',
    [`${CL}.article_id`, EXEC, `${CFG}.MASTER_DOC_ID`, `'https://docs.google.com/document/d/' + ${CFG}.MASTER_DOC_ID + '/edit'`], { onError: 'continueErrorOutput', retry: true }));
  W.add(kwSheet('Update Keyword APPROVED', P(15, Y3), {
    Status: 'APPROVED', Processed_At: `={{ DateTime.now().setZone(${CFG}.TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss') }}`, Last_Error: '',
  }, { onError: 'continueErrorOutput', retry: true }));
  const logRow = (statusExpr, errorExpr, src2) => ({
    Article_ID: `={{ ${src2}.article_id }}`, Keyword_ID: `={{ ${src2}.keyword_id }}`, Target_Page_URL: `={{ ${src2}.target_page_url }}`,
    Primary_Keyword: `={{ ${src2}.primary_keyword }}`, Article_Title: `={{ ${src2}.article_title }}`, SEO_Title: `={{ ${src2}.seo_title }}`,
    Meta_Description: `={{ ${src2}.meta_description }}`, URL_Slug: `={{ ${src2}.url_slug }}`, Quality_Status: `={{ ${src2}.quality_status }}`,
    EETA_Report: `={{ ${src2}.eeta_summary }}`, Plagiarism_Percent: `={{ ${src2}.plagiarism_percent }}`, Plagiarism_Status: `={{ ${src2}.plagiarism_status }}`,
    Plagiarism_Report_URL: `={{ ${src2}.plagiarism_report_ref }}`, Attempts: `={{ ${src2}.attempt_count }}`, Google_Doc_ID: `={{ ${src2}.google_doc_id }}`,
    Google_Doc_URL: `={{ ${src2}.google_doc_url }}`, Status: statusExpr, Error: errorExpr,
    Created_At: `={{ DateTime.fromISO(new Date(${src2}.created_at).toISOString()).setZone('Asia/Kolkata').toFormat('yyyy-LL-dd HH:mm:ss') }}`,
    Updated_At: `={{ DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-LL-dd HH:mm:ss') }}`,
  });
  const FIN = "$('Finalize Approved Article').first(0).json";
  W.add(sheets('Log Approved Article', P(16, Y3), {
    operation: 'appendOrUpdate', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.ARTICLE_LOG_SHEET }}`, matchOn: 'Article_ID',
    values: logRow('APPROVED', '', FIN),
  }, { onError: 'continueErrorOutput', retry: true }));
  W.add(pg('Mark Sheet Synced', P(17, Y3), 'SELECT seo.set_sheet_sync($1, true, NULL) AS sheet_synced;', [`${CL}.article_id`], { retry: true }));
  W.add(pg('Flag Sheet Sync Pending', P(17, Y3 + 1),
    'SELECT seo.set_sheet_sync($1, false, $2) AS sheet_synced;',
    [`${CL}.article_id`, "'Sheets update failed after verified Docs write; Error Recovery will retry: ' + String(($json.error && ($json.error.message || $json.error)) || '').slice(0, 500)"], { retry: true }));

  // ---------------- Review & errors (lane Y4) ----------------
  const Y4 = Y + 11;
  W.add(code('Prepare Review Outcome', P(0, Y4), src('wf02/prepare_review_outcome.js')));
  W.add(pg('Mark REVIEW_REQUIRED', P(1, Y4),
    'SELECT r.*, seo.release_doc_lock($6, $3) AS lock_released FROM seo.mark_review_required($1, $2, $3, $4, $5::jsonb) r;',
    [`${CL}.article_id`, `${C}.keyword_id`, EXEC, '$json.review_reason', 'JSON.stringify($json.failed_conditions)', `${CFG}.MASTER_DOC_ID`],
    { onError: 'continueErrorOutput', retry: true }));
  const RV = "$('Prepare Review Outcome').first(0).json";
  W.add(kwSheet('Sheet - Mark REVIEW_REQUIRED', P(2, Y4), { Status: 'REVIEW_REQUIRED', Processed_At: `={{ ${RV}.occurred_at }}`, Last_Error: `={{ ${RV}.review_reason.slice(0, 1000) }}` }));
  W.add(sheets('Log Review Required Article', P(3, Y4), {
    operation: 'appendOrUpdate', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.ARTICLE_LOG_SHEET }}`, matchOn: 'Article_ID',
    values: {
      Article_ID: `={{ ${CL}.article_id }}`, Keyword_ID: `={{ ${C}.keyword_id }}`, Target_Page_URL: `={{ ${C}.target_page_url }}`, Primary_Keyword: `={{ ${C}.primary_keyword }}`,
      Article_Title: `={{ ${RV}.article ? ${RV}.article.Article_Title : '' }}`, SEO_Title: `={{ ${RV}.article ? ${RV}.article.SEO_Title : '' }}`,
      Meta_Description: `={{ ${RV}.article ? ${RV}.article.Meta_Description : '' }}`, URL_Slug: `={{ ${RV}.article ? ${RV}.article.URL_Slug : '' }}`,
      Quality_Status: `={{ ${RV}.quality_status }}`, EETA_Report: `={{ ${RV}.eeta_summary }}`, Plagiarism_Percent: `={{ ${RV}.plagiarism_percent }}`,
      Plagiarism_Status: `={{ ${RV}.plagiarism_status }}`, Plagiarism_Report_URL: `={{ ${RV}.plagiarism_report_ref }}`, Attempts: `={{ ${RV}.attempts }}`,
      Google_Doc_ID: '', Google_Doc_URL: '', Status: 'REVIEW_REQUIRED', Error: `={{ ${RV}.review_reason.slice(0, 1000) }}`,
      Created_At: `={{ ${C}.started_at_ist }}`, Updated_At: `={{ ${RV}.occurred_at }}`,
    },
  }, { onError: 'continueRegularOutput' }));

  const tags = [
    ['Tag Error - Database', 'DATABASE', 'KEEP'], ['Tag Error - Page Fetch', 'PAGE_FETCH', 'KEEP'], ['Tag Error - Embedding', 'EMBEDDING', 'KEEP'],
    ['Tag Error - Gemini Prompt', 'GEMINI_PROMPT_CREATOR', 'KEEP'], ['Tag Error - Gemini Writer', 'GEMINI_WRITER', 'KEEP'],
    ['Tag Error - Gemini Evaluator', 'GEMINI_EVALUATOR', 'KEEP'], ['Tag Error - Gemini Reviser', 'GEMINI_REVISER', 'KEEP'],
    ['Tag Error - Plagiarism', 'PLAGIARISM', 'KEEP'], ['Tag Error - Docs Before Write', 'GOOGLE_DOCS_BEFORE_WRITE', 'FAIL_PENDING'],
    ['Tag Error - Docs After Write', 'GOOGLE_DOCS_AFTER_WRITE', 'KEEP'],
  ];
  tags.forEach(([n, stageName, ledger], i) => W.add(setTag(n, P(4 + (i % 5), Y4 + 1.4 + Math.floor(i / 5) * 0.8), { error_stage: stageName, ledger_action: ledger })));
  W.add(setTag('Tag Error - Docs Verification', P(9, Y4 + 1.4), { error_stage: 'GOOGLE_DOCS_VERIFY', ledger_action: 'KEEP',
    error: "={{ $('Verify Google Docs Write').first(0).json.message }}", error_class: 'API_TRANSIENT' }));
  W.add(code('Handle API Errors', P(10, Y4 + 1.8), src('wf02/handle_api_errors.js')));
  W.add(ifNode(wn, 'Claim Lost?', P(11, Y4 + 1.8), '$json.claim_lost === true'));
  W.add(pg('Log Claim Lost', P(12, Y4 + 1), 'SELECT seo.log_event($1, $2, $3, $4, $5, $6, $7, $8, NULL) AS event_id;',
    [EXEC, "'SEO_Article_Automation'", '$json.keyword_id', '$json.article_id', '$json.stage', "'CLAIM_LOST'", "'CLAIM_LOST'", '$json.message']));
  W.add(pg('Record Technical Failure', P(12, Y4 + 2.4),
    `SELECT f.sheet_status, f.technical_failures,
       CASE WHEN $9 = 'FAIL_PENDING' AND NULLIF($2, '') IS NOT NULL THEN seo.set_doc_write_state($2, 'FAILED', $6) END AS ledger_state,
       seo.release_doc_lock($10, $3) AS lock_released
  FROM seo.mark_keyword_error($1, $2, $3, $4, $5, $6, $7::boolean, $8::int) f;`,
    ['$json.keyword_id', '$json.article_id', EXEC, '$json.stage', '$json.error_class', '$json.message', '$json.retryable', `${CFG}.MAX_TECHNICAL_FAILURES`,
      '$json.ledger_action', `${CFG}.MASTER_DOC_ID`], { retry: true }));
  const HE = "$('Handle API Errors').first(0).json";
  W.add(kwSheet('Log Processing Failure', P(13, Y4 + 2.4), {
    Status: '={{ $json.sheet_status }}', Processed_At: `={{ ${HE}.occurred_at }}`, Last_Error: `={{ ${HE}.sheet_error_text }}`,
  }));
  W.add(ifNode(wn, 'Has Article ID?', P(14, Y4 + 2.4), `!!${HE}.article_id`));
  W.add(sheets('Log Failure To Article_Log', P(15, Y4 + 2.4), {
    operation: 'appendOrUpdate', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.ARTICLE_LOG_SHEET }}`, matchOn: 'Article_ID',
    values: {
      Article_ID: `={{ ${HE}.article_id }}`, Keyword_ID: `={{ ${C}.keyword_id }}`, Target_Page_URL: `={{ ${C}.target_page_url }}`, Primary_Keyword: `={{ ${C}.primary_keyword }}`,
      Status: `={{ $('Record Technical Failure').first(0).json.sheet_status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'ERROR' }}`,
      Error: `={{ ${HE}.sheet_error_text }}`, Attempts: `={{ $('Prepare Attempt').isExecuted ? $('Prepare Attempt').first(0).json.local_attempt : 0 }}`,
      Created_At: `={{ ${C}.started_at_ist }}`, Updated_At: `={{ ${HE}.occurred_at }}`,
    },
  }, { onError: 'continueRegularOutput' }));
  W.add(code('Keyword Outcome', P(16, Y4 + 1), src('wf02/keyword_outcome.js')));

  W.add(sticky('Note - Orchestrator', P(0, -2.6), '## 02 SEO Article Automation\n**Top lane = orchestrator** (triggers, preflight, queue). Each valid keyword is processed in its own **sub-execution of this same workflow** (via *When Called By Orchestrator*) so state, loops and failures stay isolated per keyword.\n\nBefore activation: set IDs in **Workflow Configuration**, attach credentials, run the Manual Test Trigger with one test row. Keep inactive until tests pass.', 560, 260));
  W.add(sticky('Note - Gates', P(0, Y + 2.2), '### Approval gates\nNothing reaches the master Google Doc unless the **same attempt** passed: structured-output validation → editorial evaluation (all checks PASS, no unsupported claims, deterministic checks) → a **new** plagiarism scan of that exact text (≤ threshold). Every failure is revised and fully re-checked, at most **MAX_ARTICLE_ATTEMPTS** times, then REVIEW_REQUIRED.', 560, 230));

  // ----- sub-execution wiring -----
  W.chain('When Called By Orchestrator', 'Keyword Context', 'Claim Keyword Record', 'Route Claim Result');
  W.link('Claim Keyword Record', 'Tag Error - Database', 1);
  W.link('Route Claim Result', 'Mark PROCESSING', 0);
  W.link('Route Claim Result', 'Recover Partial Success', 1);
  W.link('Route Claim Result', 'Already Claimed Elsewhere', 2);
  W.link('Route Claim Result', 'Mark Skipped Record', 3);
  W.link('Mark Skipped Record', 'Keyword Outcome');
  W.link('Already Claimed Elsewhere', 'Keyword Outcome');
  W.chain('Mark PROCESSING', 'Fetch Target Page', 'Extract Target Page Content', 'Analyze Target Page', 'Validate Retrieved Page');
  W.link('Fetch Target Page', 'Tag Error - Page Fetch', 1);
  W.link('Validate Retrieved Page', 'Build RAG Query', 0);
  W.link('Validate Retrieved Page', 'Prepare Review Outcome', 1);
  W.link('Validate Retrieved Page', 'Tag Error - Page Fetch', 2);
  W.chain('Build RAG Query', 'Generate RAG Query Embedding', 'Validate Query Embedding', 'Retrieve Brand RAG Context', 'Validate Brand Context', 'Brand Context Sufficient?');
  W.link('Generate RAG Query Embedding', 'Tag Error - Embedding', 1);
  W.link('Validate Query Embedding', 'Tag Error - Embedding', 1);
  W.link('Retrieve Brand RAG Context', 'Tag Error - Database', 1);
  W.link('Brand Context Sufficient?', 'Build Gemini Prompt Creator Input', 0);
  W.link('Brand Context Sufficient?', 'Prepare Review Outcome', 1);
  W.chain('Build Gemini Prompt Creator Input', 'Gemini - Create Article Prompt', 'Validate Article Prompt', 'Article Prompt Valid?');
  W.link('Gemini - Create Article Prompt', 'Tag Error - Gemini Prompt', 1);
  W.link('Article Prompt Valid?', 'Record PROMPT_CREATED', 0);
  W.link('Article Prompt Valid?', 'Build Prompt Correction Request', 1);
  W.link('Article Prompt Valid?', 'Tag Error - Gemini Prompt', 2);
  W.link('Article Prompt Valid?', 'Prepare Review Outcome', 3);
  W.link('Build Prompt Correction Request', 'Gemini - Create Article Prompt');
  W.chain('Record PROMPT_CREATED', 'Sheet - PROMPT_CREATED', 'Build Article Writer Input', 'Gemini - Generate Article', 'Validate Article Structure', 'Article Structure Valid?');
  W.link('Record PROMPT_CREATED', 'Tag Error - Database', 1);
  W.link('Gemini - Generate Article', 'Tag Error - Gemini Writer', 1);
  W.link('Article Structure Valid?', 'Sheet - ARTICLE_GENERATED', 0);
  W.link('Article Structure Valid?', 'Sheet - ARTICLE_GENERATED', 1);
  W.link('Article Structure Valid?', 'Build Article Correction Request', 2);
  W.link('Article Structure Valid?', 'Tag Error - Gemini Writer', 3);
  W.link('Build Article Correction Request', 'Gemini - Generate Article');
  W.chain('Sheet - ARTICLE_GENERATED', 'Restore Generated Article', 'Prepare Attempt');

  // attempt loop
  W.chain('Prepare Attempt', 'Record Article Attempt', 'Sheet - QUALITY_REVIEW', 'Prepare Source Checks', 'Source URL To Check?');
  W.link('Record Article Attempt', 'Tag Error - Database', 1);
  W.link('Source URL To Check?', 'Verify External Source URLs', 0);
  W.link('Source URL To Check?', 'Aggregate Source Checks', 1);
  W.link('Verify External Source URLs', 'Aggregate Source Checks');
  W.chain('Aggregate Source Checks', 'Build Evaluator Input', 'Gemini - Evaluate Editorial Quality', 'Validate Editorial Report', 'Editorial Report Valid?');
  W.link('Gemini - Evaluate Editorial Quality', 'Tag Error - Gemini Evaluator', 1);
  W.link('Editorial Report Valid?', 'Check Editorial Conditions', 0);
  W.link('Editorial Report Valid?', 'Build Evaluator Correction Request', 1);
  W.link('Editorial Report Valid?', 'Tag Error - Gemini Evaluator', 2);
  W.link('Build Evaluator Correction Request', 'Gemini - Evaluate Editorial Quality');
  W.chain('Check Editorial Conditions', 'Record Editorial Result', 'Editorial Passed?');
  W.link('Record Editorial Result', 'Tag Error - Database', 1);
  W.link('Editorial Passed?', 'Sheet - PLAGIARISM_CHECK', 0);
  W.link('Editorial Passed?', 'Collect Attempt Failure', 1);
  W.chain('Sheet - PLAGIARISM_CHECK', 'Prepare Plagiarism Submission', 'Submit Plagiarism Scan', 'Normalize Plagiarism Response', 'Plagiarism Report Status');
  W.link('Submit Plagiarism Scan', 'Tag Error - Plagiarism', 1);
  W.link('Plagiarism Report Status', 'Evaluate Plagiarism Result', 0);
  W.link('Plagiarism Report Status', 'Wait For Plagiarism Report', 1);
  W.link('Plagiarism Report Status', 'Tag Error - Plagiarism', 2);
  W.chain('Wait For Plagiarism Report', 'Build Poll Requests', 'Retrieve Plagiarism Report', 'Normalize Poll Response', 'Plagiarism Report Status');
  W.link('Retrieve Plagiarism Report', 'Tag Error - Plagiarism', 1);
  W.chain('Evaluate Plagiarism Result', 'Record Plagiarism Result', 'Plagiarism Passed?');
  W.link('Record Plagiarism Result', 'Tag Error - Database', 1);
  W.link('Plagiarism Passed?', 'Format Approved Article', 0);
  W.link('Plagiarism Passed?', 'Collect Attempt Failure', 1);
  W.chain('Collect Attempt Failure', 'Check Attempt Limit');
  W.link('Check Attempt Limit', 'Sheet - REVISION_REQUIRED', 0);
  W.link('Check Attempt Limit', 'Prepare Review Outcome', 1);
  W.chain('Sheet - REVISION_REQUIRED', 'Build Article Revision Brief', 'Gemini - Revise Article', 'Revalidate Revised Article', 'Prepare Attempt');
  W.link('Gemini - Revise Article', 'Tag Error - Gemini Reviser', 1);

  // approval & docs
  W.link('Format Approved Article', 'Acquire Master Doc Lock', 0);
  W.link('Format Approved Article', 'Tag Error - Docs Before Write', 1);
  W.chain('Acquire Master Doc Lock', 'Doc Lock Acquired?');
  W.link('Acquire Master Doc Lock', 'Tag Error - Database', 1);
  W.link('Doc Lock Acquired?', 'Check Article Idempotency', 0);
  W.link('Doc Lock Acquired?', 'Count Doc Lock Wait', 1);
  W.chain('Count Doc Lock Wait', 'Lock Wait Allowed?');
  W.link('Lock Wait Allowed?', 'Wait For Doc Lock', 0);
  W.link('Lock Wait Allowed?', 'Tag Error - Docs Before Write', 1);
  W.link('Wait For Doc Lock', 'Acquire Master Doc Lock');
  W.link('Check Article Idempotency', 'Route Idempotency Decision', 0);
  W.link('Check Article Idempotency', 'Tag Error - Database', 1);
  W.link('Route Idempotency Decision', 'Get Master Doc', 0);
  W.link('Route Idempotency Decision', 'Finalize Approved Article', 1);
  W.link('Route Idempotency Decision', 'Read Master Doc For Verification', 2);
  W.link('Route Idempotency Decision', 'Prepare Review Outcome', 3);
  W.link('Get Master Doc', 'Build Docs Requests', 0);
  W.link('Get Master Doc', 'Tag Error - Docs Before Write', 1);
  W.chain('Build Docs Requests', 'Marker Already Present?');
  W.link('Marker Already Present?', 'Read Master Doc For Verification', 0);
  W.link('Marker Already Present?', 'Append Article to Master Google Doc', 1);
  W.link('Append Article to Master Google Doc', 'Read Master Doc For Verification', 0);
  W.link('Append Article to Master Google Doc', 'Mark Doc Write UNCERTAIN', 1);
  W.link('Mark Doc Write UNCERTAIN', 'Read Master Doc For Verification', 0);
  W.link('Mark Doc Write UNCERTAIN', 'Tag Error - Docs After Write', 1);
  W.link('Read Master Doc For Verification', 'Verify Google Docs Write', 0);
  W.link('Read Master Doc For Verification', 'Tag Error - Docs After Write', 1);
  W.chain('Verify Google Docs Write', 'Docs Write Verified?');
  W.link('Docs Write Verified?', 'Ledger - Mark VERIFIED', 0);
  W.link('Docs Write Verified?', 'Ledger - Mark FAILED', 1);
  W.link('Docs Write Verified?', 'Prepare Review Outcome', 2);
  W.link('Ledger - Mark VERIFIED', 'Finalize Approved Article', 0);
  W.link('Ledger - Mark VERIFIED', 'Tag Error - Docs After Write', 1);
  W.link('Ledger - Mark FAILED', 'Tag Error - Docs Verification', 0);
  W.link('Ledger - Mark FAILED', 'Tag Error - Database', 1);
  W.link('Recover Partial Success', 'Finalize Approved Article');
  W.link('Finalize Approved Article', 'Update Keyword APPROVED', 0);
  W.link('Finalize Approved Article', 'Tag Error - Database', 1);
  W.link('Update Keyword APPROVED', 'Log Approved Article', 0);
  W.link('Update Keyword APPROVED', 'Flag Sheet Sync Pending', 1);
  W.link('Log Approved Article', 'Mark Sheet Synced', 0);
  W.link('Log Approved Article', 'Flag Sheet Sync Pending', 1);
  W.link('Mark Sheet Synced', 'Keyword Outcome');
  W.link('Flag Sheet Sync Pending', 'Keyword Outcome');

  // review & errors
  W.chain('Prepare Review Outcome', 'Mark REVIEW_REQUIRED');
  W.link('Mark REVIEW_REQUIRED', 'Sheet - Mark REVIEW_REQUIRED', 0);
  W.link('Mark REVIEW_REQUIRED', 'Tag Error - Database', 1);
  W.chain('Sheet - Mark REVIEW_REQUIRED', 'Log Review Required Article', 'Keyword Outcome');
  for (const [n] of tags) W.link(n, 'Handle API Errors');
  W.link('Tag Error - Docs Verification', 'Handle API Errors');
  W.chain('Handle API Errors', 'Claim Lost?');
  W.link('Claim Lost?', 'Log Claim Lost', 0);
  W.link('Claim Lost?', 'Record Technical Failure', 1);
  W.link('Log Claim Lost', 'Keyword Outcome');
  W.chain('Record Technical Failure', 'Log Processing Failure', 'Has Article ID?');
  W.link('Has Article ID?', 'Log Failure To Article_Log', 0);
  W.link('Has Article ID?', 'Keyword Outcome', 1);
  W.link('Log Failure To Article_Log', 'Keyword Outcome');

  return W.toJSON({ ...SETTINGS, errorWorkflow: '' });
}

// ============================================================================
// 03 Error Recovery
// ============================================================================
function buildRecovery() {
  const W = new Workflow('03 Error Recovery');
  const wn = W.name;
  const CFG = "$('Recovery Configuration').first(0).json.config";
  W.add({ name: 'On Workflow Error', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: P(0, 0), parameters: {} });
  W.add(code('Describe Failure', P(1, 0), src('wf03/describe_failure.js')));
  const DF = "$('Describe Failure').first(0).json";
  const ECFG = "$('Recovery Configuration (Error Path)').first(0).json.config";
  W.add(pg('Record Failure Event', P(3, 0), "SELECT seo.log_event($1, $2, NULL, NULL, 'WORKFLOW_FAILED', 'ERROR', 'API_TRANSIENT', $3, jsonb_build_object('last_node', $4::text, 'mode', $5::text)) AS event_id;",
    [`${DF}.execution_id`, `${DF}.workflow_name`, `${DF}.message`, `${DF}.last_node`, `${DF}.mode`]));
  W.add(pg('Release Claims Of Failed Execution', P(4, 0), 'SELECT * FROM seo.release_claims_of_execution($1, $2, $3::int);',
    [`${DF}.execution_id`, `${DF}.message`, `${ECFG}.MAX_TECHNICAL_FAILURES`], { alwaysOutputData: true }));
  W.add(code('Drop Empty Released Rows', P(5, 0), src('wf03/drop_empty.js')));
  W.add(sheets('Requeue Failed Keywords', P(6, 0), {
    operation: 'update', documentId: `={{ ${ECFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${ECFG}.KEYWORDS_SHEET }}`, matchOn: 'Keyword_ID',
    values: { Keyword_ID: '={{ $json.keyword_id }}', Status: '={{ $json.sheet_status }}', Last_Error: "={{ 'Execution failed: ' + $('Describe Failure').first(0).json.message.slice(0, 800) }}" },
  }, { onError: 'continueRegularOutput' }));
  // the error branch needs the configuration too
  W.add(code('Recovery Configuration (Error Path)', P(2, 0), src('wf03/config.js')));

  W.add({ name: 'Manual Recovery Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: P(0, 2), parameters: {} });
  W.add({ name: 'Recovery Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: P(0, 3),
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } } });
  W.add(code('Recovery Configuration', P(1, 2.5), src('wf03/config.js')));
  // A: expired leases
  W.add(pg('Release Expired Claims', P(2, 2), 'SELECT * FROM seo.release_expired_claims($1::int);', [`${CFG}.MAX_TECHNICAL_FAILURES`], { alwaysOutputData: true }));
  W.add(code('Drop Empty Expired Rows', P(3, 2), src('wf03/drop_empty.js')));
  W.add(sheets('Requeue Interrupted Keywords', P(4, 2), {
    operation: 'update', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.KEYWORDS_SHEET }}`, matchOn: 'Keyword_ID',
    values: { Keyword_ID: '={{ $json.keyword_id }}', Status: '={{ $json.sheet_status }}', Last_Error: "={{ 'Interrupted execution ' + $json.previous_owner + ' released by Error Recovery' }}" },
  }, { onError: 'continueRegularOutput' }));
  // B: uncertain Google Docs writes
  W.add(pg('List Doc Writes To Reconcile', P(2, 3.4), 'SELECT * FROM seo.list_doc_writes_to_reconcile($1::int);', [`${CFG}.RECONCILE_MIN_AGE_MINUTES`], { alwaysOutputData: true }));
  W.add(code('Drop Empty Ledger Rows', P(3, 3.4), src('wf03/drop_empty.js')));
  W.add(http('Read Master Doc', P(4, 3.4), { auth: 'docs', url: `={{ ${CFG}.DOCS_API_BASE }}/documents/{{ $json.doc_id }}`, timeout: 60000 }, { retry: 3, onError: 'continueRegularOutput' }));
  W.add(code('Search For Article Marker', P(5, 3.4), src('wf03/search_marker.js')));
  W.add(switchNode(wn, 'Marker Found?', P(6, 3.4), '$json.verdict', [{ key: 'FOUND', equals: 'FOUND' }, { key: 'NOT_FOUND', equals: 'NOT_FOUND' }], 'READ_FAILED'));
  W.add(pg('Ledger - Mark VERIFIED (Recovery)', P(7, 3), "SELECT seo.set_doc_write_state($1::text, 'VERIFIED', 'reconciled by Error Recovery') AS ledger_state, $1::text AS article_id;", ['$json.article_id']));
  W.add(pg('Finalize Recovered Article', P(8, 3), "SELECT * FROM seo.finalize_approved_article($1, 'RECOVERY', $2, $3);",
    ['$json.article_id', `${CFG}.MASTER_DOC_ID`, `'https://docs.google.com/document/d/' + ${CFG}.MASTER_DOC_ID + '/edit'`]));
  W.add(pg('Ledger - Mark FAILED (Recovery)', P(7, 4),
    "SELECT seo.set_doc_write_state($1::text, 'FAILED', 'marker not found during reconciliation') AS ledger_state, $1::text AS article_id, $2::text AS keyword_id;",
    ['$json.article_id', '$json.keyword_id']));
  W.add(pg('Requeue After Failed Write', P(8, 4),
    "SELECT f.*, $1::text AS keyword_id FROM seo.mark_keyword_error($1::text, $2::text, 'RECOVERY', 'DOCS_RECONCILE', 'API_TRANSIENT', 'Google Docs write did not happen (reconciled); will retry', true, $3::int) f;",
    ['$json.keyword_id', '$json.article_id', `${CFG}.MAX_TECHNICAL_FAILURES`]));
  W.add(sheets('Requeue Keyword After Failed Write', P(9, 4), {
    operation: 'update', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.KEYWORDS_SHEET }}`, matchOn: 'Keyword_ID',
    values: { Keyword_ID: '={{ $json.keyword_id }}', Status: '={{ $json.sheet_status }}', Last_Error: 'Google Docs write was not completed; re-queued by Error Recovery' },
  }, { onError: 'continueRegularOutput' }));
  W.add({ name: 'Ledger Read Failed - Retry Later', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: P(7, 5), parameters: {} });
  // C: approved articles whose Sheets bookkeeping failed (includes those just finalized above)
  W.add(pg('List Unsynced Approved Articles', P(2, 5.6), 'SELECT * FROM seo.list_unsynced_approved();', [], { alwaysOutputData: true }));
  W.add(code('Drop Empty Unsynced Rows', P(3, 5.6), src('wf03/drop_empty.js')));
  W.add(sheets('Sync Keyword APPROVED', P(4, 5.6), {
    operation: 'update', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.KEYWORDS_SHEET }}`, matchOn: 'Keyword_ID',
    values: { Keyword_ID: '={{ $json.keyword_id }}', Status: 'APPROVED', Last_Error: '', Processed_At: `={{ DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-LL-dd HH:mm:ss') }}` },
  }, { onError: 'continueRegularOutput' }));
  W.add(code('Restore Unsynced Rows', P(5, 5.6), "// Sheets output replaced the items; continue with the article rows (same order).\nreturn $('Drop Empty Unsynced Rows').all(0).map((i) => ({ json: i.json }));"));
  const R = '$json';
  W.add(sheets('Sync Article_Log', P(6, 5.6), {
    operation: 'appendOrUpdate', documentId: `={{ ${CFG}.SPREADSHEET_ID }}`, sheetName: `={{ ${CFG}.ARTICLE_LOG_SHEET }}`, matchOn: 'Article_ID',
    values: {
      Article_ID: `={{ ${R}.article_id }}`, Keyword_ID: `={{ ${R}.keyword_id }}`, Target_Page_URL: `={{ ${R}.target_page_url }}`, Primary_Keyword: `={{ ${R}.primary_keyword }}`,
      Article_Title: `={{ ${R}.article_title }}`, SEO_Title: `={{ ${R}.seo_title }}`, Meta_Description: `={{ ${R}.meta_description }}`, URL_Slug: `={{ ${R}.url_slug }}`,
      Quality_Status: `={{ ${R}.quality_status }}`, EETA_Report: `={{ ${R}.eeta_summary }}`, Plagiarism_Percent: `={{ ${R}.plagiarism_percent }}`,
      Plagiarism_Status: `={{ ${R}.plagiarism_status }}`, Plagiarism_Report_URL: `={{ ${R}.plagiarism_report_ref }}`, Attempts: `={{ ${R}.attempt_count }}`,
      Google_Doc_ID: `={{ ${R}.google_doc_id }}`, Google_Doc_URL: `={{ ${R}.google_doc_url }}`, Status: 'APPROVED', Error: '',
      Updated_At: `={{ DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-LL-dd HH:mm:ss') }}`,
    },
  }, { onError: 'continueErrorOutput' }));
  W.add(pg('Mark Recovered Sheet Synced', P(7, 5.6), 'SELECT seo.set_sheet_sync($1, true, NULL) AS sheet_synced;', ["$('Restore Unsynced Rows').item.json.article_id"]));
  W.add({ name: 'Sheet Sync Still Pending', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: P(7, 6.4), parameters: {} });
  W.add(sticky('Note - Recovery', P(0, -2.4), '## 03 Error Recovery\n1. **Error Trigger**: set this workflow as the *Error Workflow* of 01 and 02 (Workflow settings). Logs the failure and immediately releases keyword claims held by the failed execution.\n2. **Every 30 min**: releases expired leases, reconciles uncertain Google Docs writes by searching for the article marker (never re-appends), and retries Sheets bookkeeping for approved articles.', 560, 260));

  W.chain('On Workflow Error', 'Describe Failure', 'Recovery Configuration (Error Path)', 'Record Failure Event', 'Release Claims Of Failed Execution', 'Drop Empty Released Rows', 'Requeue Failed Keywords');
  W.link('Manual Recovery Trigger', 'Recovery Configuration');
  W.link('Recovery Schedule', 'Recovery Configuration');
  W.link('Recovery Configuration', 'Release Expired Claims');
  W.link('Recovery Configuration', 'List Doc Writes To Reconcile');
  W.link('Recovery Configuration', 'List Unsynced Approved Articles');
  W.chain('Release Expired Claims', 'Drop Empty Expired Rows', 'Requeue Interrupted Keywords');
  W.chain('List Doc Writes To Reconcile', 'Drop Empty Ledger Rows', 'Read Master Doc', 'Search For Article Marker', 'Marker Found?');
  W.link('Marker Found?', 'Ledger - Mark VERIFIED (Recovery)', 0);
  W.link('Marker Found?', 'Ledger - Mark FAILED (Recovery)', 1);
  W.link('Marker Found?', 'Ledger Read Failed - Retry Later', 2);
  W.chain('Ledger - Mark VERIFIED (Recovery)', 'Finalize Recovered Article');
  W.chain('Ledger - Mark FAILED (Recovery)', 'Requeue After Failed Write', 'Requeue Keyword After Failed Write');
  W.chain('List Unsynced Approved Articles', 'Drop Empty Unsynced Rows', 'Sync Keyword APPROVED', 'Restore Unsynced Rows', 'Sync Article_Log');
  W.link('Sync Article_Log', 'Mark Recovered Sheet Synced', 0);
  W.link('Sync Article_Log', 'Sheet Sync Still Pending', 1);
  return W.toJSON({ ...SETTINGS });
}

const outputs = {
  '01_Brand_RAG_Ingestion.json': buildIngestion(),
  '02_SEO_Article_Automation.json': buildArticleAutomation(),
  '03_Error_Recovery.json': buildRecovery(),
};
const outDir = path.join(ROOT, 'workflows');
fs.mkdirSync(outDir, { recursive: true });
for (const [file, wf] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(wf, null, 2) + '\n');
  console.log(`wrote workflows/${file}: ${wf.nodes.length} nodes`);
}
