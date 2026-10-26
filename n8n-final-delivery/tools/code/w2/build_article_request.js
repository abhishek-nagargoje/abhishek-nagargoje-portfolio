// @mode each
// @lib common,prompts
// Gemini Call 2: write the complete article from the generated prompt.
assertLease($json, 'Build Article Request');
const ctx = $json.ctx;
ctx.attempt = 1;
ctx.article_kind = 'INITIAL';
const user = [
  'WRITING_PROMPT (generated for this article):\n' + ctx.prompt.writing_prompt,
  'BRIEF: ' + JSON.stringify({ objective: ctx.prompt.article_objective, unique_angle: ctx.prompt.unique_angle, target_reader: ctx.prompt.target_reader,
    search_intent: ctx.prompt.search_intent, differentiation: ctx.prompt.differentiation_from_target_page, outline: ctx.prompt.outline,
    forbidden_claims: ctx.prompt.forbidden_claims, citations: ctx.prompt.source_and_citation_requirements,
    internal_linking: ctx.prompt.internal_linking_instructions, structure: ctx.prompt.article_structure_requirements,
    seo: ctx.prompt.seo_metadata_requirements, word_range: ctx.prompt.target_word_range }),
  writerContext(ctx),
  'Write the complete article now.',
].join('\n\n');
ctx.gemini = { call: 'ARTICLE', retries: 0, request: geminiRequest(writerSystem(ctx), user, { temperature: 0.6, maxOutputTokens: ctx.models.text_output_token_limit }) };
return { json: { ctx } };
