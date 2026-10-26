// Mock external services for end-to-end execution tests of the n8n workflows.
// NOT used in production. Emulates the documented request/response contracts
// the workflows rely on; scenario behaviour is selected by the primary keyword
// (Gemini) or by sentinel words in the scanned text (plagiarism).
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const SCENARIOS = {
  HAPPY: ['housekeeping services pune', 'office housekeeping services pune', 'facility maintenance services pune',
    'electrical maintenance services pune', 'plumbing maintenance services pune'],
  EDIT_ONCE: 'office cleaning checklist pune',          // writer v1 invents an award/certification; evaluator FAILs; reviser fixes
  DET_ONLY: 'security staffing services pune',           // writer v1 invents "500+ clients"; mock evaluator says PASS - deterministic layer must catch it
  PLAG_ONCE: 'security guard services pune',             // first text is "copied" (high similarity); revision fixes
  ALWAYS_FAIL: 'deep cleaning services pune',            // evaluator always FAILs -> MAX_ARTICLE_ATTEMPTS -> REVIEW_REQUIRED
  PLAG_401: 'pest control services pune',                // plagiarism API rejects the request (auth error)
  MISMATCH: 'used car dealers pune',                     // prompt creator reports keyword/page MISMATCH
  FLAKY_JSON: 'window cleaning services pune',           // first prompt-creator/writer/evaluator responses are malformed
  RATE_LIMIT: 'gutter cleaning services pune',           // writer returns HTTP 429 twice, then succeeds
  PLAG_ASYNC: 'carpet cleaning services pune',           // plagiarism report is asynchronous; ready on the 2nd poll
  PLAG_NEVER: 'sofa cleaning services pune',             // plagiarism report never becomes ready -> poll timeout
};
const bump = (state, key) => { state.counters[key] = (state.counters[key] || 0) + 1; return state.counters[key]; };

function createState() {
  return {
    sheets: { Keywords: [], Brand_Knowledge: [], Article_Log: [] },
    doc: { body: '\n', revision: 1 },
    calls: [],
    faults: {},
    counters: {},
    expected: { geminiKey: null, plagiarismToken: null },
  };
}

function send(res, status, body, type) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type || (typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json') });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

// ---------------------------------------------------------------- embeddings
function seededVector(seed, dims) {
  const out = [];
  let x = crypto.createHash('sha256').update(seed).digest();
  while (out.length < dims) {
    for (let i = 0; i < x.length && out.length < dims; i += 2) out.push(((x[i] << 8) | x[i + 1]) / 65535 - 0.5);
    x = crypto.createHash('sha256').update(x).digest();
  }
  return out;
}
function embeddingFor(text, dims) {
  const base = seededVector(/ZZTOPIC/.test(text) ? 'unrelated-topic' : 'facility-services-topic', dims);
  const noise = seededVector('noise:' + text, dims);
  const scale = /ZZTOPIC/.test(text) ? 0.05 : 0.25;
  return base.map((v, i) => +(v + scale * noise[i]).toFixed(6));
}

// ---------------------------------------------------------------- gemini
function geminiText(obj) {
  return { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: {} };
}
function extractKeyword(userText) {
  const m = userText.match(/"Primary_Keyword":\s*"([^"]+)"/) || userText.match(/Primary keyword: "([^"]+)"/);
  return m ? m[1] : '';
}
function extractTarget(userText) {
  const m = userText.match(/"Target_Page_URL":\s*"([^"]+)"/);
  return m ? m[1] : 'http://kargar-test.example:8787/housekeeping';
}
function extractIdentifiers(userText) {
  const m = userText.match(/<identifiers>\s*([\s\S]*?)\s*<\/identifiers>/);
  return m ? JSON.parse(m[1]) : {};
}

