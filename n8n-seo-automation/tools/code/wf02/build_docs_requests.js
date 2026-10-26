// @include docs
// Computes the insertion index from the current end of the master document and
// builds the batchUpdate. writeControl.requiredRevisionId makes Google reject
// the write if the document changed after it was read (no index corruption).
const fmt = $('Format Approved Article').first(0).json;
const doc = $input.first().json;
const text = documentPlainText(doc);
if (countOccurrences(text, fmt.marker) > 0) {
  return [{ json: { already_present: true } }];
}
const end = documentEndIndex(doc);
const base = Math.max(1, end - 1);
const built = buildDocsRequests(fmt.paragraphs, base, end > 2);
return [{ json: {
  already_present: false,
  base_index: base,
  request_count: built.requests.length,
  batch_update: { requests: built.requests, writeControl: { requiredRevisionId: doc.revisionId } },
} }];
