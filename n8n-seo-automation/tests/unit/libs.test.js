// Unit tests for the Code-node libraries. Run: node --test tests/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs } = require('./load_libs');

const L = loadLibs(['common', 'gemini', 'article', 'plagiarism', 'docs']);
const CFG = { ALLOWED_URL_SCHEMES: ['https:', 'http:'], ALLOWED_TARGET_DOMAINS: [], ARTICLE_MIN_WORDS: 120, REQUIRE_TARGET_PAGE_LINK: true, PLAGIARISM_THRESHOLD_PERCENT: 10 };

test('URL validation rejects unsafe or malformed URLs and normalises identity', () => {
  assert.equal(L.validateTargetUrl('https://www.Example.com/housekeeping/?utm_source=x#top', CFG).normalized, 'https://www.example.com/housekeeping');
  assert.equal(L.validateTargetUrl('ftp://example.com/a', CFG).ok, false);
  assert.equal(L.validateTargetUrl('http://localhost/a', CFG).ok, false);
  assert.equal(L.validateTargetUrl('https://10.0.0.5/a', CFG).ok, false);
  assert.equal(L.validateTargetUrl('https://user:pw@example.com/', CFG).ok, false);
  assert.equal(L.validateTargetUrl('not a url', CFG).ok, false);
  assert.equal(L.validateTargetUrl('', CFG).ok, false);
  assert.equal(L.validateTargetUrl('https://other.com/x', { ...CFG, ALLOWED_TARGET_DOMAINS: ['example.com'] }).ok, false);
  assert.equal(L.validateTargetUrl('https://www.example.com/x', { ...CFG, ALLOWED_TARGET_DOMAINS: ['example.com'] }).ok, true);
  assert.equal(L.normalizeKeyword('  Housekeeping   Services, PUNE '), 'housekeeping services pune');
});

test('parseUrl works without the WHATWG URL global (n8n task-runner sandbox)', () => {
  assert.equal(L.parseUrl('https://Example.com:8443/a/b/../c?x=1#h').href, 'https://example.com:8443/a/c?x=1#h');
  assert.equal(L.parseUrl('/contact', 'https://example.com/services/housekeeping').href, 'https://example.com/contact');
  assert.equal(L.parseUrl('pricing', 'https://example.com/services/housekeeping').href, 'https://example.com/services/pricing');
  assert.equal(L.parseUrl('//cdn.example.com/x', 'https://example.com/').href, 'https://cdn.example.com/x');
  assert.equal(L.parseUrl('mailto:a@b.com', 'https://example.com/'), null);
  assert.equal(L.parseUrl('javascript:void(0)', 'https://example.com/'), null);
  assert.equal(L.parseUrl('https://exa mple.com/'), null);
  assert.equal(L.parseUrl('https:///nohost'), null);
  assert.equal(L.parseUrl('http://kargar-test.example:8787/housekeeping').hostname, 'kargar-test.example');
  assert.equal(L.normalizeUrl('HTTPS://www.example.com:443/a/?utm_medium=x&b=2&a=1'), 'https://www.example.com/a/?a=1&b=2');
  assert.equal(L.normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(L.validateTargetUrl('mailto:x@example.com', CFG).ok, false);
});

test('secret scrubbing and error classification', () => {
  const fakeKey = ['AI', 'za', 'SyA1234567890abcdefghijkl'].join(''); // built at runtime so secret scanners don't flag the fixture
  assert.ok(!L.scrubSecrets(`x-goog-api-key: ${fakeKey}`).includes('SyA123'));
  assert.ok(!L.scrubSecrets(`key=${fakeKey}`).includes('SyA123'));
  assert.ok(!L.scrubSecrets('https://x.com/api?token=abc123&x=1').includes('abc123'));
  assert.equal(L.classifyNodeError({ error: { message: 'Forbidden', httpCode: '403' } }, 'GEMINI').error_class, 'CONFIGURATION');
  assert.equal(L.classifyNodeError({ error: { message: 'Too Many Requests', httpCode: '429' } }, 'GEMINI').retryable, true);
  assert.equal(L.classifyNodeError({ error: 'CLAIM_LOST: keyword KW1 is claimed by 9' }, 'DB').error_class, 'CLAIM_LOST');
  assert.equal(L.classifyNodeError({ error: { message: 'Service unavailable', httpCode: 503 } }, 'GEMINI').error_class, 'API_TRANSIENT');
});

test('Gemini response parsing handles thoughts, fences, truncation and blocks', () => {
  const ok = L.parseGeminiJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking', thought: true }, { text: '```json\n{"a":1}\n```' }] } }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.a, 1);
  assert.equal(L.parseGeminiJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }] }).errorType, 'TRUNCATED');
  assert.equal(L.parseGeminiJson({ promptFeedback: { blockReason: 'SAFETY' } }).errorType, 'BLOCKED');
  assert.equal(L.parseGeminiJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }).errorType, 'INVALID');
  const schema = { type: 'OBJECT', required: ['x', 'y'], properties: { x: { type: 'STRING', enum: ['A'] }, y: { type: 'ARRAY', items: { type: 'INTEGER' } } } };
  assert.deepEqual(L.checkAgainstSchema({ x: 'A', y: [1] }, schema), []);
  assert.equal(L.checkAgainstSchema({ x: 'B', y: ['1'] }, schema).length, 2);
  const corr = L.buildCorrectionRequest(L.buildGeminiRequest('sys', { a: 1 }, schema, 100), 'bad', ['p1']);
  assert.equal(corr.contents.length, 3);
  assert.equal(corr.contents[1].role, 'model');
});

