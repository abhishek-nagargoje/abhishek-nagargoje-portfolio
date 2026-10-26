// @mode each
// @lib common,gdocs
// Verifies the write by reading the document back. APPROVED is only set
// after this succeeds.
const ctx = $('Check Append Response').item.json.ctx;
const st = docsStatus($json);
if (!st.ok) {
  setOutcome(ctx, 'ERROR', 'GOOGLE_DOCS_VERIFY', 'Could not read the master document back to verify the write: ' + st.error +
    '. The ledger is PENDING; Error Recovery / the next run will check the marker before writing again.', true);
  return { json: { ctx, ok: false } };
}
const text = docText(st.body);
const n = countOccurrences(text, ctx.job.marker);
if (n < 1 || text.indexOf(ctx.article.Article_Title.slice(0, 40)) < 0) {
  setOutcome(ctx, 'ERROR', 'GOOGLE_DOCS_VERIFY', 'Google Docs accepted the update but marker ' + ctx.job.marker + ' / title were not found when reading the document back', true);
  return { json: { ctx, ok: false } };
}
if (n > 1) ctx.doc.warnings.push('Marker ' + ctx.job.marker + ' appears ' + n + ' times in the document');
ctx.doc.verified = true;
ctx.doc.url = 'https://docs.google.com/document/d/' + ctx.doc.doc_id + '/edit';
return { json: { ctx, ok: true } };
