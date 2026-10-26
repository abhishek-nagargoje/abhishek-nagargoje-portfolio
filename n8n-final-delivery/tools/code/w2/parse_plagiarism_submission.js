// @mode each
// @lib common,duplichecker
// The submission response is never treated as a final report unless it
// already is a complete report (recall:false with percentages).
const ctx = $('Prepare Plagiarism Submission').item.json.ctx;
delete ctx.plag_request;
const r = dcInterpret($json);
const p = ctx.plagiarism;
p.submitted_at = new Date().toISOString();
if (r.state === 'PENDING' && r.hash && r.key) {
  p.status = 'SUBMITTED'; p.provider_hash = r.hash; p.provider_key = r.key;
  return { json: { ctx, route: 'SUBMITTED' } };
}
if (r.state === 'COMPLETED' && r.hash) {
  // Report returned synchronously. Still recorded against the hash.
  Object.assign(p, { status: 'COMPLETED', provider_hash: r.hash, provider_key: r.key || null, plag_percent: r.plag, unique_percent: r.unique,
    rephrased_percent: r.rephrased, exact_percent: r.exact, matches: r.matches, match_count: r.match_count, report_url: r.report_url, synchronous: true });
  return { json: { ctx, route: 'SUBMITTED' } };
}
p.status = 'FAILED';
p.error = r.state === 'PENDING' ? 'DupliChecker accepted the request but returned no hash/key to retrieve the report' : r.error;
p.permanent = !!r.permanent;
p.transient = !!r.transient;
return { json: { ctx, route: 'NOT_SUBMITTED' } };