const ctx = {
  article_id: 'ART-1', keyword_id: 'KW001', target_page_url: 'https://example.com/housekeeping',
  primary_keyword: 'housekeeping services Pune', supporting_keywords: ['office cleaning'], site_host: 'example.com',
};
const filler = Array.from({ length: 30 }, (_, i) => `Sentence ${i} explains a distinct practical housekeeping consideration for offices in detail.`).join(' ');
function goodArticle() {
  return {
    Article_ID: 'x', Keyword_ID: 'x', Target_Page_URL: 'https://example.com/housekeeping', Primary_Keyword: 'Housekeeping Services Pune',
    Supporting_Keywords: [], Article_Title: 'Choosing housekeeping services in Pune', SEO_Title: 'Choosing Housekeeping Services in Pune',
    H1: 'Choosing housekeeping services in Pune', Meta_Description: 'A practical guide to evaluating housekeeping services in Pune for offices: scope, staffing, checklists and questions to ask providers.',
    URL_Slug: 'Choosing Housekeeping Services Pune', Excerpt: 'How to evaluate a provider.',
    Article_Markdown: `# Choosing housekeeping services in Pune\n\n${filler}\n\n## What to check\n\nSee our [housekeeping services in Pune](https://example.com/housekeeping) page. ${filler.slice(0, 300)}\n\n## Questions to ask\n\n- Scope of work\n- Supervision\n\nGuidance from [OSHA cleaning guidance](https://www.osha.gov/cleaning).`,
    Suggested_FAQs: [{ Question: 'How often?', Answer: 'Depends on traffic.' }],
    Internal_Link_Suggestions: [{ URL: 'https://example.com/housekeeping', Anchor_Text: 'housekeeping services in Pune', Placement: 'What to check' }],
    External_Sources: [{ Title: 'Cleaning guidance', URL: 'https://www.osha.gov/cleaning', Publisher: 'OSHA', Supports_Claim: 'Cleaning practices' }],
    Verified_Brand_Facts_Used: ['K1'], Word_Count: 1,
  };
}

test('validateArticle accepts a well-formed article and pins identifiers', () => {
  const r = L.validateArticle(goodArticle(), ctx, ['https://example.com/housekeeping'], CFG);
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
  assert.equal(r.article.Article_ID, 'ART-1');
  assert.equal(r.article.URL_Slug, 'choosing-housekeeping-services-pune');
  assert.ok(r.article.Word_Count > 120);
});

test('validateArticle rejects keyword mismatch, invented internal links, missing target link, unlisted external links', () => {
  const a = goodArticle();
  a.Primary_Keyword = 'security services Mumbai';
  a.Article_Markdown = a.Article_Markdown.replace('https://example.com/housekeeping', 'https://example.com/invented-page')
    .replace('https://www.osha.gov/cleaning', 'https://fake-study.example.org/x');
  const r = L.validateArticle(a, ctx, ['https://example.com/housekeeping'], CFG);
  const codes = r.errors.map((e) => e.split(':')[0]);
  assert.ok(codes.includes('KEYWORD_MISMATCH'));
  assert.ok(codes.includes('UNVERIFIED_INTERNAL_LINK'));
  assert.ok(codes.includes('MISSING_TARGET_LINK'));
  assert.ok(codes.includes('UNLISTED_EXTERNAL_LINK'));
  assert.equal(r.valid, false);
  assert.equal(r.article.Primary_Keyword, 'housekeeping services Pune');
});

test('validateArticle rejects empty body and bad sources', () => {
  const a = goodArticle();
  a.Article_Markdown = '';
  a.External_Sources = [{ Title: '', URL: 'notaurl', Supports_Claim: '' }];
  const r = L.validateArticle(a, ctx, [], CFG);
  assert.equal(r.usable, false);
  assert.ok(r.errors.some((e) => e.startsWith('MISSING_FIELD: Article_Markdown')));
  assert.ok(r.errors.some((e) => e.startsWith('SOURCE_INVALID')));
});

