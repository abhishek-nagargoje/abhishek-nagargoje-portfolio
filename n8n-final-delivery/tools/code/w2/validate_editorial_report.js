// @mode each
// @lib common
const ctx = $('Editorial Request').item.json.ctx;
const g = readGemini($json);
const problems = [];
let r = null;
if (g.ok) {
  const j = extractJson(g.text);
  if (!j.ok) problems.push(j.error); else r = j.value;
} else if (['PERMANENT', 'TRANSIENT', 'API_ERROR'].includes(g.kind)) {
  setOutcome(ctx, 'ERROR', 'EDITORIAL_EVALUATION', g.error, g.kind === 'TRANSIENT');
  return { json: { ctx, route: 'FAIL' } };
} else problems.push(g.error);
const norm = (s) => asText(s).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
if (r && typeof r === 'object') {
  if (!['PASS', 'FAIL', 'REVIEW_REQUIRED'].includes(asText(r.Overall_Status).toUpperCase())) problems.push('Overall_Status must be PASS, FAIL or REVIEW_REQUIRED');
  if (!Array.isArray(r.Individual_Checks)) problems.push('Individual_Checks must be an array');
  else {
    const got = new Map(r.Individual_Checks.map((x) => [norm(x && x.check), x]));
    const missing = ctx.editorial_checks.filter((name) => !got.has(norm(name)));
    if (missing.length) problems.push('Individual_Checks is missing: ' + missing.join(', '));
    const bad = r.Individual_Checks.filter((x) => !['PASS', 'FAIL'].includes(asText(x && x.status).toUpperCase()));
    if (bad.length) problems.push('every Individual_Checks entry needs status PASS or FAIL');
  }
  ['Failed_Conditions', 'Unsupported_Claims', 'Required_Corrections'].forEach((f) => { if (!Array.isArray(r[f])) problems.push('"' + f + '" must be an array'); });
} else if (!problems.length) problems.push('model output is not a JSON object');
if (problems.length) {
  if (ctx.gemini.retries < 1) {
    ctx.gemini.request = correctiveRequest(ctx.gemini.request, g.text, problems);
    ctx.gemini.retries += 1;
    return { json: { ctx, route: 'RETRY' } };
  }
  setOutcome(ctx, 'REVIEW_REQUIRED', 'EDITORIAL_EVALUATION', 'Editorial evaluator output was invalid after one corrective retry: ' + problems.join('; '), false);
  return { json: { ctx, route: 'FAIL' } };
}
r.Overall_Status = asText(r.Overall_Status).toUpperCase();
r.Individual_Checks = r.Individual_Checks.map((x) => ({ check: asText(x.check), status: asText(x.status).toUpperCase(), mandatory: true,
  severity: asText(x.severity || 'none').toLowerCase(), notes: truncate(x.notes, 800) }));
r.Reviewer_Comments = truncate(r.Reviewer_Comments, 2000);
ctx.editorial_raw = r;
ctx.editorial_meta = { corrective_retries: ctx.gemini.retries, usage: g.usage };
ctx.gemini = null;
return { json: { ctx, route: 'VALID' } };
