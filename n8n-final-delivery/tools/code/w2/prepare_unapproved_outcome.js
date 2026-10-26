// @mode each
// @lib common
// Shared terminal path for every non-approved outcome after the claim.
// Releases the database lease (so a manual test run never leaves a keyword
// locked) and keeps the article out of the master Google Doc.
const ctx = $json.ctx;
if (!ctx.outcome) setOutcome(ctx, 'ERROR', 'UNKNOWN', 'Workflow reached the unapproved path without an outcome', false);
const o = ctx.outcome;
ctx.final = {
  status: o.status === 'ERROR' ? 'ERROR' : 'REVIEW_REQUIRED',
  stage: o.stage, reason: o.reason, retryable: !!o.retryable,
  quality_status: ctx.editorial ? ctx.editorial.overall_status : 'NOT_EVALUATED',
};
ctx.finalize_payload = {
  final_status: ctx.final.status, last_error: '[' + o.stage + '] ' + o.reason, failure_stage: o.stage, retryable: ctx.final.retryable,
  quality_status: ctx.final.quality_status, approval_candidate: ctx.approval_candidate || null,
};
return { json: { ctx } };
