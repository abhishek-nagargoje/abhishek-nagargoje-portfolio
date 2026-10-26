// @mode each
// @lib common,duplichecker
// Bounded polling of the documented callback endpoint. Terminates after
// plagiarism_max_polls attempts with TIMEOUT (never PASS).
const ctx = $('Wait Before Poll').item.json.ctx;
const c = ctx.config;
const p = ctx.plagiarism;
p.poll_count = (p.poll_count || 0) + 1;
const r = dcInterpret($json);
if (r.state === 'COMPLETED') {
  if (r.hash && r.hash !== p.provider_hash) {
    p.status = 'FAILED'; p.error = 'DupliChecker report hash ' + r.hash + ' does not match the submitted job ' + p.provider_hash;
    return { json: { ctx, route: 'DONE' } };
  }
  Object.assign(p, { status: 'COMPLETED', plag_percent: r.plag, unique_percent: r.unique, rephrased_percent: r.rephrased, exact_percent: r.exact,
    matches: r.matches, match_count: r.match_count, details_recognised: r.details_recognised, report_url: r.report_url, completed_at: new Date().toISOString() });
  return { json: { ctx, route: 'DONE' } };
}
const retryablePoll = r.state === 'PENDING' || r.rateLimited || r.transient;
if (retryablePoll && p.poll_count < c.plagiarism_max_polls) {
  p.last_poll_note = r.state === 'PENDING' ? 'processing' : r.error;
  return { json: { ctx, route: 'PENDING' } };
}
if (retryablePoll) {
  p.status = 'TIMEOUT';
  p.error = 'No completed DupliChecker report after ' + p.poll_count + ' polls (' + (p.poll_count * c.plagiarism_poll_interval_seconds) + 's). The job hash is kept so Error Recovery can collect the report later.';
} else {
  p.status = 'FAILED';
  p.error = r.error;
  p.permanent = !!r.permanent;
}
return { json: { ctx, route: 'DONE' } };
