// @mode each
// @lib common
// Every attempt's exact check text is submitted afresh; results are never reused.
assertLease($json, 'Prepare Plagiarism Submission');
const ctx = $json.ctx;
const c = ctx.config;
ctx.progress_status = 'PLAGIARISM_CHECK';
ctx.plagiarism = { attempt: ctx.attempt, status: 'NOT_SUBMITTED', word_count: ctx.check_word_count, poll_count: 0, provider_hash: null, provider_key: null };
if (ctx.check_word_count > c.plagiarism_max_words) {
  ctx.plagiarism.status = 'FAILED';
  ctx.plagiarism.error = 'Text has ' + ctx.check_word_count + ' words, above plagiarism_max_words (' + c.plagiarism_max_words + '); not submitted';
  return { json: { ctx, submit: false } };
}
ctx.plag_request = { data: ctx.check_text, rephrased: c.plagiarism_check_rephrased ? 'true' : 'false' };
return { json: { ctx, submit: true } };
