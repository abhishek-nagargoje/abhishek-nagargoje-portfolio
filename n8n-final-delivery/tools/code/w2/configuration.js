// @mode all
// =====================================================================
// HR Remedy India - SEO Article Automation: THE ONLY CONFIGURATION NODE.
// Every other node reads these values; nothing else needs editing.
// No secrets belong here: API keys and tokens live in n8n credentials.
// =====================================================================
const CONFIG = {
  brand_id: 'hr-remedy-india',
  brand_name: 'HR Remedy India',
  official_website: 'https://www.hrremedyindia.com/',
  timezone: 'Asia/Kolkata',

  // Google Sheets (existing spreadsheet "HR Remedy India - SEO Content Automation")
  spreadsheet_id: '171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg',
  sheets: { keywords: 'Keywords', brand_knowledge: 'Brand_Knowledge', article_log: 'Article_Log' },
  // Set to true only if you deliberately move to a different spreadsheet.
  allow_spreadsheet_change: false,

  // Target pages must belong to these domains (protects against fetching
  // arbitrary URLs typed into the sheet).
  allowed_target_domains: ['hrremedyindia.com'],
  page_min_words: 120,

  // Gemini (credential: "Google Gemini(PaLM) Api"). "auto" selects the newest
  // stable (non-preview) Gemini Flash model that your API key can access and
  // that supports generateContent. You may set an explicit model ID instead,
  // e.g. the value shown by Google AI Studio; it is verified before each run.
  gemini_api_base: 'https://generativelanguage.googleapis.com/v1beta',
  gemini_text_model: 'auto',
  gemini_auto_tier_preference: ['flash', 'pro'],
  gemini_max_output_tokens: 32768,
  embedding_model: 'gemini-embedding-001',
  embedding_dimensions: 768,

  // RAG retrieval
  rag_top_k: 8,
  rag_min_similarity: 0.45,
  rag_min_relevant_chunks: 2,
  rag_always_include_categories: ['Brand Voice', 'Company Profile'],

  // Article policy
  max_attempts: 3,
  target_min_words: 900,
  target_max_words: 2200,

  // Plagiarism policy (internal policy, not a universal definition)
  duplichecker_api_base: 'https://www.duplichecker.com/api',
  plagiarism_threshold_percent: 10,
  plagiarism_max_rephrased_percent: 20,
  plagiarism_check_rephrased: true,
  plagiarism_max_words: 5000,
  plagiarism_poll_interval_seconds: 20,
  plagiarism_max_polls: 30,
  plagiarism_min_account_words: 3000,

  // Google Docs master document (created automatically; ID stored in PostgreSQL)
  docs_api_base: 'https://docs.googleapis.com/v1',
  master_doc_title: 'HR Remedy India — SEO Article Library',
  master_doc_max_chars: 900000,

  // Database lease (minutes) for one keyword; extended at every stage.
  lease_minutes: 20,
};
return [{ json: { config: CONFIG } }];
