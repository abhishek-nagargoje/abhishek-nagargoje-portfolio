// MOCK external services for end-to-end tests of the workflows in a real n8n
// engine. NOTHING here talks to Google, Gemini or DupliChecker. Results from
// these tests prove workflow logic and wiring only - not the live APIs.
//
// Serves (HTTPS, self-signed): /gemini/v1beta/*, /dc/*, /docs/v1/*, /sheets/*,
// /site/* plus /__control (scenario) and /__state (inspection).
'use strict';
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.MOCK_PORT || 9443);
const tls = { key: fs.readFileSync(process.env.MOCK_KEY), cert: fs.readFileSync(process.env.MOCK_CERT) };
const KEYWORD_HEADERS = ['Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Supporting_Keywords', 'Search_Intent', 'Target_Audience', 'Target_Location', 'Language', 'Priority', 'Status', 'Processing_Started_At', 'Processed_At', 'Last_Error'];
const KB_HEADERS = ['Knowledge_ID', 'Category', 'Content', 'Source_URL', 'Approved', 'Last_Updated'];
const LOG_HEADERS = ['Article_ID', 'Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Article_Title', 'SEO_Title', 'Meta_Description', 'URL_Slug', 'Quality_Status', 'EETA_Report', 'Plagiarism_Percent', 'Plagiarism_Status', 'Plagiarism_Report_URL', 'Attempts', 'Google_Doc_ID', 'Google_Doc_URL', 'Status', 'Error', 'Created_At', 'Updated_At'];
const HEADERS = { Keywords: KEYWORD_HEADERS, Brand_Knowledge: KB_HEADERS, Article_Log: LOG_HEADERS };

let state;
function reset() {
  state = {
    scenario: { editorial_fail_attempts: [], plag_by_attempt: { 1: 25, 2: 3, 3: 3 }, plag_never_completes: false, prompt_invalid: false, article_invalid: false,
      docs_batch_status: 200, sheet_fail: {}, gemini_down: false },
    sheets: { Keywords: [], Brand_Knowledge: [], Article_Log: [] },
    docs: {}, docSeq: 0, calls: [], dcJobs: {}, dcSeq: 0, errors: [],
  };
}
reset();

