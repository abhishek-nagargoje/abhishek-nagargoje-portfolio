// @mode each
// @lib common
assertLease($json, 'Prepare Plagiarism Polling');
const ctx = $json.ctx;
// A synchronous complete report skips polling.
return { json: { ctx, poll: ctx.plagiarism.status === 'SUBMITTED' } };