function promptCreatorResponse(kw, url) {
  const mismatch = kw === SCENARIOS.MISMATCH;
  return {
    Target_Page_URL: url, Primary_Keyword: kw, Search_Intent: 'Commercial investigation', Target_Audience: 'Facility and office managers in Pune',
    Page_Analysis: {
      Page_Topic: 'Commercial housekeeping and facility services in Pune', Page_Audience: 'Office administrators', Page_Search_Intent: 'Commercial',
      Keyword_Page_Fit: mismatch ? 'MISMATCH' : 'STRONG', Fit_Explanation: mismatch ? 'The page is about facility services; the keyword is about car dealerships.' : 'The page serves this service and intent.',
      Covered_Topics: ['Service overview', 'Contact form'], Content_Gaps: ['How to evaluate a provider', 'Scope checklist'], Duplication_Risk: 'Avoid repeating the service pitch; focus on evaluation guidance.',
    },
    Article_Objective: 'Help buyers evaluate services and guide them to the service page.',
    Unique_Content_Angle: 'A practical evaluation checklist for decision makers.',
    Article_Outline: { H1: `A practical guide to ${kw}`, Sections: [{ H2: 'What to define before you compare providers', Purpose: 'Scope', Key_Points: ['areas', 'frequency'] }, { H2: 'Questions to ask a provider', Purpose: 'Evaluation', Key_Points: ['supervision', 'training'] }, { H2: 'Planning the transition', Purpose: 'Onboarding', Key_Points: ['handover'] }], Recommended_Length_Words: 900, Length_Rationale: 'Commercial investigation needs a complete checklist.' },
    Approved_Brand_Facts: [{ Knowledge_ID: 'KB-001', Fact: 'KARGAR Facility Management provides housekeeping, security and facility maintenance services in Pune.' }],
    Source_Requirements: ['Only genuine public guidance pages; no statistics without a source.'],
    Forbidden_Claims: ['Any award, certification or client count', 'Response-time guarantees'],
    Internal_Link_Instructions: [{ URL: url, Anchor_Guidance: 'Descriptive anchor about the service', Placement: 'First third' }],
    Final_Article_Writing_Prompt: `Write an original, practical article for facility and office managers in Pune about "${kw}". `.repeat(6) + 'Use only approved brand facts, link to the target page with descriptive anchor text, cite only genuine sources, and never invent claims. Follow the outline exactly and keep paragraphs short.',
    Required_Output_Fields: ['Article_ID', 'Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Supporting_Keywords', 'Article_Title', 'SEO_Title', 'H1', 'Meta_Description', 'URL_Slug', 'Excerpt', 'Article_Markdown', 'Suggested_FAQs', 'Internal_Link_Suggestions', 'External_Sources', 'Verified_Brand_Facts_Used', 'Word_Count'],
    Validation_Rules: ['Link to the target page', 'No company statistics'],
  };
}

function articleResponse(ids, version, extraSentence) {
  const kw = ids.Primary_Keyword;
  const url = ids.Target_Page_URL;
  const ref = 'http://refs.example:8787/ref/cleaning-guidance';
  const para = (topic, i) => `Facility managers comparing ${kw} should look closely at ${topic}. A clear written scope avoids misunderstandings about which areas are covered, how often each task happens, and who checks the result. Point ${i} in this section explains why documented routines, trained supervisors and regular quality walks matter more than broad promises.`;
  const sections = [
    `# A practical guide to ${kw}`,
    `Choosing ${kw} is easier when you know what to ask. This guide explains how to define your requirements before you contact providers, and you can review our [${kw} page](${url}) for the specific services KARGAR Facility Management offers.`,
    extraSentence || '',
    '## What to define before you compare providers',
    para('the cleaning scope', 1), para('shift timings', 2),
    '## Questions to ask a provider',
    '- How are staff trained and supervised?',
    '- Which consumables and equipment are included?',
    '- How are complaints recorded and resolved?',
    para('supervision', 3), para('consumables', 4),
    '### Health and hygiene practices',
    `General guidance on cleaning and disinfection is available from public health bodies, for example this [cleaning guidance](${ref}). ${para('hygiene', 5)}`,
    '## Planning the transition',
    para('handover', 6), para('reporting', 7),
    `## Next steps\n\nList your areas, frequencies and reporting needs, then compare proposals line by line. Revision marker: version ${version}.`,
  ].filter(Boolean);
  return {
    Article_ID: ids.Article_ID, Keyword_ID: ids.Keyword_ID, Target_Page_URL: url, Primary_Keyword: kw, Supporting_Keywords: ids.Supporting_Keywords || [],
    Article_Title: `A practical guide to ${kw}`, SEO_Title: `Practical Guide to ${kw}`.slice(0, 60), H1: `A practical guide to ${kw}`,
    Meta_Description: `Learn how to evaluate ${kw}: scope, supervision, consumables and questions to ask before you choose a provider for your office or facility.`,
    URL_Slug: `${kw} guide`, Excerpt: 'How to evaluate providers before you sign.',
    Article_Markdown: sections.join('\n\n'),
    Suggested_FAQs: [{ Question: 'How often should offices be cleaned?', Answer: 'It depends on footfall and use; define frequencies per area in the scope.' }],
    Internal_Link_Suggestions: [{ URL: url, Anchor_Text: `${kw} page`, Placement: 'Introduction' }],
    External_Sources: [{ Title: 'Cleaning and disinfection guidance', URL: ref, Publisher: 'Public health body (test fixture)', Supports_Claim: 'General cleaning and disinfection guidance' }],
    Verified_Brand_Facts_Used: ['KB-001'], Word_Count: 700,
  };
}