// Deterministic bag-of-words embedding so related texts are similar.
function embed(text, dims) {
  const v = new Array(dims).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (w.length < 3) continue;
    const h = crypto.createHash('md5').update(w).digest();
    v[h.readUInt16BE(0) % dims] += 1; v[h.readUInt16BE(2) % dims] += 0.5;
  }
  v[0] += 0.05;
  return v.map((x) => x + 0.0001);
}
function article(attempt, kind, ctxText) {
  const facts = (ctxText.match(/"knowledge_id":"(KB-[0-9]+)"/g) || []).slice(0, 1).map((m) => m.match(/KB-[0-9]+/)[0]);
  const body = [
    'Recruitment services in India help growing companies hire the right people faster while staying compliant with local employment practices. This guide explains how structured hiring works and when outsourcing makes sense.',
    '## Why structured recruitment matters', 'A structured process defines the role, the selection criteria and the interview steps before sourcing begins. **Clear criteria** reduce bias and shorten time to hire. See our [recruitment services](https://127.0.0.1:9443/site/recruitment) page for how this works in practice.',
    '### Defining the role', 'Start with outcomes the role must deliver in the first year, then translate them into skills and experience requirements.',
    '## Steps in a recruitment engagement', '- Workforce planning and role definition', '- Sourcing and screening candidates', '- Interview coordination and offer management',
    '## Choosing a recruitment partner', 'Compare partners on process transparency, candidate experience and reporting. Ask how they verify candidate information and how they communicate with hiring managers.',
    'Mock filler paragraph '.repeat(1) + 'explaining onboarding, documentation, probation reviews and feedback loops in plain language for HR teams. '.repeat(40),
  ].join('\n\n');
  return {
    Article_Title: 'Recruitment Services in India: A Practical Guide (Mock v' + attempt + ')', SEO_Title: 'Recruitment Services in India: Practical Guide',
    H1: 'Recruitment Services in India: A Practical Guide', Meta_Description: 'Learn how recruitment services in India work, the steps involved and how to choose a partner that fits your hiring needs.',
    URL_Slug: 'Recruitment Services India Guide', Excerpt: 'A practical guide (' + kind + ' ' + attempt + ').', Article_Markdown: body,
    FAQs: [{ question: 'How long does recruitment take?', answer: 'It depends on the role; structured processes usually shorten it.' }],
    Internal_Link_Suggestions: [{ url: 'https://127.0.0.1:9443/site/recruitment', anchor_text: 'recruitment services', context: 'intro' }, { url: 'https://127.0.0.1:9443/site/invented', anchor_text: 'x', context: 'y' }],
    External_Sources: [{ title: 'Ministry of Labour and Employment', url: 'https://labour.gov.in/', publisher: 'Government of India', used_for: 'context' }],
    Verified_Brand_Facts_Used: facts.map((k) => ({ knowledge_id: k, fact: 'test fixture fact' })), Word_Count: 900,
  };
}
function geminiGenerate(body) {
  const sys = (body.systemInstruction && body.systemInstruction.parts[0].text) || '';
  const userText = body.contents.map((c) => c.parts.map((p) => p.text).join('')).join('\n');
  const corrective = body.contents.length > 1;
  let out;
  if (/ARTICLE-WRITING PROMPT/.test(sys)) {
    out = state.scenario.prompt_invalid ? 'this is not json' : JSON.stringify({
      article_objective: 'Explain recruitment services', unique_angle: 'Process-first view', target_reader: 'HR managers', search_intent: 'commercial',
      differentiation_from_target_page: 'deeper process detail', outline: [{ h2: 'Why', h3: [], key_points: [] }, { h2: 'Steps', h3: [], key_points: [] }, { h2: 'Choosing', h3: [], key_points: [] }],
      verified_facts_to_use: [{ knowledge_id: 'KB-001', fact: 'x' }, { knowledge_id: 'KB-999', fact: 'invented' }], forbidden_claims: ['client counts'], source_and_citation_requirements: ['official sources'],
      internal_linking_instructions: [{ url: 'https://127.0.0.1:9443/site/recruitment', anchor_text_suggestion: 'recruitment services', placement: 'intro' }],
      article_structure_requirements: ['H2 sections'], seo_metadata_requirements: { seo_title: 's', meta_description: 'm', url_slug: 'u', h1: 'h' },
      target_word_range: { min: 900, max: 1800 }, writing_prompt: 'Write a practical article. '.repeat(30), output_json_schema: {} });
  } else if (/strict senior editor/.test(sys)) {
    const m = /Mock v(\d+)/.exec(userText); const attempt = m ? Number(m[1]) : 1;
    const fail = state.scenario.editorial_fail_attempts.includes(attempt);
    const checks = JSON.parse(/REQUIRED_CHECKS: (\[[^\]]*\])/.exec(userText)[1]);
    out = JSON.stringify({ Overall_Status: fail ? 'FAIL' : 'PASS',
      Individual_Checks: checks.map((c) => ({ check: c, status: fail && c === 'Factual Accuracy' ? 'FAIL' : 'PASS', mandatory: true, severity: fail && c === 'Factual Accuracy' ? 'critical' : 'none', notes: '' })),
      Failed_Conditions: fail ? ['Unsupported claim about company size'] : [], Unsupported_Claims: fail ? [{ claim: 'serves 500 clients', reason: 'not in verified facts', severity: 'critical' }] : [],
      Required_Corrections: fail ? ['Remove the client count'] : [], Reviewer_Comments: 'mock review' });
  } else if (/experienced HR, payroll/.test(sys)) {
    const revising = /YOU ARE NOW REVISING/.test(sys);
    const m = /This is attempt (\d+) of/.exec(userText);
    const attempt = revising && m ? Number(m[1]) : 1;
    if (state.scenario.article_invalid) out = '{"Article_Title": "broken"';
    else out = JSON.stringify(article(attempt, revising ? 'revision' : 'initial', userText));
  } else out = '{}';
  state.calls.push({ api: 'gemini.generateContent', kind: /ARTICLE-WRITING/.test(sys) ? 'PROMPT' : /strict senior/.test(sys) ? 'EDITORIAL' : /REVISING/.test(sys) ? 'REVISION' : 'ARTICLE', corrective, json_mode: body.generationConfig && body.generationConfig.responseMimeType });
  return { candidates: [{ content: { parts: [{ text: out }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 1000 }, modelVersion: 'mock' };
}
function docJson(id) {
  const d = state.docs[id];
  return { documentId: id, title: d.title, revisionId: 'rev-' + d.rev, body: { content: [{ endIndex: 1, sectionBreak: {} }, { startIndex: 1, endIndex: d.text.length + 1, paragraph: { elements: [{ startIndex: 1, endIndex: d.text.length + 1, textRun: { content: d.text } }] } }] } };
}
function applyBatch(id, reqs) {
  const d = state.docs[id];
  for (const r of reqs) {
    const end = d.text.length + 1; // endIndex of body (final newline at end-1)
    if (r.insertText) {
      const idx = r.insertText.location.index;
      if (idx < 1 || idx > end - 1) throw new Error('insertText index ' + idx + ' out of range 1..' + (end - 1));
      d.text = d.text.slice(0, idx - 1) + r.insertText.text + d.text.slice(idx - 1);
    } else {
      const k = Object.keys(r)[0]; const range = r[k].range;
      if (!range) throw new Error('request ' + k + ' without range');
      if (range.startIndex < 1 || range.endIndex > end || range.startIndex >= range.endIndex) throw new Error(k + ' range ' + range.startIndex + '-' + range.endIndex + ' outside 1..' + end);
      if (k === 'updateTextStyle' && r[k].textStyle.link) {
        const linked = d.text.slice(range.startIndex - 1, range.endIndex - 1);
        d.links = (d.links || []).concat([{ text: linked, url: r[k].textStyle.link.url }]);
      }
      if (k === 'updateParagraphStyle' && r[k].paragraphStyle.namedStyleType && r[k].paragraphStyle.namedStyleType !== 'NORMAL_TEXT') {
        d.headings = (d.headings || []).concat([{ style: r[k].paragraphStyle.namedStyleType, text: d.text.slice(range.startIndex - 1, range.endIndex - 1) }]);
      }
      if (k === 'updateParagraphStyle' && r[k].paragraphStyle.pageBreakBefore === true) d.page_breaks = (d.page_breaks || 0) + 1;
    }
  }
  d.rev++;
}
function sheetRead(name) { return state.sheets[name].map((r, i) => Object.assign({ row_number: i + 2 }, Object.fromEntries(HEADERS[name].map((h) => [h, r[h] === undefined ? '' : r[h]])))); }
function sheetWrite(op, name, match, item) {
  if (state.scenario.sheet_fail[name]) { const e = new Error('mock Sheets failure for ' + name); e.status = 500; throw e; }
  const rows = state.sheets[name];
  const hdr = HEADERS[name];
  let idx = -1;
  if (match === 'row_number') idx = Number(item.row_number) - 2;
  else idx = rows.findIndex((r) => String(r[match]) === String(item[match]));
  const set = (row) => { for (const h of hdr) if (item[h] !== undefined) row[h] = item[h]; };
  if (idx >= 0 && rows[idx]) set(rows[idx]);
  else if (op === 'appendOrUpdate') { const row = {}; set(row); rows.push(row); }
  state.calls.push({ api: 'sheets.' + op, sheet: name, match, key: item[match], status: item.Status });
  return item;
}
const PAGES = {
  recruitment: '<html><head><title>Recruitment Services | HR Remedy India</title><meta name="description" content="Recruitment services test page."><link rel="canonical" href="https://127.0.0.1:9443/site/recruitment"></head><body><nav><a href="/site/about">About</a></nav><main><h1>Recruitment Services</h1><h2>How we hire</h2><p>' +
    'Test fixture page content describing recruitment process steps, screening, interviews and onboarding for employers in India. '.repeat(25) + '</p><a href="/site/payroll">Payroll</a><a href="https://example.com/x">ext</a></main><footer>f</footer></body></html>',
  'js-shell': '<html><head><title>App</title></head><body><div id="root"></div><script>window.x=1</script></body></html>',
};
function send(res, status, obj, type) { res.writeHead(status, { 'content-type': type || 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); }

https.createServer(tls, (req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'https://127.0.0.1');
    const p = url.pathname;
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
    try {
      if (p === '/__control') { if (body && body.reset) reset(); Object.assign(state.scenario, (body && body.scenario) || {}); if (body && body.sheets) Object.assign(state.sheets, body.sheets); return send(res, 200, { ok: true }); }
      if (p === '/__state') return send(res, 200, state);
      if (p.startsWith('/gemini/')) {
        if (url.searchParams.get('key') !== 'MOCK-GEMINI-KEY') return send(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
        if (body && JSON.stringify(body).includes('MOCK-GEMINI-KEY')) state.errors.push('Gemini key leaked into request body');
        if (state.scenario.gemini_down) return send(res, 503, { error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } });
        if (req.method === 'GET' && p.endsWith('/models')) return send(res, 200, { models: [
          { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent', 'countTextTokens'], inputTokenLimit: 2048 },
          { name: 'models/gemini-8.5-flash', displayName: 'Mock Flash 8.5', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 65536, inputTokenLimit: 1048576 },
          { name: 'models/gemini-9.0-flash-preview-01', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-8.0-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 65536 } ] });
        if (p.endsWith(':embedContent')) {
          if (body.outputDimensionality !== 768) return send(res, 400, { error: { message: 'mock expects outputDimensionality 768' } });
          state.calls.push({ api: 'gemini.embedContent', taskType: body.taskType });
          return send(res, 200, { embedding: { values: embed(body.content.parts[0].text, 768) } });
        }
        if (p.endsWith(':generateContent')) {
          if (!/models\/gemini-8\.5-flash:generateContent$/.test(p)) return send(res, 404, { error: { message: 'model not found ' + p } });
          return send(res, 200, geminiGenerate(body));
        }
      }
      if (p.startsWith('/dc/')) {
        state.calls.push({ api: 'duplichecker.' + p.split('/')[2], method: req.method, content_type: req.headers['content-type'] || '' });
        if (p === '/dc/info') return body && body.token === 'MOCK-TOKEN' ? send(res, 200, { name: 'Mock', email: 'm@example.com', username: 'mock', total_words: 100000, used_words: 100, status: 'active' }) : send(res, 401, { error: 'Invalid token' });
        if (p === '/dc/checkplag') {
          if (!body || body.token !== 'MOCK-TOKEN') return send(res, 401, { error: 'Invalid token' });
          if (!body.data) return send(res, 422, { error: 'data required' });
          const m = /Mock v(\d+)/.exec(body.data); const attempt = m ? Number(m[1]) : 1;
          const n = ++state.dcSeq; const hash = 'hash' + n; const key = 'key' + n;
          state.dcJobs[hash] = { key, attempt, polls: 0, rephrased: body.rephrased };
          return send(res, 200, { hash, key, recall: true });
        }
        const qm = /^\/dc\/query-footprint\/([^/]+)\/([^/]+)$/.exec(p);
        if (qm) {
          const job = state.dcJobs[qm[1]];
          if (!job || job.key !== qm[2]) return send(res, 404, { error: 'not found' });
          job.polls++;
          if (state.scenario.plag_never_completes || job.polls < 2) return send(res, 200, { recall: true, hash: qm[1] });
          const plag = state.scenario.plag_by_attempt[job.attempt] ?? 3;
          return send(res, 200, { recall: false, hash: qm[1], plagPercent: plag, uniquePercent: 100 - plag, rephrasedPercent: 1, exactMatchedPercent: plag,
            details: plag > 10 ? [{ query: 'Test fixture page content describing recruitment process steps, screening, interviews and onboarding for employers in India copied passage words', unique: 'false', webs: [{ title: 'Some site', url: 'https://example.com/copied' }] }] : [{ query: 'original sentence', unique: 'true', webs: [] }] });
        }
      }
      if (p.startsWith('/docs/v1/documents')) {
        if (req.method === 'POST' && p === '/docs/v1/documents') {
          const id = 'mockdoc' + (++state.docSeq); state.docs[id] = { title: body.title, text: '\n', rev: 1 };
          state.calls.push({ api: 'docs.create', id, title: body.title });
          return send(res, 200, { documentId: id, title: body.title });
        }
        const bm = /^\/docs\/v1\/documents\/([^/:]+):batchUpdate$/.exec(p);
        if (bm) {
          if (state.scenario.docs_batch_status !== 200) return send(res, state.scenario.docs_batch_status, { error: { code: state.scenario.docs_batch_status, message: 'mock docs failure' } });
          if (!state.docs[bm[1]]) return send(res, 404, { error: { message: 'no doc' } });
          applyBatch(bm[1], body.requests);
          state.calls.push({ api: 'docs.batchUpdate', id: bm[1], requests: body.requests.length, targetRevision: body.writeControl && body.writeControl.targetRevisionId });
          return send(res, 200, { documentId: bm[1], replies: body.requests.map(() => ({})), writeControl: { requiredRevisionId: 'rev-' + state.docs[bm[1]].rev } });
        }
        const gm = /^\/docs\/v1\/documents\/([^/:]+)$/.exec(p);
        if (gm) { state.calls.push({ api: 'docs.get', id: gm[1] }); return state.docs[gm[1]] ? send(res, 200, docJson(gm[1])) : send(res, 404, { error: { code: 404, message: 'Requested entity was not found.' } }); }
      }
      if (p.startsWith('/sheets/')) {
        const op = p.split('/')[2]; const name = url.searchParams.get('sheet');
        if (url.searchParams.get('doc') !== '171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg') return send(res, 404, { error: 'unexpected spreadsheet id ' + url.searchParams.get('doc') });
        if (!HEADERS[name]) return send(res, 400, { error: 'unknown sheet ' + name });
        if (op === 'read') { state.calls.push({ api: 'sheets.read', sheet: name }); return send(res, 200, sheetRead(name)); }
        return send(res, 200, sheetWrite(op, name, url.searchParams.get('match'), body));
      }
      if (p.startsWith('/site/')) {
        const page = PAGES[p.slice(6)];
        state.calls.push({ api: 'site', path: p, ua: req.headers['user-agent'] });
        return page ? send(res, 200, page, 'text/html; charset=utf-8') : send(res, 404, '<html><body>Not found</body></html>', 'text/html');
      }
      send(res, 404, { error: 'no mock for ' + req.method + ' ' + p });
    } catch (e) { state.errors.push(e.message); send(res, e.status || 400, { error: { message: e.message } }); }
  });
}).listen(PORT, '127.0.0.1', () => console.log('mock services on https://127.0.0.1:' + PORT));
