// @mode each
// @lib common
// AI originality acceptance. Copied-looking / too-similar passages and
// unsupported or unattributed claims block; pure repetition notes do not.
// Even a PASS is AI_REVIEW_PASS (never a verified plagiarism result).
const ctx = $json.ctx;
const o = ctx.originality_raw;
delete ctx.originality_raw;
const BLOCKING = ['copied_looking', 'similar_to_target_page', 'similar_to_source_material', 'unsupported_claim', 'missing_attribution', 'low_original_value'];
const blocking = o.flagged_phrases.filter((f) => BLOCKING.includes(f.category));
const reasons = [];
if (o.status !== 'PASS') reasons.push('Gemini originality review status ' + o.status + (o.review_notes ? ': ' + truncate(o.review_notes, 300) : ''));
if (blocking.length) reasons.push(blocking.length + ' flagged passage(s) need rewriting (' + [...new Set(blocking.map((b) => b.category))].join(', ') + ')');
const passed = reasons.length === 0;
const label = passed ? 'AI_REVIEW_PASS' : (o.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'AI_REVIEW_FAIL');
Object.assign(ctx.plagiarism, {
  status: 'COMPLETED', passed, reasons, result_label: label, plag_percent: null, unique_percent: null, rephrased_percent: null, exact_percent: null,
  threshold_percent: null, report_reference: '', review_status: o.status,
  // Passages for the reviser (same shape the revision step already uses).
  matches: blocking.map((b) => ({ text: b.text, sources: b.compared_with ? [{ title: b.compared_with, url: '' }] : [], attributed: false })),
  originality: o,
  note: 'Gemini originality review against the target page and retrieved brand records only. Not an external plagiarism check; no plagiarism percentage.',
});
return { json: { ctx } };
