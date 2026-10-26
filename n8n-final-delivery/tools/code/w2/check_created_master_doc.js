// @mode each
// @lib common,gdocs
const ctx = $('Create Master Doc Request').item.json.ctx;
const st = docsStatus($json);
if (!st.ok || !st.body.documentId) {
  const perm = docsPermissionError(st, 'create the master document "' + ctx.doc.new_title + '"');
  if (perm) throw new Error(perm);
  setOutcome(ctx, 'ERROR', 'GOOGLE_DOCS_CREATE', 'Could not create the master Google Doc: ' + st.error, st.transient);
  return { json: { ctx, ok: false } };
}
ctx.doc.created_doc_id = st.body.documentId;
ctx.doc.stored = { doc_id: st.body.documentId, title: st.body.title || ctx.doc.new_title, volume: ctx.doc.volume,
  url: 'https://docs.google.com/document/d/' + st.body.documentId + '/edit', created_at: new Date().toISOString(), created_by_execution: ctx.run.execution_id };
return { json: { ctx, ok: true } };
