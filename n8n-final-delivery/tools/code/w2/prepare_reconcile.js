// @mode each
// @lib common
// RECONCILE: the article is already verified in Google Docs; only the
// sheet updates are missing. Nothing is regenerated or re-appended.
const ctx = $json.ctx;
const ap = ctx.job.approval_payload || {};
ctx.article = ap.article || { Article_ID: ctx.job.article_id, Keyword_ID: ctx.keyword.Keyword_ID, Target_Page_URL: ctx.keyword.Target_Page_URL, Primary_Keyword: ctx.keyword.Primary_Keyword };
ctx.editorial = ap.editorial || ctx.job.editorial_report || null;
ctx.plagiarism = ap.plagiarism || ctx.job.plagiarism_summary || null;
ctx.attempt = ap.attempts || ctx.job.attempts;
ctx.doc = { doc_id: ctx.job.google_doc_id, url: ctx.job.google_doc_url, warnings: [] };
ctx.final = { status: 'APPROVED', stage: 'RECONCILED', reason: '', quality_status: 'PASS', reconciled: true };
return { json: { ctx, lease_ok: true } };
