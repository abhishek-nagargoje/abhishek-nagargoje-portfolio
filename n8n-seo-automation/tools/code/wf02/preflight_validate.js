// Compares the database state with the workflow configuration and emits one
// item per distinct Gemini model so each model ID is verified before any work.
const { config } = $('Workflow Configuration').first(0).json;
const db = $input.first().json;
const problems = [];
if (!db.pgvector_version) problems.push('pgvector extension is not installed in the database');
const migrations = Array.isArray(db.migrations) ? db.migrations : String(db.migrations || '').replace(/[{}]/g, '').split(',');
for (const v of ['01', '02', '03', '04']) if (!migrations.includes(v)) problems.push(`database script ${v} has not been applied`);
if (db.embedding_model !== config.EMBEDDING_MODEL || Number(db.embedding_dimensions) !== Number(config.EMBEDDING_DIMENSIONS)) {
  problems.push(`embedding mismatch: database indexed with ${db.embedding_model}/${db.embedding_dimensions}, workflow configured for ${config.EMBEDDING_MODEL}/${config.EMBEDDING_DIMENSIONS}. Re-embed (see RAG_SETUP.md) or fix the configuration.`);
}
if (Number(db.active_chunks) === 0) problems.push(`brand knowledge base is empty for BRAND_ID ${config.BRAND_ID}; run "01 Brand RAG Ingestion" first`);
if (problems.length) throw new Error('CONFIGURATION: ' + problems.join('; '));

const models = [...new Set([config.GEMINI_PROMPT_MODEL, config.GEMINI_WRITER_MODEL, config.GEMINI_EVALUATOR_MODEL, config.GEMINI_REVISER_MODEL, config.EMBEDDING_MODEL])];
return models.map((model) => ({ json: { model } }));
