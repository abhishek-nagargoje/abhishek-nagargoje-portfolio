// @mode each
// @lib common
const src = $('Build Embedding Request').item.json;
const ctx = src.ctx;
const r = src.record;
const dims = ctx.embedding.dimensions;
const fail = httpFailure($json);
const values = $json && $json.embedding && Array.isArray($json.embedding.values) ? $json.embedding.values : null;
let error = '';
if (fail) error = 'Gemini embedContent failed: ' + fail.message;
else if (!values) error = 'Gemini response has no embedding.values';
else if (values.length !== dims) error = 'Gemini returned ' + values.length + ' dimensions; expected ' + dims;
else if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) error = 'embedding contains non-numeric values';
let vector = '';
if (!error) {
  // Smaller-than-default dimensions are not unit length; normalise so that
  // cosine similarity behaves consistently.
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  if (!(norm > 0)) error = 'embedding is a zero vector';
  else vector = '[' + values.map((v) => (v / norm).toFixed(7)).join(',') + ']';
}
if (error) return { json: { ctx, record: r, ok: false, outcome: { knowledge_id: r.knowledge_id, row_number: r.row_number, status: 'FAILED', error } } };
return { json: { ctx, record: r, ok: true, action: src.action, expected_hash: src.expected_hash, vector } };
