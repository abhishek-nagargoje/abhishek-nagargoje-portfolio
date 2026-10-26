// @mode all
// =====================================================================
// HR Remedy India - Brand RAG Ingestion: THE ONLY CONFIGURATION NODE.
// Must use the same spreadsheet, embedding model and dimensions as
// "HR Remedy India - SEO Article Automation". No secrets belong here.
// =====================================================================
const CONFIG = {
  brand_id: 'hr-remedy-india',
  brand_name: 'HR Remedy India',
  official_website: 'https://www.hrremedyindia.com/',
  official_domains: ['hrremedyindia.com'],
  timezone: 'Asia/Kolkata',
  spreadsheet_id: '171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg',
  sheets: { brand_knowledge: 'Brand_Knowledge' },
  allow_spreadsheet_change: false,
  gemini_api_base: 'https://generativelanguage.googleapis.com/v1beta',
  embedding_model: 'gemini-embedding-001',
  embedding_dimensions: 768,
  // gemini-embedding-001 accepts up to 2,048 input tokens; longer records
  // must be split into separate Knowledge_IDs (they are never truncated).
  max_content_chars: 7000,
};
return [{ json: { config: CONFIG } }];