const CHECKS = ['Experience_Check', 'Expertise_Check', 'Authoritativeness_Check', 'Trustworthiness_Check', 'Factual_Accuracy_Check',
  'SEO_Relevance_Check', 'Target_Page_Alignment_Check', 'Original_Value_Check', 'Readability_Check', 'Brand_Compliance_Check'];
function evaluatorResponse(kw, articleText) {
  const failAlways = kw === SCENARIOS.ALWAYS_FAIL;
  const invented = /award-winning|ISO 9001/.test(articleText);
  const fail = failAlways || invented;
  const checks = Object.fromEntries(CHECKS.map((c) => [c, { Status: 'PASS', Explanation: 'Meets the criterion.' }]));
  if (fail) {
    checks.Trustworthiness_Check = { Status: 'FAIL', Explanation: invented ? 'Claims an award and ISO 9001 certification not present in brand knowledge.' : 'Contains generic, unsupported performance claims.' };
    checks.Original_Value_Check = { Status: 'FAIL', Explanation: 'Generic content.' };
  }
  return {
    Overall_Status: fail ? 'FAIL' : 'PASS', ...checks,
    Failed_Conditions: fail ? ['UNSUPPORTED_BRAND_CLAIM'] : [],
    Unsupported_Claims: invented ? [{ Claim: 'KARGAR is an award-winning ISO 9001 certified company.', Reason: 'Not in brand knowledge', Severity: 'CRITICAL' }] : [],
    Missing_Information: fail ? ['Concrete evaluation criteria'] : [],
    Required_Corrections: fail ? ['Remove the award and certification claim', 'Add concrete criteria'] : [],
    Reviewer_Comments: fail ? 'Not publishable yet.' : 'Accurate and useful.',
  };
}

