// @include common
// Common entry to REVIEW_REQUIRED: page not usable, insufficient brand
// context, keyword/page mismatch, attempt limit reached, unclear doc write.
const ctx = $('Keyword Context').first(0).json;
const inp = $input.first().json;
const att = $('Prepare Attempt').isExecuted ? $('Prepare Attempt').first(0).json : null;
const ed = $('Check Editorial Conditions').isExecuted ? $('Check Editorial Conditions').first(0).json : null;
const pl = $('Evaluate Plagiarism Result').isExecuted ? $('Evaluate Plagiarism Result').first(0).json : null;
const reason = asText(inp.review_reason) || 'REVIEW_REQUIRED';
const summary = ed ? {
  attempt_no: ed.attempt_no,
  editorial_status: ed.editorial_status,
  checks: Object.fromEntries(Object.entries(ed.report || {}).filter(([, v]) => v && v.Status).map(([k, v]) => [k, v.Status])),
  failed_conditions: ed.failed_conditions.slice(0, 15),
} : null;
return [{ json: {
  review_reason: reason.slice(0, 3000),
  failed_conditions: Array.isArray(inp.review_failed_conditions) ? inp.review_failed_conditions : [reason],
  article: att ? att.article : null,
  attempts: att ? att.local_attempt : 0,
  quality_status: ed ? ed.editorial_status : '',
  eeta_summary: summary ? truncate(JSON.stringify(summary), 45000) : '',
  plagiarism_percent: pl ? pl.plagiarism_percent : '',
  plagiarism_status: pl ? pl.plagiarism_status : '',
  plagiarism_report_ref: pl ? pl.plagiarism_report_ref : '',
  occurred_at: DateTime.now().setZone(ctx.config.TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss'),
} }];