test('deterministic claim checks flag invented awards/statistics but not supported facts', () => {
  const chunks = [{ content: 'KARGAR Facility Management provides housekeeping and security services in Pune.' }];
  const bad = { Article_Markdown: '# T\n\nKARGAR is an award-winning ISO 9001 certified company.\n\nWe have served 500+ clients across India.\n\nOur team cleans offices twice a week.' };
  const f = L.deterministicClaimChecks(bad, chunks, ['KARGAR']);
  const codes = f.map((x) => x.code);
  assert.ok(codes.includes('UNSUPPORTED_BRAND_CREDENTIAL'));
  assert.ok(codes.includes('UNSUPPORTED_BRAND_STATISTIC'));
  assert.equal(f.length, 2);
  const good = { Article_Markdown: 'KARGAR Facility Management provides housekeeping and security services in Pune.' };
  assert.deepEqual(L.deterministicClaimChecks(good, chunks, ['KARGAR']), []);
});

test('plagiarism normalisation: details-based percent, fail-closed on errors and unknown formats', () => {
  const text = 'One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.';
  const r = L.normalizePlagiarismResponse(200, { details: [{ query: 'One two three four five six seven eight nine ten.', unique: 'false', display: { url: 'https://src.example/a' } }, { query: 'Eleven ...', unique: true }], exactMatchedPercent: 30, rephrasedPercent: 5 }, text, {});
  assert.equal(r.state, 'COMPLETE');
  assert.equal(r.computed_percent, 50);
  assert.equal(r.similarity_percent, 50);
  assert.deepEqual(r.matched_passages[0].sources, ['https://src.example/a']);
  assert.equal(L.normalizePlagiarismResponse(401, {}, text, {}).error_class, 'CONFIGURATION');
  assert.equal(L.normalizePlagiarismResponse(503, 'Bad gateway', text, {}).retryable, true);
  assert.equal(L.normalizePlagiarismResponse(200, { error: 'Invalid token' }, text, {}).error_class, 'CONFIGURATION');
  const unknown = L.normalizePlagiarismResponse(200, { foo: 1 }, text, {});
  assert.equal(unknown.state, 'ERROR');
  assert.match(unknown.message, /REPORT_UNPARSEABLE/);
  assert.equal(L.normalizePlagiarismResponse(200, { query_footprint: 'abc' }, text, {}).state, 'PENDING');
  assert.equal(L.normalizePlagiarismResponse(200, { result: { percent: '7.5' } }, text, { PLAGIARISM_PERCENT_FIELD: 'result.percent' }).similarity_percent, 7.5);
  const pass = L.decidePlagiarism([{ words: 100, similarity_percent: 4, matched_passages: [] }, { words: 100, similarity_percent: 12, matched_passages: [] }], CFG);
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.percent, 8);
  assert.equal(L.decidePlagiarism([{ words: 100, similarity_percent: 11, matched_passages: [] }], CFG).status, 'FAIL');
  assert.equal(L.chunkTextByWords(Array(2500).fill('word.').join(' '), 1000).length, 3);
});

test('Google Docs requests are index-consistent and complete', () => {
  const art = L.validateArticle(goodArticle(), ctx, ['https://example.com/housekeeping'], CFG).article;
  const ps = L.buildArticleParagraphs(art, { generation_date: '2026-10-26', quality_status: 'PASS', plagiarism_result: 'PASS (3%)', plagiarism_report_ref: 'pg:ref' });
  const base = 120;
  const { requests, text } = L.buildDocsRequests(ps, base, true);
  assert.equal(requests[0].insertText.location.index, base);
  assert.equal(requests[0].insertText.text, '\n' + text);
  const end = base + 1 + text.length;
  for (const r of requests.slice(1)) {
    const body = Object.values(r)[0];
    if (body.range) {
      assert.ok(body.range.startIndex >= base + 1 && body.range.endIndex <= end && body.range.startIndex < body.range.endIndex, JSON.stringify(r));
    }
  }
  assert.ok(text.includes('SEO-ARTICLE-MARKER: ART-1'));
  assert.ok(text.includes('Frequently Asked Questions'));
  assert.ok(text.includes('References'));
  assert.ok(!text.includes('](http'), 'markdown link syntax must be converted');
  assert.ok(requests.some((r) => r.updateTextStyle && r.updateTextStyle.textStyle.link && r.updateTextStyle.textStyle.link.url === 'https://example.com/housekeeping'));
  assert.ok(requests.some((r) => r.updateParagraphStyle && r.updateParagraphStyle.paragraphStyle.namedStyleType === 'HEADING_2'));
  assert.ok(requests.some((r) => r.createParagraphBullets));
  assert.equal(Object.keys(requests[requests.length - 1])[0], 'insertPageBreak');
  // the inserted text must reproduce every body paragraph (no truncation)
  for (const line of ['What to check', 'Questions to ask', 'Scope of work']) assert.ok(text.includes(line));
  const doc = { body: { content: [{ endIndex: 1 }, { endIndex: 50, paragraph: { elements: [{ textRun: { content: 'abc SEO-ARTICLE-MARKER: ART-1\n' } }] } }] } };
  assert.equal(L.documentEndIndex(doc), 50);
  assert.equal(L.countOccurrences(L.documentPlainText(doc), 'SEO-ARTICLE-MARKER: ART-1'), 1);
});
