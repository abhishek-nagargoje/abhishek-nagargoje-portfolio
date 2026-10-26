// @include common, article
// Combines external-source reachability with the deterministic content checks.
// Reachability does not prove a source supports a claim (the evaluator judges
// that); an unreachable/non-existent URL is treated as a likely fabrication.
const ctx = $('Keyword Context').first(0).json;
const cfg = ctx.config;
const att = $('Prepare Attempt').first(0).json;
const rag = $('Validate Brand Context').first(0).json;
const inputs = $input.all().map((i) => i.json);
const sourceChecks = [];
if (!(inputs.length === 1 && inputs[0].check === false)) {
  const reqs = $('Prepare Source Checks').all(0).map((i) => i.json);
  inputs.forEach((r, i) => {
    const req = reqs[i] || {};
    const code = Number(r.statusCode || 0);
    let verdict;
    if (r.error || code === 0) verdict = 'UNREACHABLE';
    else if (code === 404 || code === 410) verdict = 'NOT_FOUND';
    else if (code === 401 || code === 403 || code === 429 || code === 999) verdict = 'BLOCKED_UNVERIFIED';
    else if (code >= 500) verdict = 'SERVER_ERROR_UNVERIFIED';
    else verdict = 'REACHABLE';
    sourceChecks.push({ url: req.url, title: req.title, http_status: code || null, verdict, error: r.error ? truncate(scrubSecrets(String(r.error.message || r.error)), 200) : undefined });
  });
}
const findings = [];
for (const s of sourceChecks) {
  if (s.verdict === 'NOT_FOUND' || s.verdict === 'UNREACHABLE') {
    findings.push({ code: 'FABRICATED_OR_BROKEN_SOURCE', severity: 'CRITICAL', detail: `${s.url} returned ${s.verdict}${s.http_status ? ' (HTTP ' + s.http_status + ')' : ''}` });
  }
}
if (cfg.DETERMINISTIC_CLAIM_CHECKS !== 'off') {
  const claimFindings = deterministicClaimChecks(att.article, rag.brand_knowledge.map((c) => ({ content: c.Content })), ctx.config.BRAND_NAMES);
  for (const f of claimFindings) findings.push({ ...f, severity: cfg.DETERMINISTIC_CLAIM_CHECKS === 'enforce' ? f.severity : 'ADVISORY' });
}
for (const e of att.structure_errors) findings.push({ code: e.split(':')[0], severity: 'CRITICAL', detail: e });
const blocking = findings.filter((f) => f.severity === 'CRITICAL');
return [{ json: {
  attempt_no: att.attempt_no,
  source_checks: sourceChecks,
  deterministic_checks: { passed: blocking.length === 0, findings, warnings: att.structure_warnings },
} }];
