// @mode each
// @lib common
// Pass / Revise / Human Review decision for the CURRENT attempt only.
assertLease($json, 'Pass / Revise / Human Review Decision');
const ctx = $json.ctx;
const c = ctx.config;
const e = ctx.editorial;
const p = ctx.plagiarism;
const reasons = [];
if (!e || e.attempt !== ctx.attempt) reasons.push('editorial evaluation missing for attempt ' + ctx.attempt);
else if (!e.passed) reasons.push('editorial: ' + (e.failed_conditions.slice(0, 8).join('; ') || e.overall_status) + (e.unsupported_claims.length ? '; ' + e.unsupported_claims.length + ' unsupported claim(s)' : ''));
if (!p || p.attempt !== ctx.attempt) reasons.push('plagiarism report missing for attempt ' + ctx.attempt);
else if (!p.passed) reasons.push('plagiarism: ' + p.reasons.join('; '));

let decision;
const plagUnavailable = p && p.status !== 'COMPLETED';
if (!reasons.length) decision = 'APPROVE';
else if (plagUnavailable) decision = 'REVIEW'; // the text is not the problem; revising cannot fix an unavailable report
else if (ctx.attempt < c.max_attempts) decision = 'REVISE';
else decision = 'REVIEW';

ctx.history = (ctx.history || []).concat([{
  attempt: ctx.attempt, kind: ctx.article_kind, editorial: e ? e.overall_status : 'MISSING',
  unsupported_claims: e ? e.unsupported_claims.length : null, plagiarism_status: p ? p.status : 'MISSING',
  plagiarism_percent: p ? (p.plag_percent ?? null) : null, decision, reasons: reasons.map((r) => truncate(r, 400)),
}]);
ctx.decision = { attempt: ctx.attempt, decision, reasons };
if (decision === 'REVIEW') {
  const why = plagUnavailable
    ? 'Plagiarism report not available (' + p.status + (p.error ? ': ' + p.error : '') + ')'
    : 'Article did not pass all checks after ' + ctx.attempt + ' of ' + c.max_attempts + ' attempts';
  // A permanent provider problem (token, plan) is a configuration ERROR;
  // everything else needs a human decision.
  setOutcome(ctx, plagUnavailable && p.permanent ? 'ERROR' : 'REVIEW_REQUIRED',
    plagUnavailable ? 'PLAGIARISM_CHECK' : 'QUALITY_GATE', why + '. ' + reasons.join(' | '), !!(p && p.transient));
  // A timed-out report for an editorially passed article can still be
  // collected later by Error Recovery; keep what is needed to publish it.
  if (p && p.status === 'TIMEOUT' && e && e.passed) {
    ctx.approval_candidate = { article: ctx.article, editorial: summarizeEditorial(e), keyword: ctx.keyword, attempts: ctx.attempt,
      links: ctx.links, timed_out_plagiarism: { provider_hash: p.provider_hash } };
  }
}
function summarizeEditorial(x) { return { overall_status: x.overall_status, individual_checks: x.individual_checks, failed_conditions: x.failed_conditions, unsupported_claims: x.unsupported_claims, disclaimer: x.disclaimer }; }
return { json: { ctx, route: decision } };
