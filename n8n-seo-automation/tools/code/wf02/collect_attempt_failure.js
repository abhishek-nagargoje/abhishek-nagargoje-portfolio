// Gathers the exact failures of the CURRENT attempt (reports of earlier
// attempts are never reused) and decides whether another revision is allowed.
const cfg = $('Keyword Context').first(0).json.config;
const att = $('Prepare Attempt').first(0).json;
const current = (name) => {
  const n = $(name);
  return n.isExecuted && n.first(0).json.attempt_no === att.attempt_no ? n.first(0).json : null;
};
const ed = current('Check Editorial Conditions');
const pl = current('Evaluate Plagiarism Result');
const plagiarismFailed = !!(pl && pl.plagiarism_status === 'FAIL');
const failed = [...(ed ? ed.failed_conditions : []), ...(plagiarismFailed ? pl.failed_conditions : [])];
const canRetry = att.local_attempt < cfg.MAX_ARTICLE_ATTEMPTS;
return [{ json: {
  attempt_no: att.attempt_no,
  local_attempt: att.local_attempt,
  failure_source: plagiarismFailed ? 'PLAGIARISM' : 'EDITORIAL',
  failed_conditions: failed,
  editorial_report: ed ? ed.report : null,
  editorial_status: ed ? ed.editorial_status : null,
  deterministic_checks: ed ? ed.deterministic_checks : null,
  source_checks: ed ? ed.source_checks : null,
  plagiarism_report: pl ? pl.report : null,
  can_retry: canRetry,
  review_reason: canRetry ? '' : `MAX_ARTICLE_ATTEMPTS (${cfg.MAX_ARTICLE_ATTEMPTS}) reached; last failure: ${failed.slice(0, 5).join(' || ')}`.slice(0, 3000),
  review_failed_conditions: failed,
} }];
