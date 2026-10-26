// @include common
// Pairs each embedding response with its chunk (same order; failed requests
// come through as {error} items because the HTTP node continues on error).
const { config } = $('Ingestion Configuration').first(0).json;
const reqs = $('Needs Embedding?').all(0).map((i) => i.json);
return $input.all().map((it, i) => {
  const chunk = reqs[i];
  const r = it.json;
  let problem = '';
  const values = r && r.embedding && r.embedding.values;
  if (r.error) problem = classifyNodeError(r, 'EMBEDDING').message;
  else if (!Array.isArray(values)) problem = 'EMBEDDING_INVALID: response has no embedding.values';
  else if (values.length !== config.EMBEDDING_DIMENSIONS) problem = `EMBEDDING_DIMENSION_MISMATCH: got ${values.length}, expected ${config.EMBEDDING_DIMENSIONS}`;
  else if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) problem = 'EMBEDDING_INVALID: non-numeric values';
  return { json: {
    ...chunk,
    embedding_ok: !problem,
    vector: problem ? null : '[' + values.join(',') + ']',
    error_class: problem ? (/MISMATCH|INVALID/.test(problem) ? 'CONFIGURATION' : 'API_TRANSIENT') : undefined,
    message: problem || undefined,
  } };
});
