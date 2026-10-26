// @mode each
// Bounded: at most one document creation per execution.
const ctx = $json.ctx;
const d = ctx.doc;
if (d.create_count >= 1) throw new Error('STATE_ERROR: master document creation was already attempted in this execution; refusing to create another document');
d.create_count += 1;
d.new_title = ctx.config.master_doc_title + (d.volume > 1 ? ' (Volume ' + d.volume + ')' : '');
return { json: { ctx } };
