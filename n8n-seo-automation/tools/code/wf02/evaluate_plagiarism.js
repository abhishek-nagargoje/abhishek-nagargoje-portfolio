// @include common, plagiarism
// Applies the configured policy to a COMPLETE report for THIS attempt only.
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const state = $input.first().json;
const att = $('Prepare Attempt').first(0).json;
if (state.attempt_no !== att.attempt_no) throw new Error('INTERNAL: plagiarism report belongs to a different attempt');
const decision = decidePlagiarism(state.completed, ctx.config);
const reportRef = decision.report_urls[0] || `postgres:seo.article_attempts/${claim.article_id}/${att.attempt_no}`;
return [{ json: {
  attempt_no: att.attempt_no,
  content_sha256: state.content_sha256,
  plagiarism_status: decision.status,
  plagiarism_percent: decision.percent,
  plagiarism_report_ref: reportRef,
  failed_conditions: decision.failed_conditions,
  report: { provider: ctx.config.PLAGIARISM_PROVIDER, ...decision, polls: state.poll_round },
} }];
