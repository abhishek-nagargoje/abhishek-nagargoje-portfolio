// @mode each
const prep = $('Build Reconciliation Rows').item.json;
return { json: Object.assign({}, prep.keywords_row, { _article_log_ok: !$json.error }) };
