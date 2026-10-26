// @mode each
// @lib common,gdocs
const ctx = $('Build Docs Append Request').item.json.ctx;
delete ctx.docs_request;
const st = docsStatus($json);
if (!st.ok) {
  const perm = docsPermissionError(st, 'insert content into the master document ' + ctx.doc.doc_id);
  if (perm) throw new Error(perm);
  // The ledger stays PENDING: recovery re-checks the marker before any retry.
  setOutcome(ctx, 'ERROR', 'GOOGLE_DOCS_WRITE', 'Google Docs batchUpdate failed: ' + st.error, st.transient || st.status === 400);
  return { json: { ctx, ok: false } };
}
ctx.doc.write_response = { replies: Array.isArray(st.body.replies) ? st.body.replies.length : 0, revision: st.body.writeControl ? st.body.writeControl.requiredRevisionId : null };
return { json: { ctx, ok: true } };
