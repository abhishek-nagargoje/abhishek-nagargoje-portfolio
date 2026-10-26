// @include common, gemini, article
// Structural validation of the revised article. Whatever the result, the
// version goes back through Prepare Attempt -> editorial -> plagiarism.
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const rag = $('Validate Brand Context').first(0).json;
const parsed = parseGeminiJson($input.first().json);
const problems = [];
let result = null;
let corrections = null;
if (!parsed.ok) problems.push('REVISION_OUTPUT_INVALID: ' + parsed.error);
else {
  problems.push(...checkAgainstSchema(parsed.data, __SCHEMA_REVISION__).map((p) => 'SCHEMA: ' + p));
  corrections = parsed.data.Corrections_Report || null;
  const articleOnly = { ...parsed.data };
  delete articleOnly.Corrections_Report;
  result = validateArticle(articleOnly, { ...ctx, article_id: claim.article_id }, rag.allowed_internal_links.map((l) => l.url), ctx.config);
  problems.push(...result.errors);
}
return [{ json: {
  origin: 'REVISION',
  article: result && result.usable ? result.article : null,
  structure_errors: problems,
  structure_warnings: result ? result.warnings : [],
  revision_corrections: corrections,
} }];
