// @mode each
// @lib common
// Rebuilds the Article_Log and Keywords rows from PostgreSQL for an article
// whose state is final but whose sheet rows were never updated. Nothing is
// regenerated and nothing is written to Google Docs.
const j = $json;
const job = j.job || {};
const rc = j.runtime_config;
const tz = rc.timezone || 'Asia/Kolkata';
const now = nowLocal(tz);
const ap = job.approval_payload || job.approval_candidate || {};
const a = ap.article || {};
const e = ap.editorial || job.editorial_report || null;
const p = ap.plagiarism || job.plagiarism_summary || null;
const approved = job.status === 'APPROVED';
const fmt = (iso) => iso ? DateTime.fromISO(String(iso)).setZone(tz).toFormat('yyyy-MM-dd HH:mm:ss') : now;
const eeta = e ? { overall_status: e.overall_status, checks: (e.individual_checks || []).map((x) => x.check + ': ' + x.status),
  unsupported_claims: (e.unsupported_claims || []).length, note: 'Internal E-E-A-T-oriented editorial assessment; not a Google score or certification.', reconciled_by: 'Error Recovery' }
  : { overall_status: 'NOT_EVALUATED', reconciled_by: 'Error Recovery' };
const aiReview = !!(p && p.provider === 'gemini_originality_review');
const plagStatus = aiReview ? (p.result_label || 'AI_REVIEW_ONLY')
  : (!p ? 'NOT_CHECKED' : (p.status === 'COMPLETED' ? (p.passed === false ? 'FAIL' : 'PASS') : (p.status || 'UNKNOWN')));
const docLinked = approved || !!job.doc_verified_at;
const articleLog = {
  Article_ID: job.article_id, Keyword_ID: job.keyword_id, Target_Page_URL: job.target_page_url, Primary_Keyword: job.primary_keyword,
  Article_Title: a.Article_Title || '', SEO_Title: a.SEO_Title || '', Meta_Description: a.Meta_Description || '', URL_Slug: a.URL_Slug || '',
  Quality_Status: job.quality_status || (e ? e.overall_status : 'NOT_EVALUATED'), EETA_Report: JSON.stringify(eeta).slice(0, 45000),
  Plagiarism_Percent: !aiReview && p && p.plag_percent !== undefined && p.plag_percent !== null ? p.plag_percent : '', Plagiarism_Status: plagStatus,
  Plagiarism_Report_URL: !aiReview && p ? (p.report_reference || '') : '', Attempts: job.attempts || 0,
  Google_Doc_ID: docLinked ? (job.google_doc_id || '') : '', Google_Doc_URL: docLinked ? (job.google_doc_url || '') : '',
  Status: job.status, Error: approved ? '' : truncate(job.last_error || '', 2000), Created_At: fmt(job.created_at), Updated_At: now,
  _spreadsheet_id: rc.spreadsheet_id, _sheet: rc.sheets.article_log,
};
const keywordsRow = { Keyword_ID: job.keyword_id, Status: job.status, Processed_At: now, Last_Error: approved ? '' : truncate(job.last_error || '', 1500),
  _spreadsheet_id: rc.spreadsheet_id, _sheet: rc.sheets.keywords };
return { json: { article_log_row: articleLog, keywords_row: keywordsRow, article_id: job.article_id, keyword_id: job.keyword_id, owner: 'recovery-' + String($execution.id) } };