async function handleGemini(state, req, res, url, body) {
  if (state.expected.geminiKey && req.headers['x-goog-api-key'] !== state.expected.geminiKey) {
    return send(res, 401, { error: { code: 401, message: 'API key not valid.', status: 'UNAUTHENTICATED' } });
  }
  const m = url.pathname.match(/^\/gemini\/v1beta\/models\/([^:/]+)(?::(\w+))?$/);
  if (!m) return send(res, 404, { error: { message: 'not found' } });
  const [, model, method] = m;
  if (!method && req.method === 'GET') return send(res, 200, { name: `models/${model}`, displayName: model });
  const data = body ? JSON.parse(body) : {};
  if (method === 'embedContent') {
    const text = data.content.parts.map((p) => p.text).join(' ');
    state.calls.push({ service: 'gemini', op: 'embed', taskType: data.taskType, dims: data.outputDimensionality });
    return send(res, 200, { embedding: { values: embeddingFor(text, data.outputDimensionality || 3072) } });
  }
  if (method !== 'generateContent') return send(res, 404, { error: { message: 'unknown method' } });
  const system = data.systemInstruction.parts[0].text;
  const user = data.contents[0].parts[0].text;
  const kw = extractKeyword(user);
  const isCorrection = data.contents.length > 1;
  if (/senior SEO content strategist/.test(system)) {
    state.calls.push({ service: 'gemini', op: 'prompt_creator', kw, isCorrection });
    if (kw === SCENARIOS.FLAKY_JSON && !isCorrection) {
      return send(res, 200, { candidates: [{ content: { parts: [{ text: 'Sure! Here is the brief you asked for: Objective - help readers...' }] }, finishReason: 'STOP' }] });
    }
    return send(res, 200, geminiText(promptCreatorResponse(kw, extractTarget(user))));
  }
  if (/expert writer/.test(system)) {
    const ids = extractIdentifiers(user);
    state.calls.push({ service: 'gemini', op: 'writer', kw: ids.Primary_Keyword, isCorrection });
    if (ids.Primary_Keyword === SCENARIOS.RATE_LIMIT && bump(state, 'writer429') <= 2) {
      return send(res, 429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } });
    }
    if (ids.Primary_Keyword === SCENARIOS.FLAKY_JSON && !isCorrection) {
      const broken = articleResponse(ids, 1, '');
      delete broken.Article_Markdown;
      return send(res, 200, geminiText(broken));
    }
    let extra = '';
    if (ids.Primary_Keyword === SCENARIOS.EDIT_ONCE) extra = 'KARGAR is an award-winning ISO 9001 certified company.';
    if (ids.Primary_Keyword === SCENARIOS.DET_ONLY) extra = 'KARGAR has served 500+ clients across Pune.';
    if (ids.Primary_Keyword === SCENARIOS.PLAG_ONCE) extra = 'PLAGSENTINEL This paragraph was copied from a competitor website without attribution and repeats their wording.';
    if (ids.Primary_Keyword === SCENARIOS.PLAG_401) extra = 'AUTHSENTINEL routine paragraph.';
    if (ids.Primary_Keyword === SCENARIOS.PLAG_ASYNC) extra = 'ASYNCSENTINEL routine paragraph.';
    if (ids.Primary_Keyword === SCENARIOS.PLAG_NEVER) extra = 'NEVERSENTINEL routine paragraph.';
    return send(res, 200, geminiText(articleResponse(ids, 1, extra)));
  }
  if (/strict, independent editorial reviewer/.test(system)) {
    const articleBlock = (user.match(/<article>\s*([\s\S]*?)\s*<\/article>/) || [])[1] || '';
    state.calls.push({ service: 'gemini', op: 'evaluator', kw, isCorrection });
    if (kw === SCENARIOS.FLAKY_JSON && !isCorrection) {
      return send(res, 200, { candidates: [{ content: { parts: [{ text: '{"Overall_Status":"PASS","Experience_Check":{"Status":"PA' }] }, finishReason: 'MAX_TOKENS' }] });
    }
    return send(res, 200, geminiText(evaluatorResponse(kw, articleBlock)));
  }
  if (/senior editor revising/.test(system)) {
    const ids = extractIdentifiers(user);
    const attempt = state.calls.filter((c) => c.op === 'reviser' && c.kw === ids.Primary_Keyword).length + 2;
    state.calls.push({ service: 'gemini', op: 'reviser', kw: ids.Primary_Keyword, failed: (user.match(/<failed_conditions>\s*([\s\S]*?)\s*<\/failed_conditions>/) || [])[1] });
    const extra = ids.Primary_Keyword === SCENARIOS.PLAG_401 ? 'AUTHSENTINEL routine paragraph.' : '';
    return send(res, 200, geminiText({ ...articleResponse(ids, attempt, extra), Corrections_Report: [{ Issue: 'Failed conditions', Action: 'Removed unsupported/copied text and rewrote the section', Location: 'Introduction' }] }));
  }
  return send(res, 400, { error: { message: 'unrecognised system instruction' } });
}

