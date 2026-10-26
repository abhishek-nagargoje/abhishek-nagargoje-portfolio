// @mode each
// Extra "_" fields are ignored by the Sheets node ("Ignore extra data").
const prep = $('Prepare Sheet Updates').item.json;
return { json: Object.assign({}, prep.keywords_row, { _article_log_ok: !$json.error, _article_log_error: $json.error ? String($json.error.message || $json.error) : '' }) };
