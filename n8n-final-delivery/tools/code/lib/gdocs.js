// ---- Google Docs response helpers ----
function docsStatus(json) {
  const fail = httpFailure(json);
  if (fail) return { ok: false, status: 0, transient: isTransientCode(fail.code, fail.message), error: fail.message };
  const status = Number(json.statusCode || 0);
  let body = json.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* keep */ } }
  const msg = body && body.error ? asText(body.error.message || JSON.stringify(body.error)) : '';
  return { ok: status >= 200 && status < 300 && body && typeof body === 'object', status, body, error: msg ? 'HTTP ' + status + ': ' + msg : 'HTTP ' + status, transient: status === 429 || status >= 500 };
}
function docsPermissionError(st, action) {
  if (st.status === 401) return 'CONFIG_ERROR: Google Docs credential is not authorised (HTTP 401) while trying to ' + action + '. Reconnect the "Google Docs account" credential in n8n.';
  if (st.status === 403) return 'CONFIG_ERROR: Google Docs credential lacks permission to ' + action + ' (HTTP 403: ' + st.error + '). The credential needs the https://www.googleapis.com/auth/documents scope (n8n\'s Google Docs OAuth2 credential requests documents + drive.file) and access to the document.';
  return '';
}
function docText(doc) {
  let out = '';
  const walk = (content) => (content || []).forEach((el) => {
    if (el.paragraph) (el.paragraph.elements || []).forEach((pe) => { if (pe.textRun && pe.textRun.content) out += pe.textRun.content; });
    if (el.table) (el.table.tableRows || []).forEach((r) => (r.tableCells || []).forEach((cell) => walk(cell.content)));
    if (el.tableOfContents) walk(el.tableOfContents.content);
  });
  walk(doc && doc.body && doc.body.content);
  return out;
}
function docEndIndex(doc) {
  const content = (doc && doc.body && doc.body.content) || [];
  const last = content[content.length - 1];
  return last && last.endIndex ? last.endIndex : 1;
}
function countOccurrences(hay, needle) { let n = 0; let i = hay.indexOf(needle); while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); } return n; }
