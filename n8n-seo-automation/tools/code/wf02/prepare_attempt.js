// Loop merge point: every article version (initial or revised) passes here and
// becomes a numbered attempt. Attempt numbers continue across re-claims
// (base = attempts already stored for this article), but MAX_ARTICLE_ATTEMPTS
// is enforced per processing run via local_attempt.
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const cfg = ctx.config;
const inp = $input.first().json;
const base = Number(claim.attempt_count || 0);
let attemptNo;
let article = inp.article;
let structureErrors = inp.structure_errors || [];
let corrections = null;
if (inp.origin === 'REVISION') {
  const brief = $('Build Article Revision Brief').first(0).json;
  attemptNo = brief.next_attempt_no;
  corrections = inp.revision_corrections || null;
  if (!article) {
    // The reviser returned nothing usable: keep evaluating the previous version
    // (so the loop stays well-defined) and record why this attempt failed.
    article = brief.current_article;
    structureErrors = ['REVISION_OUTPUT_UNUSABLE: the revision response could not be used; previous version re-evaluated', ...structureErrors];
  }
} else {
  attemptNo = base + 1;
}
if (!article || !article.Article_Markdown) throw new Error('INTERNAL: no article available for attempt ' + attemptNo);
return [{ json: {
  attempt_no: attemptNo,
  local_attempt: attemptNo - base,
  max_attempts: cfg.MAX_ARTICLE_ATTEMPTS,
  origin: inp.origin === 'REVISION' ? 'REVISION' : 'INITIAL',
  article,
  structure_errors: structureErrors,
  structure_valid: structureErrors.length === 0,
  structure_warnings: inp.structure_warnings || [],
  revision_corrections: corrections,
} }];
