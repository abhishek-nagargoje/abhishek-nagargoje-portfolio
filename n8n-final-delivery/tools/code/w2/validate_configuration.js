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
req(num(c.plagiarism_threshold_percent, 0, 100), 'plagiarism_threshold_percent must be 0-100');
req(num(c.plagiarism_max_rephrased_percent, 0, 100), 'plagiarism_max_rephrased_percent must be 0-100');
req(num(c.plagiarism_poll_interval_seconds, 5, 60), 'plagiarism_poll_interval_seconds must be 5-60');
req(num(c.plagiarism_max_polls, 1, 90), 'plagiarism_max_polls must be 1-90');
req(num(c.lease_minutes, 10, 120), 'lease_minutes must be 10-120');
req(c.lease_minutes * 60 > c.plagiarism_poll_interval_seconds * c.plagiarism_max_polls + 300,
  'lease_minutes must exceed the maximum plagiarism polling time plus 5 minutes');
req(num(c.rag_top_k, 1, 20) && num(c.rag_min_similarity, 0, 1), 'rag_top_k must be 1-20 and rag_min_similarity 0-1');
req(num(c.target_min_words, 300, 5000) && num(c.target_max_words, c.target_min_words, 6000), 'target word range is invalid');
req(/^https:\/\//.test(asText(c.gemini_api_base)) && /^https?:\/\//.test(asText(c.duplichecker_api_base)) && /^https?:\/\//.test(asText(c.docs_api_base)), 'API base URLs must be absolute URLs');
if (errors.length) throw new Error('CONFIG_ERROR: ' + errors.join('; '));
return [{ json: { ctx: {
  config: c,
  run: { execution_id: String($execution.id), mode: $execution.mode, started_at: new Date().toISOString(), started_at_local: nowLocal(c.timezone) },
} } }];
