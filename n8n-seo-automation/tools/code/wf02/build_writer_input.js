// @include gemini
// Gemini call 2 input. The ORIGINAL retrieved chunks are passed in addition to
// the brief so verified facts reach the writer unaltered.
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const page = $('Analyze Target Page').first(0).json.page;
const rag = $('Validate Brand Context').first(0).json;
const brief = $('Validate Article Prompt').first(0).json.brief;
const SYSTEM = __PROMPT_02__ + '\n\n' + __POLICY__;
const identifiers = {
  Article_ID: claim.article_id,
  Keyword_ID: ctx.keyword_id,
  Target_Page_URL: ctx.target_page_url,
  Primary_Keyword: ctx.primary_keyword,
  Supporting_Keywords: ctx.supporting_keywords,
  Language: ctx.language,
};
const briefForWriter = {
  Article_Objective: brief.Article_Objective,
  Unique_Content_Angle: brief.Unique_Content_Angle,
  Article_Outline: brief.Article_Outline,
  Approved_Brand_Facts: brief.Approved_Brand_Facts,
  Forbidden_Claims: brief.Forbidden_Claims,
  Source_Requirements: brief.Source_Requirements,
  Internal_Link_Instructions: brief.Internal_Link_Instructions,
  Validation_Rules: brief.Validation_Rules,
  Page_Analysis: { Covered_Topics: brief.Page_Analysis.Covered_Topics, Content_Gaps: brief.Page_Analysis.Content_Gaps, Duplication_Risk: brief.Page_Analysis.Duplication_Risk },
};
const condensedPage = { url: page.url, title: page.title, meta_description: page.meta_description, h1: page.h1, h2: page.h2, ctas: page.ctas };
const user = [
  'Write the article now, following this prompt:',
  dataBlock('writing_prompt', brief.Final_Article_Writing_Prompt),
  dataBlock('brief', briefForWriter),
  dataBlock('identifiers', identifiers),
  dataBlock('target_page', condensedPage),
  dataBlock('brand_knowledge', rag.brand_knowledge),
  dataBlock('allowed_internal_links', rag.allowed_internal_links.map((l) => l.url)),
].join('\n\n');
return [{ json: {
  model: ctx.config.GEMINI_WRITER_MODEL,
  gemini_request: buildGeminiRequest(SYSTEM, user, __SCHEMA_ARTICLE__, ctx.config.GEMINI_MAX_OUTPUT_TOKENS),
} }];
