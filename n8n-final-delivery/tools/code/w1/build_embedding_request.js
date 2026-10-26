// @mode each
// Document embedding (RETRIEVAL_DOCUMENT, explicit 768 dimensions).
const ctx = $json.ctx;
const r = $json.record;
const body = {
  model: 'models/' + ctx.embedding.model,
  content: { parts: [{ text: r.content }] },
  taskType: 'RETRIEVAL_DOCUMENT',
  title: (r.category || r.knowledge_id).slice(0, 200),
  outputDimensionality: ctx.embedding.dimensions,
};
return { json: { ctx, record: r, action: $json.action, expected_hash: $json.content_hash, embedding_request: body } };
