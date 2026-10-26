// @mode all
// @lib common
// Only rows whose Approved cell is explicitly TRUE (checkbox or the text
// TRUE) are ingested. Blank Knowledge_ID or Content rows are ignored.
const ctx = $('Verify Embedding Model').first().json.ctx;
const HEADERS = ['Knowledge_ID', 'Category', 'Content', 'Source_URL', 'Approved', 'Last_Updated'];
const rows = $input.all().map((i) => i.json).filter((r) => r && r.row_number !== undefined && HEADERS.some((h) => asText(r[h]) !== ''));
if (!rows.length) {
  throw new Error('KNOWLEDGE_BASE_EMPTY: the Brand_Knowledge sheet has no data rows. Add verified HR Remedy India information (Knowledge_ID, Category, Content, Source_URL, Approved = TRUE) before running ingestion.');
}
const missing = HEADERS.filter((h) => !(h in rows[0]));
if (missing.length) throw new Error('CONFIG_ERROR: Brand_Knowledge sheet is missing header(s): ' + missing.join(', '));
const isApproved = (v) => v === true || (typeof v === 'string' && v.trim().toUpperCase() === 'TRUE');
const stats = { rows_read: rows.length, approved_rows: 0, unapproved_skipped: 0, invalid_skipped: 0, duplicate_ids_skipped: 0, invalid: [] };
const seen = new Set();
const out = [];
for (const r of rows) {
  if (!isApproved(r.Approved)) { stats.unapproved_skipped++; continue; }
  stats.approved_rows++;
  const id = asText(r.Knowledge_ID);
  const content = asText(r.Content);
  if (!id || !content) { stats.invalid_skipped++; stats.invalid.push({ row_number: r.row_number, reason: !id ? 'blank Knowledge_ID' : 'blank Content' }); continue; }
  if (seen.has(id.toLowerCase())) { stats.duplicate_ids_skipped++; stats.invalid.push({ row_number: r.row_number, knowledge_id: id, reason: 'duplicate Knowledge_ID (first row kept)' }); continue; }
  seen.add(id.toLowerCase());
  out.push({ knowledge_id: id, category: asText(r.Category), content, source_url: asText(r.Source_URL), last_updated: asText(r.Last_Updated), row_number: r.row_number });
}
if (!out.length) {
  throw new Error('KNOWLEDGE_BASE_EMPTY: no Brand_Knowledge row is both Approved = TRUE and has a Knowledge_ID and Content (' + JSON.stringify(stats) + '). Nothing was ingested.');
}
ctx.stats = stats;
ctx.approved_ids = out.map((r) => r.knowledge_id);
return out.map((record) => ({ json: { ctx, record }, pairedItem: { item: 0 } }));
