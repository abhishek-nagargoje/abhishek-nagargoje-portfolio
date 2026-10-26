// @include common
// Validates and normalises Brand_Knowledge rows, splits long content into
// chunks, and routes every row: CHUNK (approved, valid) | INVALID | DEACTIVATE
// (one summary item that soft-deactivates unapproved rows and surplus chunks).
const { config } = $('Ingestion Configuration').first(0).json;
const run = $('Start Ingestion Run').first(0).json;
if (run.db_model !== config.EMBEDDING_MODEL || Number(run.db_dims) !== config.EMBEDDING_DIMENSIONS) {
  throw new Error(`CONFIGURATION: embedding mismatch - database uses ${run.db_model}/${run.db_dims}, workflow configured for ${config.EMBEDDING_MODEL}/${config.EMBEDDING_DIMENSIONS}. See RAG_SETUP.md "Changing the embedding model".`);
}
const REQUIRED = ['Knowledge_ID', 'Category', 'Content', 'Source_URL', 'Approved', 'Last_Updated'];
const rows = $input.all().map((i) => i.json).filter((r) => r && Object.keys(r).length);
const present = new Set(rows.flatMap((r) => Object.keys(r)));
const missingCols = REQUIRED.filter((c) => !present.has(c));
if (rows.length && missingCols.length) throw new Error(`CONFIGURATION: Brand_Knowledge tab is missing column(s): ${missingCols.join(', ')}`);

const normalise = (t) => String(t ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const splitChunks = (text, max) => {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const para of text.split(/\n\n+/)) {
    const pieces = para.length > max ? para.match(new RegExp(`[\\s\\S]{1,${max}}(?=\\s|$)`, 'g')) || [para.slice(0, max)] : [para];
    for (const piece of pieces) {
      if ((cur + '\n\n' + piece).length > max && cur) { out.push(cur.trim()); cur = ''; }
      cur = cur ? cur + '\n\n' + piece : piece;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

const idCounts = {};
for (const r of rows) { const id = asText(r.Knowledge_ID); if (id) idCounts[id] = (idCounts[id] || 0) + 1; }
const out = [];
const unapproved = [];
const chunkCounts = {};
let approvedRows = 0;
let invalidRows = 0;
for (const r of rows) {
  const id = asText(r.Knowledge_ID);
  const errors = [];
  if (!id) errors.push('Knowledge_ID is empty');
  else if (!/^[A-Za-z0-9_\-.]{1,64}$/.test(id)) errors.push('Knowledge_ID may contain only letters, digits, "_", "-", "." (max 64)');
  else if (idCounts[id] > 1) errors.push(`Knowledge_ID ${id} appears ${idCounts[id]} times`);
  if (!isTruthyFlag(r.Approved)) {
    if (id && !errors.length) unapproved.push(id);
    continue; // not approved: never embedded; existing chunks get deactivated
  }
  approvedRows += 1;
  const category = asText(r.Category).toUpperCase().replace(/\s+/g, '_');
  const content = normalise(r.Content);
  const sourceUrl = asText(r.Source_URL);
  if (!category) errors.push('Category is empty');
  else if (config.ALLOWED_CATEGORIES.length && !config.ALLOWED_CATEGORIES.includes(category)) errors.push(`Category ${category} is not in ALLOWED_CATEGORIES`);
  if (content.length < 20) errors.push('Content is empty or shorter than 20 characters');
  if (/^REPLACE WITH/i.test(content)) errors.push('Content is still the template placeholder; replace it with verified information');
  if (sourceUrl) {
    const u = parseUrl(sourceUrl);
    if (!u) errors.push('Source_URL is not a valid absolute URL');
    else if (!/^https?:$/.test(u.protocol)) errors.push('Source_URL must be http(s)');
  }
  if (errors.length) {
    invalidRows += 1;
    out.push({ json: { route: 'INVALID', knowledge_id: id || `(row ${r.row_number})`, error_class: 'INPUT', message: errors.join('; ') } });
    continue;
  }
  const chunks = splitChunks(content, config.MAX_CHUNK_CHARS);
  chunkCounts[id] = chunks.length;
  chunks.forEach((text, idx) => {
    out.push({ json: {
      route: 'CHUNK',
      brand_id: config.BRAND_ID,
      knowledge_id: id,
      chunk_index: idx,
      chunk_id: `${config.BRAND_ID}:${id}:${idx}`,
      category,
      content: text,
      source_url: sourceUrl,
      last_updated: asText(r.Last_Updated),
      metadata: { sheet_row: r.row_number, chunk_count: chunks.length, source: 'google_sheets:' + config.BRAND_KNOWLEDGE_SHEET },
      hash_input: [category, text, sourceUrl, config.EMBEDDING_MODEL, config.EMBEDDING_DIMENSIONS].join('␟'),
    } });
  });
}
out.push({ json: { route: 'DEACTIVATE', unapproved_ids: unapproved, chunk_counts: chunkCounts, rows_read: rows.length, rows_approved: approvedRows, rows_invalid: invalidRows } });
return out;