// ---------------------------------------------------------------- plagiarism (DupliChecker contract)
function handlePlagiarism(state, req, res, url, body) {
  const token = url.searchParams.get('token');
  if (!token || token !== state.expected.plagiarismToken) return send(res, 401, { error: 'Invalid token' });
  if (url.pathname.endsWith('/api/info')) {
    state.calls.push({ service: 'plagiarism', op: 'info' });
    return send(res, 200, { status: 'success', words_remaining: 250000 });
  }
  const poll = url.pathname.match(/\/api\/query-footprint\/([^/]+)\/([^/]+)$/);
  if (poll) {
    const n = bump(state, 'poll:' + poll[1]);
    state.calls.push({ service: 'plagiarism', op: 'poll', footprint: poll[1], n });
    const job = state.plagJobs && state.plagJobs[poll[1]];
    if (!job) return send(res, 404, { error: 'unknown job' });
    if (job.never || n < 2) return send(res, 200, { query_footprint: poll[1], key: poll[2], status: 'processing' });
    const sentences = job.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    return send(res, 200, { details: sentences.map((s) => ({ query: s, unique: true })), exactMatchedPercent: 0, rephrasedPercent: 0 });
  }
  const form = new URLSearchParams(body);
  const text = form.get('data') || '';
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const sha = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  state.calls.push({ service: 'plagiarism', op: 'check', sha, rephrased: form.get('rephrased'), words: text.split(/\s+/).length });
  if (/AUTHSENTINEL/.test(text)) return send(res, 401, { error: 'Invalid token or plan expired' });
  if (/ASYNCSENTINEL|NEVERSENTINEL/.test(text)) {
    const footprint = 'fp' + sha;
    state.plagJobs = state.plagJobs || {};
    state.plagJobs[footprint] = { text, never: /NEVERSENTINEL/.test(text) };
    return send(res, 200, { query_footprint: footprint, key: 'k' + sha.slice(0, 6), status: 'queued' });
  }
  const copied = /PLAGSENTINEL/.test(text);
  const details = sentences.map((s, i) => ({ query: s, unique: copied ? i % 2 === 1 : true, ...(copied && i % 2 === 0 ? { display: { url: 'https://competitor.example/copied-page' } } : {}) }));
  return send(res, 200, { details, exactMatchedPercent: copied ? 45 : 0, rephrasedPercent: copied ? 5 : 0 });
}

// ---------------------------------------------------------------- google docs
function docStructure(state, id) {
  const B = state.doc.body;
  const content = [{ endIndex: 1, sectionBreak: {} }];
  let idx = 1;
  for (const line of B.split('\n').slice(0, -1)) {
    const len = line.length + 1;
    content.push({ startIndex: idx, endIndex: idx + len, paragraph: { elements: [{ startIndex: idx, endIndex: idx + len, textRun: { content: line + '\n' } }] } });
    idx += len;
  }
  return { documentId: id, title: 'Approved SEO Articles (test)', revisionId: `rev-${state.doc.revision}`, body: { content } };
}
function handleDocs(state, req, res, url, body) {
  const m = url.pathname.match(/^\/docs\/v1\/documents\/([^/:]+)(:batchUpdate)?$/);
  if (!m) return send(res, 404, { error: { message: 'not found' } });
  const id = m[1];
  if (!m[2]) {
    state.calls.push({ service: 'docs', op: 'get' });
    return send(res, 200, docStructure(state, id));
  }
  const data = JSON.parse(body);
  state.calls.push({ service: 'docs', op: 'batchUpdate', requests: data.requests.length });
  if (state.faults.docsBatch === '403') {
    state.faults.docsBatch = null;
    return send(res, 403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } });
  }
  if (data.writeControl && data.writeControl.requiredRevisionId && data.writeControl.requiredRevisionId !== `rev-${state.doc.revision}`) {
    return send(res, 400, { error: { code: 400, message: 'The required revision ID does not match the latest revision.' } });
  }
  let B = state.doc.body;
  const inRange = (r) => r.startIndex >= 1 && r.endIndex <= B.length + 1 && r.startIndex < r.endIndex;
  for (const reqObj of data.requests) {
    const [type, p] = Object.entries(reqObj)[0];
    if (type === 'insertText' || type === 'insertPageBreak') {
      const i = p.location.index;
      if (i < 1 || i > B.length) return send(res, 400, { error: { code: 400, message: `Invalid insertion index ${i} (length ${B.length})` } });
      const t = type === 'insertText' ? p.text : '\f\n';
      B = B.slice(0, i - 1) + t + B.slice(i - 1);
    } else if (['updateParagraphStyle', 'updateTextStyle', 'createParagraphBullets'].includes(type)) {
      if (!inRange(p.range)) return send(res, 400, { error: { code: 400, message: `${type}: range ${JSON.stringify(p.range)} out of bounds (length ${B.length})` } });
    } else {
      return send(res, 400, { error: { code: 400, message: `Unsupported request ${type}` } });
    }
  }
  state.doc.body = B;
  state.doc.revision += 1;
  if (state.faults.docsBatch === '500_after_apply') {
    state.faults.docsBatch = null;
    return send(res, 500, { error: { code: 500, message: 'Internal error (simulated after applying the update)' } });
  }
  return send(res, 200, { documentId: id, replies: data.requests.map(() => ({})), writeControl: { requiredRevisionId: `rev-${state.doc.revision}` } });
}

