// Rejects embeddings with the wrong length or non-numeric values instead of
// letting pgvector fail later or silently mixing dimensions.
const cfg = $('Keyword Context').first(0).json.config;
const values = $input.first().json.embedding && $input.first().json.embedding.values;
if (!Array.isArray(values) || values.length === 0) {
  throw new Error('EMBEDDING_INVALID: embedContent response contains no embedding.values');
}
if (values.length !== cfg.EMBEDDING_DIMENSIONS) {
  throw new Error(`EMBEDDING_DIMENSION_MISMATCH: got ${values.length} dimensions, expected ${cfg.EMBEDDING_DIMENSIONS}`);
}
if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
  throw new Error('EMBEDDING_INVALID: embedding contains non-numeric values');
}
return [{ json: { query_vector: '[' + values.join(',') + ']', dimensions: values.length } }];
