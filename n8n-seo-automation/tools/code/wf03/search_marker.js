// @include docs
// For each unresolved ledger row: is the article's unique marker in the doc?
const rows = $('Drop Empty Ledger Rows').all(0).map((i) => i.json);
return $input.all().map((it, i) => {
  const row = rows[i];
  if (it.json.error) return { json: { ...row, verdict: 'READ_FAILED', detail: String(it.json.error.message || it.json.error).slice(0, 300) } };
  const count = countOccurrences(documentPlainText(it.json), row.marker);
  return { json: { ...row, verdict: count > 0 ? 'FOUND' : 'NOT_FOUND', marker_count: count } };
});
