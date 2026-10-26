// @include common
// Workflow Configuration - NON-SECRET settings only. API keys, OAuth tokens and
// database passwords live in n8n credentials, never here.
// Keep in sync with configuration/config.example.json.
const config = {
  BRAND_ID: 'KARGAR',
  BRAND_NAMES: ['KARGAR', 'KARGAR Facility Management'],
  SPREADSHEET_ID: 'REPLACE_WITH_GOOGLE_SPREADSHEET_ID',
  KEYWORDS_SHEET: 'Keywords',
  ARTICLE_LOG_SHEET: 'Article_Log',
  MASTER_DOC_ID: 'REPLACE_WITH_MASTER_GOOGLE_DOC_ID',
  DOCS_API_BASE: 'https://docs.googleapis.com/v1',

  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
  GEMINI_PROMPT_MODEL: 'gemini-3.8-flash',
  GEMINI_WRITER_MODEL: 'gemini-3.8-flash',
  GEMINI_EVALUATOR_MODEL: 'gemini-3.8-flash',
  GEMINI_REVISER_MODEL: 'gemini-3.8-flash',
  GEMINI_MAX_OUTPUT_TOKENS: 32768,
  EMBEDDING_MODEL: 'gemini-embedding-001',
  EMBEDDING_DIMENSIONS: 768,

  RAG_TOP_K: 6,
  RAG_MIN_SIMILARITY: 0.55,
  RAG_MIN_RELEVANT_CHUNKS: 2,
  RAG_PINNED_CATEGORIES: ['BRAND_VOICE', 'APPROVED_CLAIMS', 'INTERNAL_LINKS', 'SERVICE_AREAS'],
  RAG_PINNED_PER_CATEGORY: 2,

  MAX_ARTICLE_ATTEMPTS: 3,
  MAX_ARTICLES_PER_RUN: 5,
  MAX_TECHNICAL_FAILURES: 3,
  CLAIM_LEASE_MINUTES: 180,

  ALLOWED_URL_SCHEMES: ['https:', 'http:'],
  ALLOWED_TARGET_DOMAINS: [],
  PAGE_MIN_WORDS: 150,
  PAGE_FETCH_TIMEOUT_MS: 30000,
  USER_AGENT: 'Mozilla/5.0 (compatible; SEO-Content-Assistant/1.0; owner-authorised page analysis)',

  ARTICLE_MIN_WORDS: 600,
  REQUIRE_TARGET_PAGE_LINK: true,
  DETERMINISTIC_CLAIM_CHECKS: 'enforce',
  MAX_EXTERNAL_SOURCES_CHECKED: 10,

  PLAGIARISM_PROVIDER: 'duplichecker',
  PLAGIARISM_CHECK_URL: 'https://www.duplichecker.com/api/checkplag',
  PLAGIARISM_INFO_URL: 'https://www.duplichecker.com/api/info',
  PLAGIARISM_PREFLIGHT_ENABLED: true,
  PLAGIARISM_REPHRASED_DETECTION: true,
  PLAGIARISM_THRESHOLD_PERCENT: 10,
  PLAGIARISM_MAX_MATCHED_PASSAGE_WORDS: 40,
  PLAGIARISM_MAX_WORDS_PER_REQUEST: 1000,
  PLAGIARISM_PERCENT_FIELD: '',
  PLAGIARISM_POLL_URL_TEMPLATE: '',
  PLAGIARISM_MAX_POLLS: 10,
  PLAGIARISM_POLL_INTERVAL_SECONDS: 30,
  PLAGIARISM_REQUEST_TIMEOUT_MS: 120000,

  DOC_LOCK_TTL_SECONDS: 300,
  DOC_LOCK_MAX_WAITS: 8,
  DOC_LOCK_WAIT_SECONDS: 15,
  TIMEZONE: 'Asia/Kolkata',
};

const problems = [];
for (const key of ['SPREADSHEET_ID', 'MASTER_DOC_ID']) {
  if (!config[key] || String(config[key]).startsWith('REPLACE_WITH')) problems.push(`${key} is not configured`);
}
if (!Number.isInteger(config.MAX_ARTICLE_ATTEMPTS) || config.MAX_ARTICLE_ATTEMPTS < 1 || config.MAX_ARTICLE_ATTEMPTS > 10) problems.push('MAX_ARTICLE_ATTEMPTS must be 1-10');
if (config.PLAGIARISM_THRESHOLD_PERCENT < 0 || config.PLAGIARISM_THRESHOLD_PERCENT > 100) problems.push('PLAGIARISM_THRESHOLD_PERCENT must be 0-100');
if (problems.length) {
  throw new Error('CONFIGURATION: ' + problems.join('; ') + '. Edit the "Workflow Configuration" node.');
}

return [{ json: { config, run_id: String($execution.id), triggered_at: new Date().toISOString() } }];
