// @include common, gemini
// Validates Gemini call 1 output. outcome: VALID | RETRY | FAILED | MISMATCH
const ctx = $('Keyword Context').first(0).json;
const SCHEMA = __SCHEMA_PROMPT_CREATOR__;
const parsed = parseGeminiJson($input.first().json);
const problems = [];
if (!parsed.ok) problems.push(parsed.error);
const brief = parsed.ok ? parsed.data : null;
if (brief) {
  problems.push(...checkAgainstSchema(brief, SCHEMA));
  if (normalizeKeyword(brief.Primary_Keyword) !== normalizeKeyword(ctx.primary_keyword)) problems.push(`Primary_Keyword must be exactly "${ctx.primary_keyword}"`);
  try {
    if (normalizeUrl(brief.Target_Page_URL) !== ctx.normalized_url) problems.push(`Target_Page_URL must be exactly "${ctx.target_page_url}"`);
  } catch (e) {
    problems.push(`Target_Page_URL must be exactly "${ctx.target_page_url}"`);
  }
  if (typeof brief.Final_Article_Writing_Prompt === 'string' && brief.Final_Article_Writing_Prompt.trim().length < 400) problems.push('Final_Article_Writing_Prompt is too short to be a complete brief');
  if (brief.Article_Outline && Array.isArray(brief.Article_Outline.Sections) && brief.Article_Outline.Sections.length < 2) problems.push('Article_Outline needs at least two sections');
}
const correctionUsed = $('Build Prompt Correction Request').isExecuted;
let outcome = 'VALID';
if (problems.length) outcome = correctionUsed || parsed.errorType === 'BLOCKED' ? 'FAILED' : 'RETRY';
else if (brief.Page_Analysis.Keyword_Page_Fit === 'MISMATCH') outcome = 'MISMATCH';
return [{ json: {
  outcome,
  brief: problems.length ? null : brief,
  problems,
  raw_text: parsed.text || '',
  error_class: outcome === 'FAILED' ? 'API_TRANSIENT' : undefined,
  retryable: outcome === 'FAILED' ? true : undefined,
  error: outcome === 'FAILED' ? `INVALID_STRUCTURED_OUTPUT (prompt creator, after one correction): ${problems.slice(0, 8).join('; ')}` : undefined,
  review_reason: outcome === 'MISMATCH' ? `KEYWORD_PAGE_MISMATCH: ${brief.Page_Analysis.Fit_Explanation}` : '',
  review_failed_conditions: outcome === 'MISMATCH' ? ['KEYWORD_PAGE_MISMATCH'] : [],
} }];
