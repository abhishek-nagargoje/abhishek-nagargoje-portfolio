// @include common, article, docs
// Only reached when the SAME attempt passed editorial AND plagiarism checks.
// Builds the formatted section (requests are built later, once the insertion
// index is known) and the completeness data used to verify the write.
const ctx = $('Keyword Context').first(0).json;
const claim = $('Claim Keyword Record').first(0).json;
const att = $('Prepare Attempt').first(0).json;
const ed = $('Check Editorial Conditions').first(0).json;
const pl = $('Evaluate Plagiarism Result').first(0).json;
if (ed.attempt_no !== att.attempt_no || pl.attempt_no !== att.attempt_no || !ed.editorial_pass || pl.plagiarism_status !== 'PASS') {
  throw new Error('INTERNAL: approval gate violated - editorial and plagiarism results do not both belong to this passing attempt');
}
const article = att.article;
const meta = {
  generation_date: DateTime.now().setZone(ctx.config.TIMEZONE).toFormat('yyyy-LL-dd HH:mm ZZZZ'),
  quality_status: `PASS (attempt ${att.local_attempt} of ${att.max_attempts})`,
  plagiarism_result: `PASS - ${pl.plagiarism_percent}% reported similarity (policy ≤ ${ctx.config.PLAGIARISM_THRESHOLD_PERCENT}%, ${ctx.config.PLAGIARISM_PROVIDER})`,
  plagiarism_report_ref: pl.plagiarism_report_ref,
};
const paragraphs = buildArticleParagraphs(article, meta);
const bodyParas = markdownToParagraphs(article.Article_Markdown);
if (bodyParas.length < 3) throw new Error('INTERNAL: formatted article body is unexpectedly short; refusing to write');
const marker = DOC_MARKER_PREFIX + claim.article_id;
const tail = paragraphs[paragraphs.length - 1].text;
return [{ json: {
  marker,
  paragraphs,
  expected_chars: paragraphs.reduce((s, p) => s + p.text.length + 1, 0),
  tail_text: tail.slice(-200),
  body_paragraphs: bodyParas.length,
  doc_url: `https://docs.google.com/document/d/${ctx.config.MASTER_DOC_ID}/edit`,
} }];
