// @mode each
// @lib common
// Keywords row for a released job (READY = bounded automatic retry,
// ERROR = permanent or retry limit reached) or a recovered plagiarism report.
const j = $json;
const rc = j.runtime_config;
const tz = rc.timezone || 'Asia/Kolkata';
return { json: {
  Keyword_ID: j.keyword_id, Status: j.sheet_status, Processed_At: nowLocal(tz), Last_Error: truncate(j.sheet_last_error || '', 1500),
  _spreadsheet_id: rc.spreadsheet_id, _sheet: rc.sheets.keywords, _article_id: j.article_id, _action: j.action,
} };
