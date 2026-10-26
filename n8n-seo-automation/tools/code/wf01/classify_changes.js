// Compares freshly hashed chunks with what is stored. Unchanged chunks are not
// re-embedded (idempotency, cost); new/changed chunks get an embed request.
const { config } = $('Ingestion Configuration').first(0).json;
const existing = new Map($input.all().map((i) => i.json).filter((r) => r.chunk_id).map((r) => [r.chunk_id, r]));
return $('Hash Content').all(0).map((i) => {
  const c = i.json;
  const prev = existing.get(c.chunk_id);
  const change = !prev ? 'NEW' : (prev.content_hash !== c.content_hash || prev.is_active === false ? 'CHANGED' : 'UNCHANGED');
  return { json: {
    ...c,
    change,
    embedding_request: change === 'UNCHANGED' ? null : {
      model: `models/${config.EMBEDDING_MODEL}`,
      content: { parts: [{ text: c.content }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      title: c.category,
      outputDimensionality: config.EMBEDDING_DIMENSIONS,
    },
  } };
});
