// @include common, gemini, article
// Validates Gemini call 2 output.
// outcome: VALID | RETRY (one correction) | USABLE_INVALID (enters the revision
// loop as a failed attempt) | FAILED (technical: nothing usable)
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const rag = $('Validate Brand Context').first(0).json;
const parsed = parseGeminiJson($input.first().json);
const problems = [];
let result = null;
if (!parsed.ok) problems.push(parsed.error);
else {
  problems.push(...checkAgainstSchema(parsed.data, __SCHEMA_ARTICLE__).map((p) => 'SCHEMA: ' + p));
  result = validateArticle(parsed.data, { ...ctx, article_id: claim.article_id }, rag.allowed_internal_links.map((l) => l.url), ctx.config);
  problems.push(...result.errors);
}
const correctionUsed = $('Build Article Correction Request').isExecuted;
let outcome = 'VALID';
if (problems.length) {
  if (!correctionUsed && parsed.errorType !== 'BLOCKED') outcome = 'RETRY';
  else if (result && result.usable) outcome = 'USABLE_INVALID';
  else outcome = 'FAILED';
}
return [{ json: {
  outcome,
  origin: 'INITIAL',
  article: result && result.usable ? result.article : null,
  structure_errors: problems,
  structure_warnings: result ? result.warnings : [],
  raw_text: parsed.text || '',
  error_class: outcome === 'FAILED' ? 'API_TRANSIENT' : undefined,
  retryable: outcome === 'FAILED' ? true : undefined,
  error: outcome === 'FAILED' ? `INVALID_STRUCTURED_OUTPUT (article writer, after one correction): ${problems.slice(0, 8).join('; ')}` : undefined,
} }];
