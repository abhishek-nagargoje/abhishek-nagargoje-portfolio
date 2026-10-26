// @mode each
// @lib common
// RESUME_DOC: all checks already passed in an earlier run (or a timed-out
// plagiarism report was recovered). Rebuild the context from the stored
// approval payload; the database approval gate is re-checked next.
const ctx = $json.ctx;
const ap = ctx.job.approval_payload;
if (!ap || !ap.article || !ap.editorial || !ap.plagiarism) {
  throw new Error('STATE_ERROR: RESUME_DOC for ' + ctx.job.article_id + ' has no stored approval payload');
}
ctx.article = ap.article;
ctx.attempt = ap.attempts || ctx.job.attempts;
ctx.article_kind = 'RESUMED';
ctx.links = ap.links || { verified_internal: [{ url: ap.article.Target_Page_URL, label: 'Target page', source: 'target_page' }] };
ctx.editorial = Object.assign({ passed: true, individual_checks: [], disclaimer: 'Internal E-E-A-T-oriented editorial assessment; not a Google score.' }, ap.editorial);
const pl = ap.plagiarism;
ctx.plagiarism = Object.assign({ status: 'COMPLETED', passed: true, threshold_percent: ctx.config.plagiarism_threshold_percent }, pl, {
  result_label: pl.result_label || 'PASS', plag_percent: pl.plag_percent ?? pl.plagPercent,
  report_reference: pl.report_reference || '' });
ctx.history = [{ attempt: ctx.attempt, kind: 'RESUMED', decision: 'APPROVE', reasons: [] }];
return { json: { ctx } };
