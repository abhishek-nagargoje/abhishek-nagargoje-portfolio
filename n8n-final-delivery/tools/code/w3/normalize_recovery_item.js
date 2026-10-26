// @mode each
// @lib common
// Common shape for Error Trigger results and sweep rows.
const j = $json;
const action = asText(j.action);
let route = 'NONE';
if (action === 'SYNC_SHEETS') route = 'SYNC_SHEETS';
else if (action === 'RETRY' || action === 'MARK_ERROR') route = 'KEYWORD_STATUS';
else if (action === 'REPOLL_PLAGIARISM') route = 'REPOLL';
const rc = j.runtime_config || null;
if (route !== 'NONE' && (!rc || !rc.spreadsheet_id)) {
  throw new Error('CONFIG_ERROR: runtime configuration not found in PostgreSQL (seo_settings.runtime_config). Run "HR Remedy India - SEO Article Automation" once so recovery knows the spreadsheet.');
}
return { json: {
  route, action: action || 'NONE', article_id: j.article_id || null, keyword_id: j.keyword_id || null,
  sheet_status: j.sheet_status || null, sheet_last_error: j.sheet_last_error || '', job: j.job || null,
  plagiarism: j.plagiarism || null, runtime_config: rc, error_id: j.error_id || null,
} };
