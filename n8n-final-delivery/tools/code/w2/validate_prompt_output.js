// @mode each
// @lib common
// Validates Gemini Call 1. One bounded corrective retry, then fail safely.
const ctx = $('Gemini Call 1 Request').item.json.ctx;
const g = readGemini($json);
const problems = [];
let parsed = null;
if (g.ok) {
  const j = extractJson(g.text);
  if (!j.ok) problems.push(j.error);
  else parsed = j.value;
} else if (['PERMANENT', 'TRANSIENT', 'API_ERROR'].includes(g.kind)) {
  setOutcome(ctx, 'ERROR', 'PROMPT_CREATION', g.error, g.kind === 'TRANSIENT');
  return { json: { ctx, route: 'FAIL' } };
} else {
  problems.push(g.error);
}
if (parsed) {
  const s = (v) => typeof v === 'string' && v.trim().length > 0;
  ['article_objective', 'unique_angle', 'target_reader', 'search_intent', 'writing_prompt'].forEach((f) => { if (!s(parsed[f])) problems.push('missing or empty "' + f + '"'); });
  if (s(parsed.writing_prompt) && parsed.writing_prompt.trim().length < 400) problems.push('"writing_prompt" is shorter than 400 characters');
  if (!Array.isArray(parsed.outline) || parsed.outline.length < 3 || !parsed.outline.every((o) => o && s(o.h2))) problems.push('"outline" must contain at least 3 sections, each with an "h2"');
  if (!Array.isArray(parsed.forbidden_claims)) problems.push('"forbidden_claims" must be an array');
  if (!Array.isArray(parsed.verified_facts_to_use)) problems.push('"verified_facts_to_use" must be an array');
  if (!parsed.seo_metadata_requirements || typeof parsed.seo_metadata_requirements !== 'object') problems.push('"seo_metadata_requirements" must be an object');
  if (!Array.isArray(parsed.internal_linking_instructions)) problems.push('"internal_linking_instructions" must be an array');
}
if (problems.length) {
  if (ctx.gemini.retries < 1) {
    ctx.gemini.request = correctiveRequest(ctx.gemini.request, g.text, problems);
    ctx.gemini.retries += 1;
    return { json: { ctx, route: 'RETRY' } };
  }
  setOutcome(ctx, 'REVIEW_REQUIRED', 'PROMPT_CREATION', 'Gemini prompt-creation output was invalid after one corrective retry: ' + problems.join('; '), false);
  return { json: { ctx, route: 'FAIL' } };
}
// Keep only verified facts / links that really came from the inputs.
const known = new Set(ctx.rag.knowledge_ids);
const dropped = [];
parsed.verified_facts_to_use = parsed.verified_facts_to_use.filter((f) => { const keep = f && known.has(asText(f.knowledge_id)); if (!keep) dropped.push('fact ' + asText(f && f.knowledge_id)); return keep; });
const verified = new Set(ctx.links.verified_internal.map((l) => l.url));
parsed.internal_linking_instructions = parsed.internal_linking_instructions.filter((l) => { const keep = l && verified.has(normalizeUrl(l.url)); if (!keep) dropped.push('link ' + asText(l && l.url)); return keep; });
ctx.prompt = parsed;
ctx.prompt_meta = { model: ctx.models.text_model, corrective_retries: ctx.gemini.retries, dropped_unverified: dropped, usage: g.usage };
ctx.gemini = null;
ctx.progress_status = 'PROMPT_CREATED';
return { json: { ctx, route: 'VALID' } };
