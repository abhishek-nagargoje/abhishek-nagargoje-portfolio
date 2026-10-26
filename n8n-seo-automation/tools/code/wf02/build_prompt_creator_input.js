// @include gemini
// Gemini call 1 input: page analysis + keyword + retrieved brand knowledge.
// Untrusted material (page text, knowledge) is wrapped in data blocks.
const ctx = $('Keyword Context').first(0).json;
const page = $('Analyze Target Page').first(0).json.page;
const rag = $('Validate Brand Context').first(0).json;
const SYSTEM = __PROMPT_01__ + '\n\n' + __POLICY__;
const request = {
  Keyword_ID: ctx.keyword_id,
  Target_Page_URL: ctx.target_page_url,
  Primary_Keyword: ctx.primary_keyword,
  Supporting_Keywords: ctx.supporting_keywords,
  Search_Intent: ctx.search_intent || '(not supplied - infer from keyword and page)',
  Target_Audience: ctx.target_audience || '(not supplied - infer from page)',
  Target_Location: ctx.target_location || '(not supplied)',
  Language: ctx.language,
};
const editorial = {
  originality: 'Original explanation and analysis; no copying or superficial paraphrasing of any source; no keyword stuffing or density targets.',
  eeat: 'Accurate, practical, honest about limits; no invented experience, credentials, statistics, testimonials or case studies.',
  length: 'Appropriate to topic and intent; no padding. The workflow enforces a technical minimum of ' + ctx.config.ARTICLE_MIN_WORDS + ' words.',
  internal_links: 'Only allowed_internal_links; link to the target page contextually.',
  output_fields: ['Article_ID', 'Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Supporting_Keywords', 'Article_Title', 'SEO_Title', 'H1', 'Meta_Description', 'URL_Slug', 'Excerpt', 'Article_Markdown', 'Suggested_FAQs', 'Internal_Link_Suggestions', 'External_Sources', 'Verified_Brand_Facts_Used', 'Word_Count'],
};
const user = [
  'Create the article-writing brief for this request.',
  dataBlock('request', request),
  dataBlock('target_page', page),
  dataBlock('brand_knowledge', rag.brand_knowledge),
  dataBlock('allowed_internal_links', rag.allowed_internal_links),
  dataBlock('editorial_requirements', editorial),
].join('\n\n');
return [{ json: {
  model: ctx.config.GEMINI_PROMPT_MODEL,
  gemini_request: buildGeminiRequest(SYSTEM, user, __SCHEMA_PROMPT_CREATOR__, ctx.config.GEMINI_MAX_OUTPUT_TOKENS),
} }];
