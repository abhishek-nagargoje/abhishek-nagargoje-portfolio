// ---- DupliChecker response interpretation (fail closed) ----
// Documented contract (https://www.duplichecker.com/api-documentation):
//   POST /api/checkplag {token, data, rephrased} -> job info with hash + key
//   GET  /api/query-footprint/{hash}/{key}      -> repeat while "recall" is true;
//        the completed report has recall:false, plagPercent, uniquePercent,
//        rephrasedPercent, exactMatchedPercent and details[] (matched webs).
// Anything that does not match this contract is treated as FAILED, never PASS.
function dcInterpret(json) {
  const fail = httpFailure(json);
  if (fail) return { state: 'FAILED', transient: isTransientCode(fail.code, fail.message), error: 'DupliChecker request failed: ' + fail.message };
  const status = Number(json.statusCode || 0);
  let body = json.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* not JSON */ } }
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 401 || status === 403) return { state: 'FAILED', permanent: true, error: 'DupliChecker rejected the API token (HTTP ' + status + ')' };
  if (status === 402) return { state: 'FAILED', permanent: true, error: 'DupliChecker plan expired (HTTP 402)' };
  if (status === 429) return { state: 'FAILED', transient: true, rateLimited: true, error: 'DupliChecker rate limit reached (HTTP 429)' };
  if (status === 404) return { state: 'FAILED', error: 'DupliChecker job not found (HTTP 404); the hash may have expired' };
  if (status >= 500) return { state: 'FAILED', transient: true, error: 'DupliChecker server error (HTTP ' + status + ')' };
  if (status < 200 || status >= 300) return { state: 'FAILED', error: 'Unexpected DupliChecker HTTP status ' + status + ': ' + truncate(redact(text), 300) };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'FAILED', error: 'Unrecognised DupliChecker response (not a JSON object): ' + truncate(redact(text), 300) };
  const src = (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? Object.assign({}, body, body.data) : body;
  const num = (...vals) => { for (const v of vals) { if (v === undefined || v === null || v === '') continue; const n = Number(String(v).replace('%', '')); if (Number.isFinite(n)) return n; } return null; };
  const bool = (v) => v === true || v === 1 || /^(true|1|yes)$/i.test(String(v));
  const errText = asText(src.error || src.errors || ((src.status === false || src.success === false) ? (src.message || 'request rejected') : ''));
  if (errText && !src.hash) {
    const permanent = /token|unauthori|plan|expired|credit|word.?limit|limit exceeded|insufficient/i.test(errText);
    return { state: 'FAILED', permanent, error: 'DupliChecker error: ' + truncate(redact(typeof errText === 'string' ? errText : JSON.stringify(errText)), 400) };
  }
  const hash = asText(src.hash);
  const key = asText(src.key);
  const plag = num(src.plagPercent, src.plag_percent, src.plagiarismPercent);
  const unique = num(src.uniquePercent, src.unique_percent);
  const rephrased = num(src.rephrasedPercent, src.rephrased_percent, src.paraphrasedPercent);
  const exact = num(src.exactMatchedPercent, src.exactMatchPercent, src.exact_matched_percent);
  const recallDefined = src.recall !== undefined && src.recall !== null && src.recall !== '';
  if (recallDefined && bool(src.recall)) return { state: 'PENDING', hash, key };
  if (plag !== null) {
    if (plag < 0 || plag > 100 || (unique !== null && (unique < 0 || unique > 100))) {
      return { state: 'FAILED', error: 'DupliChecker returned out-of-range percentages (plag ' + plag + ', unique ' + unique + ')' };
    }
    const details = Array.isArray(src.details) ? src.details : [];
    const matches = details.filter((d) => d && typeof d === 'object' && !bool(d.unique)).map((d) => ({
      text: truncate(asText(d.query || d.text || d.sentence), 600),
      rephrased: d.rephrased !== undefined ? bool(d.rephrased) : null,
      sources: (Array.isArray(d.webs) ? d.webs : (Array.isArray(d.sources) ? d.sources : [])).slice(0, 5)
        .map((w) => ({ title: truncate(asText(w && (w.title || w.name)), 200), url: asText(w && (w.url || w.link)) })),
    })).filter((m) => m.text);
    return { state: 'COMPLETED', hash, key, plag, unique, rephrased, exact, matches: matches.slice(0, 40), match_count: matches.length,
      details_recognised: Array.isArray(src.details), report_url: asText(src.report_url || src.reportUrl || src.url || '') };
  }
  if (hash && key) return { state: 'PENDING', hash, key, initial: true };
  return { state: 'FAILED', error: 'Unrecognised DupliChecker response structure (no recall/hash/plagPercent): ' + truncate(redact(text), 300) };
}
// Internal acceptance policy (configurable). A low score alone does not prove
// originality: the editorial "Original Value" check must also pass.
function dcAccept(p, config) {
  const reasons = [];
  if (!p || p.status !== 'COMPLETED') reasons.push('no completed plagiarism report (' + (p ? p.status : 'missing') + (p && p.error ? ': ' + p.error : '') + ')');
  else {
    if (p.plag_percent > config.plagiarism_threshold_percent) reasons.push('reported plagiarism ' + p.plag_percent + '% exceeds the ' + config.plagiarism_threshold_percent + '% policy');
    if (p.exact_percent !== null && p.exact_percent !== undefined && p.exact_percent > config.plagiarism_threshold_percent) reasons.push('exact-match share ' + p.exact_percent + '% exceeds ' + config.plagiarism_threshold_percent + '%');
    if (p.rephrased_percent !== null && p.rephrased_percent !== undefined && p.rephrased_percent > config.plagiarism_max_rephrased_percent) reasons.push('rephrased-match share ' + p.rephrased_percent + '% exceeds ' + config.plagiarism_max_rephrased_percent + '%');
    const unattributed = (p.matches || []).filter((m) => !m.attributed && m.text.split(/\s+/).length >= 25);
    if (unattributed.length) reasons.push(unattributed.length + ' matched passage(s) of 25+ words without attribution');
  }
  return { passed: reasons.length === 0, reasons };
}
