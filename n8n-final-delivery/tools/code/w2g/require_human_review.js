// @mode each
// @lib common
// Approval rule: no external plagiarism check was performed, so an article that
// passed every automated check is written to the "pending human review"
// document and finalised as REVIEW_REQUIRED - never APPROVED automatically.
assertLease($json, 'Require Human Review');
const ctx = $json.ctx;
const reason = 'Passed the E-E-A-T editorial check and the Gemini AI originality review (AI review only - no external plagiarism check, no plagiarism percentage). ' +
  'Human review required before publication. Article is in "' + (ctx.doc.title || ctx.config.master_doc_title) + '": ' + (ctx.doc.url || '');
ctx.final = { status: 'REVIEW_REQUIRED', stage: 'HUMAN_REVIEW', reason, retryable: false, quality_status: 'PASS', doc_written: true };
ctx.finalize_payload = { final_status: 'REVIEW_REQUIRED', last_error: reason, failure_stage: 'HUMAN_REVIEW', retryable: false, quality_status: 'PASS' };
return { json: { ctx } };
