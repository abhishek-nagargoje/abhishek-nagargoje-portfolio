// Unit tests for the helper libraries that are inlined into the Code nodes
// (tools/code/lib/*.js). Pure functions, no network.
// Usage: LUXON_MODULE=<path to luxon> node tests/code_unit_tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DateTime } = require(process.env.LUXON_MODULE || 'luxon');

const lib = ['common', 'article', 'duplichecker', 'docs', 'gdocs'].map((n) => fs.readFileSync(path.join(__dirname, '..', 'tools', 'code', 'lib', n + '.js'), 'utf8')).join('\n');
const sandbox = { DateTime, console };
vm.createContext(sandbox);
vm.runInContext(lib + '\nthis.api = { dcInterpret, dcAccept, readGemini, extractJson, parseInline, markdownToBlocks, buildCheckText, buildDocSection, normalizeUrl, resolveUrl, parseUrl, hostAllowed, redact, slugify, countWords, docText };', sandbox);
const A = sandbox.api;
let pass = 0; const fail = [];
const t = (name, cond, info) => { if (cond) { pass++; console.log('  PASS', name); } else { fail.push(name); console.log('  FAIL', name, info === undefined ? '' : JSON.stringify(info)); } };

console.log('DupliChecker interpretation (fail closed)');
const R = (statusCode, body) => A.dcInterpret({ statusCode, body });
t('recall true -> PENDING', R(200, { recall: true, hash: 'h', key: 'k' }).state === 'PENDING');
t('recall "true" string -> PENDING', R(200, { recall: 'true' }).state === 'PENDING');
t('submission with hash/key only -> PENDING (never a final result)', R(200, { hash: 'h', key: 'k' }).state === 'PENDING');
const done = R(200, JSON.stringify({ recall: false, hash: 'h', plagPercent: '7%', uniquePercent: 93, rephrasedPercent: 2, exactMatchedPercent: 5, details: [{ query: 'a copied sentence', unique: 'false', webs: [{ title: 'x', url: 'https://x.y' }] }, { query: 'ok', unique: true }] }));
t('completed report parsed (string body, "7%")', done.state === 'COMPLETED' && done.plag === 7 && done.unique === 93 && done.matches.length === 1 && done.matches[0].sources[0].url === 'https://x.y', done);
t('data wrapper supported', R(200, { status: true, data: { recall: false, plagPercent: 3, uniquePercent: 97 } }).state === 'COMPLETED');
t('unknown structure -> FAILED', R(200, { foo: 1 }).state === 'FAILED');
t('non-JSON body -> FAILED', R(200, '<html>oops</html>').state === 'FAILED');
t('out-of-range percentage -> FAILED', R(200, { recall: false, plagPercent: 140 }).state === 'FAILED');
t('401 -> FAILED permanent', R(401, { error: 'Invalid token' }).permanent === true);
t('402 -> FAILED permanent (plan expired)', R(402, {}).permanent === true);
t('429 -> FAILED transient rate limit', R(429, {}).rateLimited === true);
t('error message in 200 -> FAILED', R(200, { status: false, message: 'Word limit exceeded' }).state === 'FAILED');
t('network error item -> FAILED transient', A.dcInterpret({ error: { message: 'ETIMEDOUT' } }).transient === true);
const cfg = { plagiarism_threshold_percent: 10, plagiarism_max_rephrased_percent: 20 };
t('acceptance: 10% passes, 10.5% fails', A.dcAccept({ status: 'COMPLETED', plag_percent: 10, matches: [] }, cfg).passed && !A.dcAccept({ status: 'COMPLETED', plag_percent: 10.5, matches: [] }, cfg).passed);
t('acceptance: TIMEOUT never passes', !A.dcAccept({ status: 'TIMEOUT' }, cfg).passed);
t('acceptance: long unattributed match fails even under threshold', !A.dcAccept({ status: 'COMPLETED', plag_percent: 4, matches: [{ text: 'w '.repeat(30), attributed: false }] }, cfg).passed);
t('acceptance: rephrased share above limit fails', !A.dcAccept({ status: 'COMPLETED', plag_percent: 2, rephrased_percent: 35, matches: [] }, cfg).passed);

