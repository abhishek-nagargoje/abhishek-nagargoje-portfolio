// @mode each
const ctx = $json.ctx;
const c = ctx.config;
if ($json.embedding_column_dims !== c.embedding_dimensions) {
  throw new Error('CONFIG_ERROR: seo_brand_knowledge.embedding is vector(' + $json.embedding_column_dims + ') but this workflow uses ' + c.embedding_dimensions + ' dimensions');
}
if ($json.spreadsheet_matches !== true) {
  throw new Error('CONFIG_ERROR: spreadsheet_id ' + c.spreadsheet_id + ' differs from the ID stored in PostgreSQL (' + $json.stored_spreadsheet_id + '). Set allow_spreadsheet_change to true for one run only if this is intentional.');
}
ctx.kb_before = { active_records: $json.active_records, total_records: $json.total_records, pgvector_version: $json.pgvector_version };
return { json: { ctx } };
