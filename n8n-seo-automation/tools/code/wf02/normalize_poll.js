// @include common, plagiarism
const cfg = $('Keyword Context').first(0).json.config;
const reqs = $('Build Poll Requests').all(0).map((i) => i.json);
const previous = reqs[0].state;
const results = $input.all().map((it, i) => ({
  chunk: reqs[i],
  res: normalizePlagiarismResponse(Number(it.json.statusCode || 0), it.json.data !== undefined ? it.json.data : it.json.body, reqs[i].text, cfg),
}));
const state = buildScanState(previous, results, cfg);
return [{ json: { ...state, attempt_no: previous.attempt_no, content_sha256: previous.content_sha256 } }];
