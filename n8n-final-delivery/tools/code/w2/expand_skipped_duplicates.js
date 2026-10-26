// @mode all
// @lib common
// Rows that map to an already-approved or already-claimed article are
// marked SKIPPED_DUPLICATE (matched on their own Keyword_ID).
const j = $input.first().json;
const tz = (j.ctx && j.ctx.config && j.ctx.config.timezone) || 'Asia/Kolkata';
return (j.skipped || []).filter((s) => s.sheet_action === 'SKIPPED_DUPLICATE' && s.keyword_id).map((s) => ({
  json: {
    Keyword_ID: s.keyword_id, Status: 'SKIPPED_DUPLICATE', Processed_At: nowLocal(tz),
    Last_Error: s.reason === 'ALREADY_APPROVED'
      ? 'Duplicate: this URL + keyword was already approved as ' + s.article_id + (s.google_doc_url ? ' (' + s.google_doc_url + ')' : '')
      : 'Duplicate: same Target_Page_URL + Primary_Keyword as Keyword_ID ' + s.existing_keyword_id + ' (' + s.article_id + ', ' + s.existing_status + ')',
  },
  pairedItem: { item: 0 },
}));
