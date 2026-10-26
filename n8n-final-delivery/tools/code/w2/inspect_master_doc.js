// @mode each
// @lib common,gdocs
// Reads the master document: checks access, size and whether this
// article's unique marker is already present (duplicate-write protection).
const ctx = $('Master Doc Request').item.json.ctx;
const st = docsStatus($json);
const d = ctx.doc;
if (!st.ok) {
  const perm = docsPermissionError(st, 'read the master document ' + d.doc_id);
  if (perm) throw new Error(perm);
  if (st.status === 404) {
    // Deleted, trashed or not visible to this credential: start a new volume.
    d.warnings.push('Stored master document ' + d.doc_id + ' returned 404; a new master document will be created.');
    d.previous_doc_id = d.doc_id;
    return { json: { ctx, route: 'CREATE' } };
  }
  setOutcome(ctx, 'ERROR', 'GOOGLE_DOCS_READ', 'Could not read master document: ' + st.error, st.transient);
  return { json: { ctx, route: 'FAIL' } };
}
const doc = st.body;
const text = docText(doc);
d.end_index = docEndIndex(doc);
d.revision_id = doc.revisionId || null;
d.title = doc.title || d.title;
d.url = 'https://docs.google.com/document/d/' + d.doc_id + '/edit';
d.marker_count = countOccurrences(text, ctx.job.marker);
if (d.marker_count > 0) return { json: { ctx, route: 'MARKER_PRESENT' } };
if (d.end_index + ctx.doc_section.char_count > ctx.config.master_doc_max_chars) {
  d.warnings.push('Master document ' + d.doc_id + ' is near the Google Docs size limit; volume ' + (d.volume + 1) + ' will be created.');
  d.previous_doc_id = d.doc_id;
  d.volume += 1;
  return { json: { ctx, route: 'CREATE' } };
}
return { json: { ctx, route: 'APPEND' } };
