// Ingestion configuration - NON-SECRET values only.
// EMBEDDING_MODEL / EMBEDDING_DIMENSIONS must equal the values in the article
// workflow and in seo.embedding_config (checked at run time).
const config = {
  BRAND_ID: 'KARGAR',
  SPREADSHEET_ID: 'REPLACE_WITH_GOOGLE_SPREADSHEET_ID',
  BRAND_KNOWLEDGE_SHEET: 'Brand_Knowledge',
  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
  EMBEDDING_MODEL: 'gemini-embedding-001',
  EMBEDDING_DIMENSIONS: 768,
  MAX_CHUNK_CHARS: 3000,
  ALLOWED_CATEGORIES: ['COMPANY_PROFILE', 'SERVICES', 'SERVICE_AREAS', 'BRAND_VOICE', 'VERIFIED_ACHIEVEMENTS', 'APPROVED_CLAIMS',
    'TECHNICAL_EXPERTISE', 'CUSTOMER_FAQS', 'TARGET_AUDIENCE', 'INTERNAL_LINKS', 'COMPANY_PROCESSES', 'CONTACT_INFORMATION'],
  TIMEZONE: 'Asia/Kolkata',
};
if (String(config.SPREADSHEET_ID).startsWith('REPLACE_WITH')) {
  throw new Error('CONFIGURATION: SPREADSHEET_ID is not configured. Edit the "Ingestion Configuration" node.');
}
return [{ json: { config, execution_id: String($execution.id) } }];
