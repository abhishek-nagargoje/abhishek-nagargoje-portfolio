// @mode all
// @lib common
const c = $input.first().json.config;
const errors = [];
const req = (cond, msg) => { if (!cond) errors.push(msg); };
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
req(c && typeof c === 'object', 'Configuration node did not return a config object');
req(/^[A-Za-z0-9_-]{30,}$/.test(asText(c.spreadsheet_id)), 'spreadsheet_id does not look like a Google Sheets document ID');
req(c.sheets && c.sheets.keywords === 'Keywords' && c.sheets.brand_knowledge === 'Brand_Knowledge' && c.sheets.article_log === 'Article_Log',
  'sheet tab names must stay Keywords / Brand_Knowledge / Article_Log');
req(c.embedding_model === 'gemini-embedding-001', 'embedding_model must match the model used by Brand RAG Ingestion (gemini-embedding-001)');
req(c.embedding_dimensions === 768, 'embedding_dimensions must be 768 to match the vector(768) column');
req(asText(c.gemini_text_model) !== '', 'gemini_text_model must be "auto" or an explicit model ID');
req(Array.isArray(c.allowed_target_domains) && c.allowed_target_domains.length > 0, 'allowed_target_domains must list at least one domain');
req(num(c.max_attempts, 1, 5), 'max_attempts must be between 1 and 5');
req(num(c.lease_minutes, 10, 120), 'lease_minutes must be 10-120');
req(num(c.rag_top_k, 1, 20) && num(c.rag_min_similarity, 0, 1), 'rag_top_k must be 1-20 and rag_min_similarity 0-1');
req(num(c.target_min_words, 300, 5000) && num(c.target_max_words, c.target_min_words, 6000), 'target word range is invalid');
req(/^https:\/\//.test(asText(c.gemini_api_base)) && /^https?:\/\//.test(asText(c.docs_api_base)), 'API base URLs must be absolute URLs');
req(c.originality_reviewer === 'gemini_originality_review', 'originality_reviewer must be gemini_originality_review');
req(c.external_plagiarism_check_performed === false, 'this workflow performs no external plagiarism check; external_plagiarism_check_performed must stay false');
req(c.doc_setting_key === 'review_doc', 'doc_setting_key must be review_doc (articles go to the pending-human-review document)');
req(num(c.originality_page_excerpt_chars, 1000, 20000), 'originality_page_excerpt_chars must be 1000-20000');
if (errors.length) throw new Error('CONFIG_ERROR: ' + errors.join('; '));
return [{ json: { ctx: {
  config: c,
  run: { execution_id: String($execution.id), mode: $execution.mode, started_at: new Date().toISOString(), started_at_local: nowLocal(c.timezone) },
} } }];
