// @mode each
// @lib common
// Compare-and-swap result: if another execution stored a master document
// first, use that one (the document created here stays empty and is reported).
const ctx = $json.ctx;
const m = $json.master_doc;
if (!m || !m.doc_id) throw new Error('STATE_ERROR: master document ID could not be stored in PostgreSQL');
if (!$json.won) ctx.doc.warnings.push('Another execution stored master document ' + m.doc_id + ' first; the empty document ' + ctx.doc.created_doc_id + ' created by this execution can be deleted.');
ctx.doc.doc_id = m.doc_id;
ctx.doc.volume = Number(m.volume || ctx.doc.volume);
return { json: { ctx } };
