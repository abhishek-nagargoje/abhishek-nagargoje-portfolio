// @mode each
// Confirms that PostgreSQL stored exactly what was intended.
const src = $('Validate Embedding').item.json;
const r = src.record;
const problems = [];
if ($json.knowledge_id !== r.knowledge_id) problems.push('stored knowledge_id mismatch');
if ($json.content_hash !== src.expected_hash) problems.push('stored content hash differs from the checked hash');
if ($json.stored_dimensions !== src.ctx.embedding.dimensions) problems.push('stored embedding has ' + $json.stored_dimensions + ' dimensions');
if ($json.is_active !== true) problems.push('record is not active after upsert');
const status = problems.length ? 'FAILED' : $json.action; // INSERTED | UPDATED
return { json: { ctx: src.ctx, outcome: { knowledge_id: r.knowledge_id, row_number: r.row_number, status, planned: src.action, error: problems.join('; ') } } };
