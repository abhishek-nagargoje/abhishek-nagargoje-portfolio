// @mode each
// @lib common
const ctx = $('Build Query Embedding Request').item.json.ctx;
delete ctx.embedding_request;
const fail = httpFailure($json);
const values = $json && $json.embedding && Array.isArray($json.embedding.values) ? $json.embedding.values : null;
let ok = false;
if (fail) {
  setOutcome(ctx, 'ERROR', 'QUERY_EMBEDDING', 'Gemini embedContent failed: ' + fail.message, isTransientCode(fail.code, fail.message));
} else if (!values || values.length !== ctx.models.embedding_dimensions) {
  setOutcome(ctx, 'ERROR', 'QUERY_EMBEDDING', 'Gemini returned ' + (values ? values.length : 'no') + ' embedding values; expected ' + ctx.models.embedding_dimensions, false);
} else if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
  setOutcome(ctx, 'ERROR', 'QUERY_EMBEDDING', 'Gemini embedding contains non-numeric values', false);
} else {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  if (!(norm > 0)) setOutcome(ctx, 'ERROR', 'QUERY_EMBEDDING', 'Gemini embedding is a zero vector', false);
  else { ctx.query_vector = '[' + values.map((v) => (v / norm).toFixed(7)).join(',') + ']'; ok = true; }
}
return { json: { ctx, ok } };