console.log('Gemini response handling');
const g = (o) => A.readGemini(o);
t('normal response', g({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }] }).ok);
t('thought parts ignored', g({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"a":1}' }] }, finishReason: 'STOP' }] }).text === '{"a":1}');
t('MAX_TOKENS -> TRUNCATED', g({ candidates: [{ content: { parts: [{ text: '{"a"' }] }, finishReason: 'MAX_TOKENS' }] }).kind === 'TRUNCATED');
t('SAFETY -> BLOCKED', g({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }).kind === 'BLOCKED');
t('blocked prompt', g({ promptFeedback: { blockReason: 'OTHER' } }).kind === 'BLOCKED');
t('invalid key -> PERMANENT', g({ error: { message: 'API key not valid. Please pass a valid API key.', httpCode: '400' } }).kind === 'PERMANENT');
t('503 -> TRANSIENT', g({ error: { message: 'The model is overloaded', httpCode: '503' } }).kind === 'TRANSIENT');
t('JSON inside code fence extracted', A.extractJson('```json\n{"x": 2}\n```').value.x === 2);
t('invalid JSON reported', A.extractJson('{"x": ').ok === false);

console.log('URL handling');
t('relative link resolved', A.resolveUrl('../services/payroll', 'https://www.hrremedyindia.com/a/b/') === 'https://www.hrremedyindia.com/a/services/payroll');
t('root-relative link resolved', A.resolveUrl('/contact', 'https://www.hrremedyindia.com/x') === 'https://www.hrremedyindia.com/contact');
t('mailto ignored', A.resolveUrl('mailto:a@b.c', 'https://x.y/') === '');
t('subdomain allowed, lookalike rejected', A.hostAllowed('www.hrremedyindia.com', ['hrremedyindia.com']) && !A.hostAllowed('hrremedyindia.com.evil.io', ['hrremedyindia.com']));
t('normalizeUrl lowercases host and strips trailing slash', A.normalizeUrl('https://WWW.HRRemedyIndia.com/Payroll/') === 'https://www.hrremedyindia.com/Payroll');
t('redaction of key= and Bearer', !/SECRET/.test(A.redact('GET https://x/models?key=SECRETKEY123 Authorization: Bearer SECRETTOKEN')));

console.log('Markdown and Google Docs section');
const inl = A.parseInline('See **bold [link](https://a.b/c)** and *it*.');
t('inline parse: text, bold, link, italic', inl.text === 'See bold link and it.' && inl.spans.some((s) => s.type === 'link' && inl.text.slice(s.start, s.end) === 'link') && inl.spans.some((s) => s.type === 'italic' && inl.text.slice(s.start, s.end) === 'it'), inl);
const blocks = A.markdownToBlocks('Intro\n\n## H2\n### H3\n- a\n- b\n1. one\n2. two\n\n| x | y |\n|---|---|\n| 1 | 2 |');
t('blocks: headings, lists, table rows', blocks.map((b) => b.type).join(',') === 'paragraph,heading,heading,bullet,numbered,paragraph,paragraph', blocks);
const ctx = {
  config: { max_attempts: 3, timezone: 'Asia/Kolkata' },
  job: { marker: '[[HRR-ARTICLE:HRR-ABC]]' },
  links: { verified_internal: [{ url: 'https://www.hrremedyindia.com/payroll' }] },
  attempt: 2,
  editorial: { overall_status: 'PASS', individual_checks: new Array(11).fill({}), disclaimer: 'Internal assessment.' },
  plagiarism: { result_label: 'PASS', plag_percent: 3, unique_percent: 97, rephrased_percent: 1, threshold_percent: 10 },
  article: { Article_ID: 'HRR-ABC', Keyword_ID: 'KW-1', Target_Page_URL: 'https://www.hrremedyindia.com/payroll', Primary_Keyword: 'payroll', Supporting_Keywords: [],
    Article_Title: 'Payroll 😀 Guide', SEO_Title: 's', H1: 'h', Meta_Description: 'm', URL_Slug: 'u', Word_Count: 10,
    Article_Markdown: 'Intro with [payroll](https://www.hrremedyindia.com/payroll/) and [fake](https://www.hrremedyindia.com/invented).\n\n## Section\n- item **one**',
    FAQs: [{ question: 'Q?', answer: 'A.' }], Internal_Link_Suggestions: [], External_Sources: [{ title: 'Gov', url: 'https://labour.gov.in/' }], Verified_Brand_Facts_Used: [] },
};
ctx.article.Article_Markdown += '\n\nBad\u0007control\u0000chars and a [tab\tlink](https://www.hrremedyindia.com/payroll).';
const sec = A.buildDocSection(ctx);
const at = (r) => sec.text.slice(r.start, r.end);
t('section starts with newline and contains the marker', sec.text[0] === '\n' && sec.text.includes(ctx.job.marker));
t('paragraph ranges match their text (UTF-16 safe, emoji title)', at(sec.paragraphStyles[0]) === 'Payroll 😀 Guide' && sec.paragraphStyles[0].named === 'HEADING_1', at(sec.paragraphStyles[0]));
t('H2 range correct', sec.paragraphStyles.some((p) => p.named === 'HEADING_2' && at(p) === 'Section'));
t('verified link hyperlinked; invented internal link left as text', sec.textStyles.some((s) => s.type === 'link' && at(s) === 'payroll') && !sec.textStyles.some((s) => s.type === 'link' && at(s) === 'fake'));
t('bullet range covers the list item', sec.bullets.length >= 1 && at(sec.bullets[0]) === 'item one', sec.bullets.map(at));
t('bold inside bullet', sec.textStyles.some((s) => s.type === 'bold' && at(s) === 'one'));
t('control characters removed without shifting link ranges', !/[\u0000-\u0008\u000B-\u001F]/.test(sec.text.slice(1)) && sec.textStyles.some((s) => s.type === 'link' && at(s) === 'tab\tlink') && !sec.text.includes('\u0007'), sec.textStyles.filter((s) => s.type === 'link').map(at));
t('no range runs past the text', [...sec.paragraphStyles, ...sec.textStyles, ...sec.bullets].every((r) => r.start >= 1 && r.end <= sec.text.length && r.end > r.start));
const ct = A.buildCheckText(ctx.article);
t('plagiarism check text is plain (no markdown) and includes FAQs', !/\*\*|\]\(|##/.test(ct) && ct.includes('Q?'));
t('slugify', A.slugify('HR Payroll & Compliance: 2026 Guide!') === 'hr-payroll-and-compliance-2026-guide');
t('word count (Unicode)', A.countWords('Payroll, compliance — and EPF/ESIC in India.') === 7);
t('docText reads paragraphs and tables', A.docText({ body: { content: [{ paragraph: { elements: [{ textRun: { content: 'a' } }] } }, { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'b' } }] } }] }] }] } }] } }) === 'ab');

console.log('\n' + pass + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
