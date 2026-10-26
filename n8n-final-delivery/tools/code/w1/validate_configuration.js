// @mode all
// @lib common
const c = $input.first().json.config;
const errors = [];
if (!/^[A-Za-z0-9_-]{30,}$/.test(asText(c.spreadsheet_id))) errors.push('spreadsheet_id does not look like a Google Sheets document ID');
if (c.sheets.brand_knowledge !== 'Brand_Knowledge') errors.push('the knowledge tab must be Brand_Knowledge');
if (c.embedding_model !== 'gemini-embedding-001') errors.push('embedding_model must be gemini-embedding-001 (same as the article workflow)');
if (c.embedding_dimensions !== 768) errors.push('embedding_dimensions must be 768 to match the vector(768) column');
if (!(c.max_content_chars >= 500 && c.max_content_chars <= 8000)) errors.push('max_content_chars must be 500-8000');
if (errors.length) throw new Error('CONFIG_ERROR: ' + errors.join('; '));
return [{ json: { ctx: { config: c, run: { execution_id: String($execution.id), started_at: new Date().toISOString() } } } }];
