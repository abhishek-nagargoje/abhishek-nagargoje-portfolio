// @mode each
// @lib common
// Builds one atomic documents.batchUpdate request that appends the article
// as a separate section (page break, real heading styles, bullet lists,
// hyperlinks). The ledger row was written as PENDING just before this.
assertLease($json, 'Build Docs Append Request');
const ctx = $json.ctx;
const det = $json.detail || {};
if (det.already_verified) {
  // The ledger says this Article_ID was written and verified, but the marker
  // was not found in the current master document: never append blindly.
  setOutcome(ctx, 'REVIEW_REQUIRED', 'GOOGLE_DOCS_WRITE', 'Ledger shows ' + ctx.job.article_id + ' was already inserted into document ' + det.doc_id +
    ' but its marker ' + ctx.job.marker + ' was not found in ' + ctx.doc.doc_id + '. Check the document manually before re-queuing.', false);
  return { json: { ctx, ok: false } };
}
const s = ctx.doc_section;
const E = Math.max(1, ctx.doc.end_index - 1);
const R = (a, b) => ({ startIndex: E + a, endIndex: E + b });
const requests = [{ insertText: { location: { index: E }, text: s.text } }];
// Reset inherited styles across the inserted range, then apply ours.
requests.push({ updateParagraphStyle: { range: R(1, s.text.length), paragraphStyle: { namedStyleType: 'NORMAL_TEXT', pageBreakBefore: false }, fields: 'namedStyleType,pageBreakBefore' } });
requests.push({ updateTextStyle: { range: R(1, s.text.length), textStyle: {}, fields: 'bold,italic,link' } });
s.paragraphStyles.filter((p) => p.named !== 'NORMAL_TEXT').forEach((p, i) => {
  requests.push({ updateParagraphStyle: { range: R(p.start, p.end), paragraphStyle: { namedStyleType: p.named }, fields: 'namedStyleType' } });
});
// Each article starts on a new page: the section title paragraph gets
// pageBreakBefore (not needed for the first article of a new document).
if (E > 1) {
  const title = s.paragraphStyles[0];
  requests.push({ updateParagraphStyle: { range: R(title.start, title.end), paragraphStyle: { pageBreakBefore: true }, fields: 'pageBreakBefore' } });
}
s.textStyles.forEach((t) => {
  if (t.type === 'bold') requests.push({ updateTextStyle: { range: R(t.start, t.end), textStyle: { bold: true }, fields: 'bold' } });
  else if (t.type === 'italic') requests.push({ updateTextStyle: { range: R(t.start, t.end), textStyle: { italic: true }, fields: 'italic' } });
  else if (t.type === 'link' && t.url) requests.push({ updateTextStyle: { range: R(t.start, t.end), textStyle: { link: { url: t.url } }, fields: 'link' } });
});
s.bullets.forEach((b) => {
  requests.push({ createParagraphBullets: { range: R(b.start, b.end), bulletPreset: b.numbered ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE' } });
});
const body = { requests };
if (ctx.doc.revision_id) body.writeControl = { targetRevisionId: ctx.doc.revision_id };
ctx.docs_request = body;
ctx.doc.ledger_write_count = det.write_count;
return { json: { ctx, ok: true } };