// ---------------------------------------------------------------- google sheets (in-memory)
function handleSheets(state, req, res, url, body) {
  if (url.pathname === '/sheets/read') {
    const tab = url.searchParams.get('tab');
    state.calls.push({ service: 'sheets', op: 'read', tab });
    if (!state.sheets[tab]) return send(res, 400, { error: `Sheet ${tab} not found` });
    return send(res, 200, state.sheets[tab].map((r, i) => ({ row_number: i + 2, ...r })));
  }
  const data = JSON.parse(body);
  const rows = state.sheets[data.tab];
  state.calls.push({ service: 'sheets', op: data.op, tab: data.tab, values: data.values });
  if (!rows) return send(res, 400, { error: `Sheet ${data.tab} not found` });
  const f = state.faults.sheets;
  if (f && f.tab === data.tab && (!f.status || data.values.Status === f.status) && f.remaining > 0) {
    f.remaining -= 1;
    return send(res, 500, { error: { code: 500, message: 'Backend Error (simulated)' } });
  }
  let row;
  if (data.matchOn === 'row_number') row = rows[Number(data.values.row_number) - 2];
  else row = rows.find((r) => String(r[data.matchOn]) === String(data.values[data.matchOn]));
  const values = { ...data.values };
  delete values.row_number;
  if (row) Object.assign(row, values);
  else if (data.op === 'appendOrUpdate') rows.push(values);
  return send(res, 200, row || values);
}

// ---------------------------------------------------------------- target pages
function pageHtml(title, h1, words) {
  const body = Array.from({ length: words }, (_, i) => `Paragraph ${i}: KARGAR Facility Management provides trained housekeeping teams, supervisors and scheduled maintenance for offices and commercial facilities in Pune.`).join('</p><p>');
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="${title} for offices in Pune."><link rel="canonical" href="http://kargar-test.example:8787/housekeeping"></head>
<body><header><nav><a href="/">Home</a></nav></header><main><h1>${h1}</h1><h2>Our services</h2><h2>Why choose us</h2><h3>Trained staff</h3>
<p>${body}</p><a class="btn" href="/contact">Request a quote</a> <a href="/services/facility-management">Facility management</a></main><footer>footer</footer></body></html>`;
}
function handleSite(state, req, res, url) {
  state.calls.push({ service: 'site', op: 'get', path: url.pathname });
  if (url.pathname === '/missing') return send(res, 404, '<html><body>Not found</body></html>');
  if (url.pathname === '/js-app') return send(res, 200, '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  if (url.pathname.startsWith('/ref/')) return send(res, 200, '<html><body><h1>Guidance</h1><p>Reference page.</p></body></html>');
  return send(res, 200, pageHtml('Housekeeping Services in Pune | KARGAR', 'Housekeeping and Facility Services in Pune', 12));
}

function createMockServer(state) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = await readBody(req);
    try {
      if (url.pathname.startsWith('/gemini/')) return await handleGemini(state, req, res, url, body);
      if (url.pathname.startsWith('/dupli/')) return handlePlagiarism(state, req, res, url, body);
      if (url.pathname.startsWith('/docs/')) return handleDocs(state, req, res, url, body);
      if (url.pathname.startsWith('/sheets/')) return handleSheets(state, req, res, url, body);
      return handleSite(state, req, res, url);
    } catch (e) {
      return send(res, 500, { error: { message: 'mock failure: ' + e.message } });
    }
  });
}

module.exports = { createState, createMockServer, SCENARIOS };
