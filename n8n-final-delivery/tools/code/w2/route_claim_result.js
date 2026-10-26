// @mode each
// @lib common
const ctx = $json.ctx;
const job = $json.job || null;
ctx.claim = { outcome: $json.outcome, message: $json.message, skipped: $json.skipped || [] };
// Never pass the candidate list further down the line.
delete ctx.candidates;
if (job) {
  const kin = job.keyword_input || {};
  ctx.keyword = {
    Keyword_ID: job.keyword_id, Target_Page_URL: job.target_page_url, Primary_Keyword: job.primary_keyword,
    Supporting_Keywords: kin.Supporting_Keywords || [], Search_Intent: kin.Search_Intent || 'informational',
    Target_Audience: kin.Target_Audience || '', Target_Location: kin.Target_Location || 'India',
    Language: kin.Language || 'English', Priority: kin.Priority || '', row_number: job.sheet_row_number,
  };
  ctx.job = {
    article_id: job.article_id, run_no: job.run_no, mode: $json.outcome, marker: job.doc_marker,
    ledger_status: job.ledger_status || null, created_at: job.created_at, attempts: job.attempts,
    google_doc_id: job.google_doc_id || null, google_doc_url: job.google_doc_url || null,
    approval_payload: job.approval_payload || null, quality_status: job.quality_status || null,
    plagiarism_summary: job.plagiarism_summary || null, editorial_report: job.editorial_report || null,
  };
}
return { json: { ctx, mode: $json.outcome } };
