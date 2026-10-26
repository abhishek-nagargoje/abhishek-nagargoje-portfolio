// @include gemini
// Independent editorial evaluation input: the actual article plus evidence.
const ctx = $('Keyword Context').first(0).json;
const att = $('Prepare Attempt').first(0).json;
const rag = $('Validate Brand Context').first(0).json;
const page = $('Analyze Target Page').first(0).json.page;
const brief = $('Validate Article Prompt').first(0).json.brief;
const det = $('Aggregate Source Checks').first(0).json;
const SYSTEM = __PROMPT_03__ + '\n\n' + __POLICY__;
const user = [
  `Evaluate this article (attempt ${att.local_attempt} of ${att.max_attempts}). Primary keyword: "${ctx.primary_keyword}". Search intent: "${brief.Search_Intent}". Audience: "${brief.Target_Audience}". Language: ${ctx.language}.`,
  dataBlock('article', att.article),
  dataBlock('brief', { Article_Objective: brief.Article_Objective, Unique_Content_Angle: brief.Unique_Content_Angle, Article_Outline: brief.Article_Outline, Forbidden_Claims: brief.Forbidden_Claims, Validation_Rules: brief.Validation_Rules, Page_Analysis: brief.Page_Analysis }),
  dataBlock('target_page', { url: page.url, title: page.title, meta_description: page.meta_description, h1: page.h1, h2: page.h2, main_text_excerpt: page.main_text_excerpt.slice(0, 6000) }),
  dataBlock('brand_knowledge', rag.brand_knowledge),
  dataBlock('allowed_internal_links', rag.allowed_internal_links.map((l) => l.url)),
  dataBlock('deterministic_checks', det.deterministic_checks),
  dataBlock('source_checks', det.source_checks),
].join('\n\n');
return [{ json: {
  model: ctx.config.GEMINI_EVALUATOR_MODEL,
  for_attempt: att.attempt_no,
  gemini_request: buildGeminiRequest(SYSTEM, user, __SCHEMA_EVALUATOR__, ctx.config.GEMINI_MAX_OUTPUT_TOKENS),
} }];
