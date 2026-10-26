// ---- shared helpers (inlined into Code nodes by tools/build_workflows.js) ----
function asText(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function redact(s) {
  return asText(s)
    .replace(/(\b(?:key|token|api_key|apikey)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/("?(?:token|apiKey|api_key|authorization)"?\s*[:=]\s*"?)[A-Za-z0-9._\-]{8,}/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED]');
}
function truncate(s, n) { s = asText(s); return s.length > n ? s.slice(0, n) + ' …[truncated]' : s; }
function nowLocal(tz) { return DateTime.now().setZone(tz || 'Asia/Kolkata').toFormat('yyyy-MM-dd HH:mm:ss'); }
function parseUrl(u) {
  const m = /^(https?):\/\/([^\/?#:@\s]+)(?::(\d+))?([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(asText(u));
  if (!m) return null;
  return { protocol: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] || '', path: m[4] || '/', query: m[5] || '', hash: m[6] || '' };
}
function hostAllowed(host, domains) {
  host = asText(host).toLowerCase();
  return (domains || []).some((d) => { d = asText(d).toLowerCase(); return host === d || host.endsWith('.' + d); });
}
function normalizeUrl(u) {
  const p = parseUrl(u);
  if (!p) return '';
  let path = p.path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return p.protocol + '://' + p.host + (p.port ? ':' + p.port : '') + (path || '/') + p.query;
}
function resolveUrl(href, base) {
  href = asText(href).replace(/&amp;/g, '&');
  if (!href || /^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  const b = parseUrl(base);
  if (!b) return '';
  const origin = b.protocol + '://' + b.host + (b.port ? ':' + b.port : '');
  if (href.startsWith('//')) return b.protocol + ':' + href;
  if (href.startsWith('/')) return origin + href;
  const dir = b.path.endsWith('/') ? b.path : b.path.replace(/[^\/]*$/, '');
  const parts = (dir + href).split('/');
  const out = [];
  for (const seg of parts) { if (seg === '..') out.pop(); else if (seg !== '.') out.push(seg); }
  return origin + out.join('/').replace(/^([^\/])/, '/$1');
}
// Error object from an HTTP Request node that used "On Error: Continue".
function httpFailure(json) {
  if (!json || json.error === undefined) return null;
  const e = json.error;
  const msg = typeof e === 'string' ? e : (e.message || e.description || JSON.stringify(e));
  const code = typeof e === 'object' ? (e.httpCode || e.statusCode || e.status || (e.cause && e.cause.status) || '') : '';
  const desc = typeof e === 'object' ? asText(e.description) : '';
  return { message: redact(msg + (desc && desc !== msg ? ' — ' + desc : '')), code: String(code) };
}
function isTransientCode(code, msg) {
  return /^(408|409|425|429|5\d\d)$/.test(String(code)) || /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg || '');
}
// Interprets a Gemini generateContent response (or HTTP failure item).
function readGemini(json) {
  const fail = httpFailure(json);
  if (fail) {
    const permanent = /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|403|401|not found for API version|is not found|NOT_FOUND/i.test(fail.message) && !isTransientCode(fail.code, fail.message);
    return { ok: false, kind: permanent ? 'PERMANENT' : (isTransientCode(fail.code, fail.message) ? 'TRANSIENT' : 'API_ERROR'), error: 'Gemini request failed: ' + fail.message };
  }
  if (!json || typeof json !== 'object') return { ok: false, kind: 'INVALID', error: 'Gemini returned a non-JSON response' };
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    return { ok: false, kind: 'BLOCKED', error: 'Gemini blocked the prompt: ' + json.promptFeedback.blockReason };
  }
  const cand = Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (!cand) return { ok: false, kind: 'INVALID', error: 'Gemini response contained no candidates' };
  const finish = asText(cand.finishReason);
  const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (finish && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finish)) {
    return { ok: false, kind: finish === 'MAX_TOKENS' ? 'TRUNCATED' : 'BLOCKED', error: 'Gemini stopped with finishReason ' + finish, text, finishReason: finish };
  }
  if (!text.trim()) return { ok: false, kind: 'INVALID', error: 'Gemini returned empty text' };
  return { ok: true, text, finishReason: finish, usage: json.usageMetadata || null, modelVersion: json.modelVersion || '' };
}
function extractJson(text) {
  let t = asText(text).replace(/^﻿/, '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try { return { ok: true, value: JSON.parse(t) }; } catch (e) { /* try the outermost object */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return { ok: true, value: JSON.parse(t.slice(s, e + 1)) }; } catch (err) { return { ok: false, error: 'Invalid JSON: ' + err.message }; } }
  return { ok: false, error: 'No JSON object found in model output' };
}
function geminiRequest(system, userText, gen) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: Object.assign({ responseMimeType: 'application/json' }, gen || {}),
  };
}
// Adds a bounded corrective turn after an invalid structured response.
function correctiveRequest(prev, badText, problems) {
  const req = JSON.parse(JSON.stringify(prev));
  req.contents.push({ role: 'model', parts: [{ text: truncate(badText || '(empty response)', 6000) }] });
  req.contents.push({ role: 'user', parts: [{ text: 'Your previous response was rejected by automated validation for these reasons:\n- ' + problems.join('\n- ') + '\n\nReturn the COMPLETE corrected response again as one valid JSON object that follows the required schema exactly. Do not add commentary or code fences.' }] });
  return req;
}
function assertLease(json, stage) {
  if (json && json.lease_ok === false) {
    throw new Error('LEASE_LOST at ' + stage + ': another execution now owns this job (' + JSON.stringify(json.detail || {}) + '). Stopping without further writes.');
  }
}
function setOutcome(ctx, status, stage, reason, retryable) {
  ctx.outcome = { status, stage, reason: redact(truncate(reason, 1500)), retryable: !!retryable };
  return ctx;
}
