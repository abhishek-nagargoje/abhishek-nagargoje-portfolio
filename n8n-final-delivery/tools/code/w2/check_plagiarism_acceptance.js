// @mode each
// @lib common,duplichecker
// Applies the internal plagiarism policy. A failed, unavailable or
// unrecognised report is never treated as PASS.
const ctx = $json.ctx;
const p = ctx.plagiarism;
// Matches that sit inside quotation marks in the article are treated as attributed quotes.
const quoted = (ctx.check_text.match(/[“"]([^”"]{20,})[”"]/g) || []).map((q) => q.toLowerCase());
(p.matches || []).forEach((m) => { m.attributed = quoted.some((q) => q.includes(m.text.toLowerCase().slice(0, 60))); });
const verdict = dcAccept(p, ctx.config);
p.passed = verdict.passed;
p.reasons = verdict.reasons;
p.threshold_percent = ctx.config.plagiarism_threshold_percent;
p.result_label = p.status === 'COMPLETED' ? (p.passed ? 'PASS' : 'FAIL') : p.status;
p.report_reference = p.report_url || (p.provider_hash && p.provider_key ? ctx.config.duplichecker_api_base.replace(/\/+$/, '') + '/query-footprint/' + p.provider_hash + '/' + p.provider_key : '');
p.note = 'Internal policy: reported plagiarism <= ' + p.threshold_percent + '% plus matched-passage review. A low similarity score alone does not prove originality.';
return { json: { ctx } };
