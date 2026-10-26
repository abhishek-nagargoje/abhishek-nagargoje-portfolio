// @mode each
// @lib common
const ctx = $('Prepare Sheet Updates').item.json.ctx;
const sync = $('Keywords Final Row').item.json;
const kwOk = !$('Update Keywords Status').item.json.error;
const f = ctx.final;
return { json: {
  status: f.status, article_id: ctx.job.article_id, keyword_id: ctx.keyword.Keyword_ID, primary_keyword: ctx.keyword.Primary_Keyword,
  attempts: ctx.attempt || 0, google_doc_url: f.status === 'APPROVED' && ctx.doc ? ctx.doc.url : null,
  reason: f.reason || null, stage: f.stage, history: ctx.history || [],
  editorial: ctx.editorial ? ctx.editorial.overall_status : 'NOT_EVALUATED',
  plagiarism: ctx.plagiarism ? { status: ctx.plagiarism.status, percent: ctx.plagiarism.plag_percent ?? null } : null,
  model: ctx.models ? ctx.models.text_model : null,
  sheets: { article_log_updated: sync._article_log_ok, keywords_updated: kwOk,
    note: sync._article_log_ok && kwOk ? 'Google Sheets updated' : 'A Google Sheets update failed; the database keeps the result and "HR Remedy India - Error Recovery" (recovery sweep) will reconcile it without regenerating.' },
  warnings: ctx.doc && ctx.doc.warnings ? ctx.doc.warnings : [],
  lease_released: $json.lease_ok !== false,
} };
