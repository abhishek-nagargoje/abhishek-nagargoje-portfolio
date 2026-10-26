// @include common, plagiarism
// Pairs each HTTP response with the chunk it was sent for (same order) and
// builds the scan state: COMPLETE | PENDING | ERROR.
const cfg = $('Keyword Context').first(0).json.config;
const reqs = $('Prepare Plagiarism Submission').all(0).map((i) => i.json);
const results = $input.all().map((it, i) => ({
  chunk: reqs[i],
  // fullResponse + text format puts the body in "data"
  res: normalizePlagiarismResponse(Number(it.json.statusCode || 0), it.json.data !== undefined ? it.json.data : it.json.body, reqs[i].text, cfg),
}));
const state = buildScanState(null, results, cfg);
return [{ json: { ...state, attempt_no: reqs[0].attempt_no, content_sha256: reqs[0].content_sha256 } }];
