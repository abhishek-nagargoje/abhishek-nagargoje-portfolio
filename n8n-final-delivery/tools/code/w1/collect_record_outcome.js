// @mode each
// Normalises the result of every branch before returning to the loop.
const j = $json;
let o = j.outcome;
if (!o && j.action === 'UNCHANGED') o = { knowledge_id: j.knowledge_id, status: 'UNCHANGED', error: '' };
if (!o) o = { knowledge_id: j.knowledge_id || (j.record && j.record.knowledge_id) || '', status: 'FAILED', error: j.error ? String(j.error.message || j.error) : 'unexpected branch result' };
return { json: { ctx: j.ctx, outcome: o } };
