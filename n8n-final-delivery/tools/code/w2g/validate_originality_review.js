// @mode each
// @lib common
// Validates the Gemini Originality Review JSON. One bounded corrective retry,
// then fail safely. Rejects invented percentages and claims of web/database scans.
const ctx = $('Originality Review Request').item.json.ctx;
const g = readGemini($json);
const problems = [];
let r = null;
if (g.ok) { const j = extractJson(g.text); if (!j.ok) problems.push(j.error); else r = j.value; }
else if (['PERMANENT', 'TRANSIENT', 'API_ERROR'].includes(g.kind)) {
  ctx.plagiarism.status = 'FAILED'; ctx.plagiarism.error = g.error;
  setOutcome(ctx, 'ERROR', 'ORIGINALITY_REVIEW', g.error, g.kind === 'TRANSIENT');
  return { json: { ctx, route: 'FAIL' } };
} else problems.push(g.error);
const CATS = ['repetition', 'copied_looking', 'similar_to_target_page', 'similar_to_source_material', 'unsupported_claim', 'missing_attribution', 'low_original_value'];
if (r && typeof r === 'object' && !Array.isArray(r)) {
  r.status = asText(r.status).toUpperCase();
  if (!['PASS', 'FAIL', 'REVIEW_REQUIRED'].includes(r.status)) problems.push('status must be PASS, FAIL or REVIEW_REQUIRED');
  if (typeof r.review_notes !== 'string' || !r.review_notes.trim()) problems.push('review_notes must be a non-empty string');
  ['flagged_phrases', 'suggested_rewrites', 'sources_compared', 'limitations'].forEach((f) => { if (!Array.isArray(r[f])) problems.push('"' + f + '" must be an array'); });
  // Only the reviewer's own wording is checked (quoted article text may legitimately contain percentages).
  const text = JSON.stringify({ n: r.review_notes, l: r.limitations, s: r.sources_compared, f: (r.flagged_phrases || []).map((x) => x && x.reason) });
  const SIM = '(plagiari\\w*|similar\\w*|original\\w*|unique\\w*|copied|overlap\\w*|match\\w*)';
  if (new RegExp(SIM + '[^.]{0,40}\\d+(\\.\\d+)?\\s*(%|percent)|\\d+(\\.\\d+)?\\s*(%|percent)[^.]{0,40}' + SIM, 'i').test(text) ||
      /\b(plagiarism|similarity|originality|uniqueness)\s*(score|rate|percentage)\b/i.test(text) ||
      ['plagiarism_percent', 'similarity_percent', 'originality_score', 'score', 'percentage'].some((k) => k in r)) {
    problems.push('do not output any plagiarism, similarity or originality percentage or score');
  }
  if (/\b(scanned|searched|checked|compared (it )?(against|with))\s+(the\s+)?(entire\s+|whole\s+)?(internet|web|online sources|plagiarism database|external databases?)/i.test(text)) problems.push('do not claim to have searched the internet or plagiarism databases; only the supplied source material was compared');
} else if (!problems.length) problems.push('model output is not a JSON object');
if (problems.length) {
  if (ctx.gemini.retries < 1) {
    ctx.gemini.request = correctiveRequest(ctx.gemini.request, g.text, problems);
    ctx.gemini.retries += 1;
    return { json: { ctx, route: 'RETRY' } };
  }
  ctx.plagiarism.status = 'FAILED';
  ctx.plagiarism.error = 'Gemini originality review output invalid after one corrective retry: ' + problems.join('; ');
  setOutcome(ctx, 'REVIEW_REQUIRED', 'ORIGINALITY_REVIEW', ctx.plagiarism.error, false);
  return { json: { ctx, route: 'FAIL' } };
}
const FIXED_LIMITS = [
  'AI review only: Gemini compared the article with the target page text and the retrieved brand knowledge records supplied by this workflow.',
  'No internet search and no external plagiarism database were used; no plagiarism percentage exists for this article.',
  'A passing AI review is not a verified plagiarism check; human review is required before publication.',
];
if (ctx.page.main_text_truncated) FIXED_LIMITS.push('Only the first ' + ctx.config.originality_page_excerpt_chars + ' characters of the target page text were available for comparison.');
ctx.originality_raw = {
  status: r.status,
  review_notes: truncate(r.review_notes, 3000),
  flagged_phrases: r.flagged_phrases.slice(0, 40).map((f) => ({ text: truncate(f && f.text, 600), category: CATS.includes(asText(f && f.category)) ? asText(f.category) : 'copied_looking',
    reason: truncate(f && f.reason, 400), compared_with: truncate(f && f.compared_with, 200) })).filter((f) => f.text),
  suggested_rewrites: r.suggested_rewrites.slice(0, 40).map((s) => ({ original: truncate(s && s.original, 600), rewrite: truncate(s && s.rewrite, 1200), reason: truncate(s && s.reason, 400) })),
  sources_compared: r.sources_compared.slice(0, 40).map((s) => ({ source: truncate(s && s.source, 60), identifier: truncate(s && s.identifier, 300), notes: truncate(s && s.notes, 400) })),
  limitations: FIXED_LIMITS.concat(r.limitations.map((l) => truncate(l, 400)).filter(Boolean).slice(0, 10)),
};
ctx.gemini = null;
return { json: { ctx, route: 'VALID' } };
