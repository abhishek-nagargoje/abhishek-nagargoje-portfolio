// @mode each
// @lib common,prompts
// Gemini Article Reviser: fixes the specific failures of the previous attempt.
assertLease($json, 'Build Revision Request');
const ctx = $json.ctx;
const prev = ctx.article;
const e = ctx.editorial;
const p = ctx.plagiarism;
ctx.attempt += 1;
ctx.article_kind = 'REVISION';
ctx.progress_status = 'REVISION_REQUIRED';
const findings = {
  previous_attempt: ctx.attempt - 1,
  max_attempts: ctx.config.max_attempts,
  editorial_evaluation: { overall_status: e.overall_status, individual_checks: e.individual_checks, deterministic_checks: e.deterministic_checks.filter((d) => !d.passed) },
  failed_conditions: e.failed_conditions,
  unsupported_claims: e.unsupported_claims,
  required_corrections: e.required_corrections,
  plagiarism_report: { status: p.status, plag_percent: p.plag_percent, unique_percent: p.unique_percent, rephrased_percent: p.rephrased_percent,
    exact_percent: p.exact_percent, threshold_percent: p.threshold_percent, policy_failures: p.reasons },
  matched_passages: (p.matches || []).slice(0, 25).map((m) => ({ text: m.text, sources: m.sources.map((s) => s.url).filter(Boolean).slice(0, 3) })),
  automated_findings: ctx.article_integrity,
};
const system = writerSystem(ctx) + '\n\nYOU ARE NOW REVISING AN EXISTING DRAFT. Correct the specific problems listed in REVIEW_FINDINGS:\n' +
  '- Remove every unsupported claim, or rewrite it so it is supported by VERIFIED_BRAND_FACTS.\n' +
  '- Fix attribution: cite only real sources; remove sources you cannot stand behind.\n' +
  '- Add the missing explanations requested by the editor.\n' +
  '- Rewrite every matched passage with a genuinely original explanation and structure. Swapping synonyms or reordering words is NOT acceptable.\n' +
  '- Keep the parts that passed review; do not introduce new unverified facts.\n' +
  'Return the COMPLETE revised article (not a diff) as one JSON object matching ARTICLE_OUTPUT_SCHEMA.';
const user = [
  'ORIGINAL_WRITING_PROMPT:\n' + ctx.prompt.writing_prompt,
  'BRIEF_FORBIDDEN_CLAIMS: ' + JSON.stringify(ctx.prompt.forbidden_claims || []),
  writerContext(ctx),
  'CURRENT_ARTICLE (attempt ' + (ctx.attempt - 1) + '): ' + JSON.stringify({ Article_Title: prev.Article_Title, SEO_Title: prev.SEO_Title, H1: prev.H1,
    Meta_Description: prev.Meta_Description, URL_Slug: prev.URL_Slug, Excerpt: prev.Excerpt, Article_Markdown: prev.Article_Markdown, FAQs: prev.FAQs,
    Internal_Link_Suggestions: prev.Internal_Link_Suggestions, External_Sources: prev.External_Sources, Verified_Brand_Facts_Used: prev.Verified_Brand_Facts_Used }),
  '<review_findings>' + JSON.stringify(findings) + '</review_findings>',
  'This is attempt ' + ctx.attempt + ' of ' + ctx.config.max_attempts + '. Produce the corrected complete article now.',
].join('\n\n');
ctx.gemini = { call: 'REVISION', retries: 0, request: geminiRequest(system, user, { temperature: 0.5, maxOutputTokens: ctx.models.text_output_token_limit }) };
return { json: { ctx } };
