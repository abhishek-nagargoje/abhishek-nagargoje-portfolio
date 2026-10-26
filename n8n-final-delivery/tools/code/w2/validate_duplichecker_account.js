// @mode each
// @lib common
// Documented account-status call: POST https://www.duplichecker.com/api/info
// (token supplied by the "DupliChecker API" Custom Auth credential).
const ctx = $('Resolve Gemini Models').item.json.ctx;
const fail = httpFailure($json);
if (fail) throw new Error('DupliChecker account check could not reach the API: ' + fail.message);
const status = Number($json.statusCode);
let body = $json.body;
if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* keep text */ } }
const text = typeof body === 'string' ? body : JSON.stringify(body || {});
const hint = ' Check the "DupliChecker API" credential (Custom Auth JSON {"body":{"token":"<your API token>"}}). See documentation/IMPORT_AND_SETUP.md, section DupliChecker.';
if (status === 401 || status === 403 || /invalid[^"]{0,20}token|token[^"]{0,30}(invalid|required|missing)|unauthori[sz]ed/i.test(text)) {
  throw new Error('CONFIG_ERROR: DupliChecker rejected the API token (HTTP ' + status + ').' + hint);
}
if (status === 402 || /plan[^"]{0,20}expired|subscription[^"]{0,20}expired/i.test(text)) {
  throw new Error('CONFIG_ERROR: DupliChecker reports that the plan has expired (HTTP ' + status + ').');
}
if (status === 429) throw new Error('DupliChecker rate limit reached during the account check (HTTP 429). Try again later.');
if (status < 200 || status >= 300 || !body || typeof body !== 'object') {
  throw new Error('CONFIG_ERROR: unexpected DupliChecker account response (HTTP ' + status + '): ' + truncate(redact(text), 300) + hint);
}
const src = (body.data && typeof body.data === 'object') ? body.data : body;
const pick = (...keys) => { for (const k of keys) { if (src[k] !== undefined && src[k] !== null && src[k] !== '') return src[k]; } return undefined; };
const total = Number(pick('total_words', 'totalWords', 'total words', 'words_total'));
const used = Number(pick('used_words', 'usedWords', 'used words', 'words_used'));
const accStatus = asText(pick('status', 'account_status', 'accountStatus'));
const remaining = Number.isFinite(total) && Number.isFinite(used) ? total - used : null;
if (accStatus && /inactive|expired|suspend|blocked|disabled/i.test(accStatus)) {
  throw new Error('CONFIG_ERROR: DupliChecker account status is "' + accStatus + '"');
}
if (remaining !== null && remaining < ctx.config.plagiarism_min_account_words) {
  throw new Error('CONFIG_ERROR: DupliChecker account has only ' + remaining + ' words remaining; at least ' +
    ctx.config.plagiarism_min_account_words + ' are required (up to ' + ctx.config.max_attempts + ' checks per article).');
}
ctx.duplichecker_account = {
  http_status: status, account_status: accStatus || 'not reported', total_words: Number.isFinite(total) ? total : null,
  used_words: Number.isFinite(used) ? used : null, remaining_words: remaining,
  recognised_fields: remaining !== null || !!accStatus,
};
return { json: { ctx } };
