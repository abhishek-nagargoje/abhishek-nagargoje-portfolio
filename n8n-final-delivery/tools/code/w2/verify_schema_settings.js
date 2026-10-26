// @mode each
// @lib common
const ctx = $json.ctx;
const c = ctx.config;
if ($json.embedding_column_dims !== c.embedding_dimensions) {
  throw new Error('CONFIG_ERROR: seo_brand_knowledge.embedding is vector(' + $json.embedding_column_dims + ') but the workflow uses ' + c.embedding_dimensions + ' dimensions');
}
if ($json.spreadsheet_matches !== true) {
  throw new Error('CONFIG_ERROR: spreadsheet_id ' + c.spreadsheet_id + ' differs from the ID already stored in PostgreSQL (' + $json.stored_spreadsheet_id +
    '). If you intentionally changed spreadsheets set allow_spreadsheet_change to true for one run.');
}
if (!($json.active_records > 0)) {
  throw new Error('CONFIG_ERROR: the HR Remedy India brand knowledge base is empty (0 active records for ' + c.embedding_model +
    '). Run "HR Remedy India - Brand RAG Ingestion" first. Articles are never generated without verified brand context.');
}
ctx.kb = { active_records: $json.active_records, total_records: $json.total_records, pgvector_version: $json.pgvector_version };
ctx.master_doc_known = !!($json.master_doc && $json.master_doc.doc_id);
return { json: { ctx } };
