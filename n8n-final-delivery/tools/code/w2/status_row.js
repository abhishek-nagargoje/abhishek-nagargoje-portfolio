// @mode each
// @lib common
// Inline progress update (runs in the main path, so a progress write can
// never overwrite a later final status). The Sheets node writes only the
// existing Keywords headers; the "_pass" field (the full item) is ignored by
// the Sheets node ("Ignore extra data") and restored by the next node.
const ctx = $json.ctx;
const row = { Keyword_ID: ctx.keyword.Keyword_ID, Status: ctx.progress_status };
if (ctx.progress_status === 'PROCESSING') {
  row.Processing_Started_At = ctx.run.started_at_local;
  row.Processed_At = '';
  row.Last_Error = '';
}
if (ctx.progress_status === 'REVISION_REQUIRED') {
  row.Last_Error = 'Attempt ' + (ctx.attempt - 1) + ' failed checks; revising (attempt ' + ctx.attempt + ' of ' + ctx.config.max_attempts + ').';
}
row._pass = $json;
return { json: row };
