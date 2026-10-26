// @mode each
// @lib common
// Builds the Article_Log row (upserted on Article_ID, so retries never add a
// duplicate row) and the final Keywords row. Uses the exact existing headers.
assertLease($json, 'Prepare Sheet Updates');
const ctx = $json.ctx;
const c = ctx.config;
if (!ctx.final) ctx.final = { status: 'APPROVED', stage: 'PUBLISHED', reason: '', quality_status: 'PASS' };
const f = ctx.final;
const a = ctx.article || {};
const e = ctx.editorial;
const p = ctx.plagiarism;
const now = nowLocal(c.timezone);
const eeta = e ? {
  overall_status: e.overall_status, attempt: ctx.attempt,
  checks: (e.individual_checks || []).map((x) => x.check + ': ' + x.status),
  deterministic_failures: (e.deterministic_checks || []).filter((d) => !d.passed).map((d) => d.check),
  failed_conditions: (e.failed_conditions || []).slice(0, 15),
  unsupported_claims: (e.unsupported_claims || []).slice(0, 10).map((u) => (u.severity ? u.severity + ': ' : '') + u.claim),
  history: (ctx.history || []).map((h) => ({ attempt: h.attempt, editorial: h.editorial, plagiarism: h.plagiarism_status, plag_percent: h.plagiarism_percent, decision: h.decision })),
  note: 'Internal E-E-A-T-oriented editorial assessment; not a Google score or certification.',
} : { overall_status: 'NOT_EVALUATED', note: 'Article was not evaluated: ' + (f.reason || '') };
let eetaText = JSON.stringify(eeta);
if (eetaText.length > 45000) eetaText = eetaText.slice(0, 45000) + '…';
const plagStatus = !p ? 'NOT_CHECKED' : (p.status === 'COMPLETED' ? (p.passed === false ? 'FAIL' : (p.result_label || 'PASS')) : p.status);
const articleLog = {
  Article_ID: ctx.job.article_id, Keyword_ID: ctx.keyword.Keyword_ID, Target_Page_URL: ctx.keyword.Target_Page_URL,
  Primary_Keyword: ctx.keyword.Primary_Keyword, Article_Title: a.Article_Title || '', SEO_Title: a.SEO_Title || '',
  Meta_Description: a.Meta_Description || '', URL_Slug: a.URL_Slug || '', Quality_Status: f.quality_status || (e ? e.overall_status : 'NOT_EVALUATED'),
  EETA_Report: eetaText,
  Plagiarism_Percent: p && p.plag_percent !== undefined && p.plag_percent !== null ? p.plag_percent : '',
  Plagiarism_Status: plagStatus,
  Plagiarism_Report_URL: p ? (p.report_reference || '') : '',
  Attempts: ctx.attempt || 0,
  Google_Doc_ID: f.status === 'APPROVED' && ctx.doc ? (ctx.doc.doc_id || '') : '',
  Google_Doc_URL: f.status === 'APPROVED' && ctx.doc ? (ctx.doc.url || '') : '',
  Status: f.status,
  Error: f.status === 'APPROVED' ? ((ctx.doc && ctx.doc.warnings && ctx.doc.warnings.length) ? 'Warnings: ' + ctx.doc.warnings.join(' | ') : '') : truncate('[' + f.stage + '] ' + f.reason, 2000),
  Created_At: ctx.job.created_at ? DateTime.fromISO(String(ctx.job.created_at)).setZone(c.timezone).toFormat('yyyy-MM-dd HH:mm:ss') : now,
  Updated_At: now,
};
const keywordsRow = {
  Keyword_ID: ctx.keyword.Keyword_ID, Status: f.status, Processed_At: now,
  Last_Error: f.status === 'APPROVED' ? '' : truncate('[' + f.stage + '] ' + f.reason, 1500),
};
return { json: { ctx, article_log_row: articleLog, keywords_row: keywordsRow } };
