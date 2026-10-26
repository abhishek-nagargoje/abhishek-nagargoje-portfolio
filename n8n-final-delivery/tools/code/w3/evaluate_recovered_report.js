// @mode each
// @lib common,duplichecker
// Follows the provider's callback mechanism for a timed-out report. Only a
// COMPLETED report can pass; anything else stays REVIEW_REQUIRED.
const src = $('Normalize Recovery Item').item.json;
const rc = src.runtime_config;
const pl = src.plagiarism;
const r = dcInterpret($json);
const result = { status: r.state === 'COMPLETED' ? 'COMPLETED' : (r.state === 'PENDING' || r.transient ? 'PENDING' : 'FAILED') };
if (r.state === 'COMPLETED') {
  if (r.hash && r.hash !== pl.provider_hash) { result.status = 'FAILED'; result.error = 'report hash does not match the stored job'; }
  else {
    const p = { status: 'COMPLETED', plag_percent: r.plag, unique_percent: r.unique, rephrased_percent: r.rephrased, exact_percent: r.exact, matches: r.matches };
    p.matches.forEach((m) => { m.attributed = false; });
    const verdict = dcAccept(p, { plagiarism_threshold_percent: Number(pl.threshold_percent ?? rc.plagiarism_threshold_percent ?? 10),
      plagiarism_max_rephrased_percent: Number(rc.plagiarism_max_rephrased_percent ?? 20) });
    Object.assign(result, p, { passed: verdict.passed, reasons: verdict.reasons, threshold_percent: Number(pl.threshold_percent ?? rc.plagiarism_threshold_percent ?? 10),
      result_label: verdict.passed ? 'PASS' : 'FAIL', provider_hash: pl.provider_hash, recovered: true,
      report_reference: r.report_url || (rc.duplichecker_api_base || '').replace(/\/+$/, '') + '/query-footprint/' + pl.provider_hash + '/' + pl.provider_key });
    result.result = { match_count: r.match_count, matches: r.matches.slice(0, 20) };
  }
} else {
  result.error = r.error || 'report still processing';
  result.passed = false;
}
return { json: Object.assign({}, src, { recovered_result: result }) };
