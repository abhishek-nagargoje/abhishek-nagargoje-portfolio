// @mode each
// @lib common
assertLease($json, 'Plan Master Doc Access');
const ctx = $json.ctx;
const m = $json.master_doc || null;
ctx.doc = {
  doc_id: m && m.doc_id ? m.doc_id : null, title: m && m.title ? m.title : ctx.config.master_doc_title,
  volume: m && m.volume ? Number(m.volume) : 1, create_count: 0, warnings: [],
};
return { json: { ctx, known: !!ctx.doc.doc_id } };
