// @include gemini
// Everything the reviser needs, for the exact version that failed.
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const att = $('Prepare Attempt').first(0).json;
const fail = $('Collect Attempt Failure').first(0).json;
const rag = $('Validate Brand Context').first(0).json;
const page = $('Analyze Target Page').first(0).json.page;
const brief = $('Validate Article Prompt').first(0).json.brief;
const SYSTEM = __PROMPT_04__ + '\n\n' + __POLICY__;
const identifiers = { Article_ID: claim.article_id, Keyword_ID: ctx.keyword_id, Target_Page_URL: ctx.target_page_url, Primary_Keyword: ctx.primary_keyword, Supporting_Keywords: ctx.supporting_keywords, Language: ctx.language };
const user = [
  `Revise the article. This is revision ${att.local_attempt} (next attempt ${att.local_attempt + 1} of ${att.max_attempts}). Failure source: ${fail.failure_source}.`,
  dataBlock('failed_conditions', fail.failed_conditions),
  dataBlock('current_article', att.article),
  dataBlock('identifiers', identifiers),
  dataBlock('original_writing_prompt', brief.Final_Article_Writing_Prompt),
  dataBlock('brief', { Article_Outline: brief.Article_Outline, Approved_Brand_Facts: brief.Approved_Brand_Facts, Forbidden_Claims: brief.Forbidden_Claims, Internal_Link_Instructions: brief.Internal_Link_Instructions, Validation_Rules: brief.Validation_Rules }),
  dataBlock('editorial_report', fail.editorial_report || 'not produced for this version'),
  dataBlock('source_checks', fail.source_checks || []),
  dataBlock('plagiarism_report', fail.plagiarism_report || 'not produced for this version (editorial checks failed first)'),
  dataBlock('target_page', { url: page.url, title: page.title, h1: page.h1, h2: page.h2, main_text_excerpt: page.main_text_excerpt.slice(0, 4000) }),
  dataBlock('brand_knowledge', rag.brand_knowledge),
  dataBlock('allowed_internal_links', rag.allowed_internal_links.map((l) => l.url)),
].join('\n\n');
return [{ json: {
  model: ctx.config.GEMINI_REVISER_MODEL,
  next_attempt_no: att.attempt_no + 1,
  current_article: att.article,
  gemini_request: buildGeminiRequest(SYSTEM, user, __SCHEMA_REVISION__, ctx.config.GEMINI_MAX_OUTPUT_TOKENS),
} }];
