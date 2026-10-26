// ---- lib/common.js : text, URL, hashing and error helpers (inlined into Code nodes) ----

function normalizeKeyword(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'&+\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  return asText(value)
    .split(/[,;\n|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isTruthyFlag(value) {
  return ['true', 'yes', 'y', '1', 'approved'].includes(asText(value).toLowerCase());
}

// Minimal absolute/relative URL parser. n8n 2.x Code nodes run in a task-runner
// VM context that does NOT provide the WHATWG URL / URLSearchParams globals, so
// all URL handling in Code nodes goes through this function.
// Returns null for anything that is not a hierarchical scheme://host URL.
function parseUrl(input, base) {
  let s = String(input ?? '').trim();
  if (!s || /[\s<>"\\^`{|}]/.test(s)) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(s)) {
    const b = base ? parseUrl(base) : null;
    if (!b) return null;
    if (s.startsWith('//')) s = b.protocol + s;
    else if (s.startsWith('/')) s = `${b.protocol}//${b.host}${s}`;
    else if (s.startsWith('?')) s = `${b.protocol}//${b.host}${b.pathname}${s}`;
    else if (s.startsWith('#')) s = `${b.protocol}//${b.host}${b.pathname}${b.search}${s}`;
    else s = `${b.protocol}//${b.host}${b.pathname.replace(/[^/]*$/, '')}${s}`;
  }
  const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*:)\/\/(?:([^@/?#]*)@)?(\[[0-9a-fA-F:.]+\]|[^:/?#]*)(?::(\d*))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s);
  if (!m) return null;
  const protocol = m[1].toLowerCase();
  const hostname = m[3].toLowerCase();
  const port = m[4] || '';
  if (!hostname || !/^(\[[0-9a-f:.]+\]|[\p{L}\p{N}.\-_%]+)$/u.test(hostname) || /^\.|\.\.|\.$/.test(hostname)) return null;
  if (port && (Number(port) > 65535 || m[4] === '')) return null;
  const segments = [];
  for (const seg of (m[5] || '/').split('/').slice(1)) {
    if (seg === '..') segments.pop();
    else if (seg !== '.') segments.push(seg);
  }
  const pathname = '/' + segments.join('/');
  const userinfo = m[2] || '';
  const [username, password] = userinfo ? userinfo.split(':') : ['', ''];
  const host = hostname + (port ? ':' + port : '');
  const search = m[6] && m[6] !== '?' ? m[6] : '';
  const hash = m[7] && m[7] !== '#' ? m[7] : '';
  return { protocol, username: username || '', password: password || '', hostname, port, host, pathname, search, hash,
    href: `${protocol}//${userinfo ? userinfo + '@' : ''}${host}${pathname}${search}${hash}` };
}

// Normalised URL used for identity/deduplication (not for fetching).
function normalizeUrl(raw) {
  const u = parseUrl(asText(raw));
  if (!u) throw new Error('Invalid URL: ' + asText(raw).slice(0, 200));
  const port = (u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80') ? '' : u.port;
  const params = u.search.replace(/^\?/, '').split('&').filter(Boolean)
    .filter((kv) => !/^(utm_[^=]*|gclid|fbclid|mc_eid|mc_cid)(=|$)/i.test(kv))
    .sort((a, b) => a.localeCompare(b));
  const search = params.length ? '?' + params.join('&') : '';
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/') && !search) pathname = pathname.slice(0, -1);
  if (pathname === '/' && !search) pathname = '';
  return `${u.protocol}//${u.hostname}${port ? ':' + port : ''}${pathname}${search}`;
}

// Validation of a target page URL supplied by a human in Google Sheets.
function validateTargetUrl(raw, config) {
  const value = asText(raw);
  if (!value) return { ok: false, reason: 'Target_Page_URL is empty' };
  if (/\s/.test(value)) return { ok: false, reason: 'Target_Page_URL contains whitespace' };
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(value) && !/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(value)) {
    const scheme = value.slice(0, value.indexOf(':') + 1).toLowerCase();
    return { ok: false, reason: `URL scheme ${scheme} is not allowed` };
  }
  const u = parseUrl(value);
  if (!u) return { ok: false, reason: 'Target_Page_URL is not a valid absolute URL' };
  const schemes = (config && config.ALLOWED_URL_SCHEMES) || ['https:'];
  if (!schemes.includes(u.protocol)) return { ok: false, reason: `URL scheme ${u.protocol} is not allowed (allowed: ${schemes.join(', ')})` };
  if (u.username || u.password) return { ok: false, reason: 'URLs with embedded credentials are not allowed' };
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '[::1]') {
    return { ok: false, reason: 'Private, local or single-label hosts are not allowed' };
  }
  const allowed = ((config && config.ALLOWED_TARGET_DOMAINS) || []).map((d) => d.toLowerCase());
  if (allowed.length && !allowed.some((d) => host === d || host.endsWith('.' + d))) {
    return { ok: false, reason: `Host ${host} is not in ALLOWED_TARGET_DOMAINS` };
  }
  return { ok: true, url: u.href, normalized: normalizeUrl(value), host };
}

function sameSite(hostA, hostB) {
  const strip = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
  return strip(hostA) === strip(hostB);
}

// 64-bit FNV-1a, hex. Used for deterministic generated IDs (not security).
function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(String(input));
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function wordCount(text) {
  const m = String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 40)) + ` …[truncated ${s.length - max + 40} chars]`;
}

// Removes anything that looks like a credential before it is logged.
function scrubSecrets(text) {
  return String(text ?? '')
    .replace(/(x-goog-api-key|api[_-]?key|token|authorization|password|secret)(["'\s:=]+)([^\s"'&,}]+)/gi, '$1$2[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [REDACTED]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED_GOOGLE_KEY]')
    .replace(/([?&](key|token)=)[^&\s]+/gi, '$1[REDACTED]');
}

// Classifies an error item produced by an n8n node's error output.
function classifyNodeError(json, stage) {
  const err = json && json.error !== undefined ? json.error : json;
  let message = '';
  let httpCode = null;
  if (typeof err === 'string') message = err;
  else if (err && typeof err === 'object') {
    message = [err.message, err.description].filter(Boolean).join(' | ');
    httpCode = err.httpCode || err.status || err.statusCode || (err.response && err.response.status) || null;
  }
  if (!message) message = JSON.stringify(err || {}).slice(0, 500);
  if (!httpCode) {
    const m = String(message).match(/\b(4\d\d|5\d\d)\b/);
    if (m) httpCode = m[1];
  }
  const code = httpCode ? Number(httpCode) : null;
  const text = String(message).toLowerCase();
  let errorClass = 'API_TRANSIENT';
  let retryable = true;
  if (/claim_lost/.test(text)) {
    errorClass = 'CLAIM_LOST';
    retryable = false;
  } else if (code === 401 || code === 403 || /permission|unauthori[sz]ed|forbidden|invalid api key|api key not valid|invalid_grant|insufficient/.test(text)) {
    errorClass = 'CONFIGURATION';
    retryable = false;
  } else if (code === 404 && /model|models\//.test(text)) {
    errorClass = 'CONFIGURATION';
    retryable = false;
  } else if (code === 400 || code === 404 || code === 422) {
    errorClass = 'CONFIGURATION';
    retryable = false;
  } else if (/embedding_dimension_mismatch|embedding_config_mismatch|relation .* does not exist|function .* does not exist|extension .*vector/.test(text)) {
    errorClass = 'CONFIGURATION';
    retryable = false;
  } else if (code === 429 || /rate limit|quota|resource_exhausted|too many requests/.test(text)) {
    errorClass = 'API_TRANSIENT';
    retryable = true;
  }
  return {
    stage: stage || 'UNKNOWN',
    error_class: errorClass,
    retryable,
    http_code: code,
    message: truncate(scrubSecrets(message), 1500),
  };
}

/* @exports */
module.exports = {
  normalizeKeyword, asText, splitList, isTruthyFlag, parseUrl, normalizeUrl, validateTargetUrl, sameSite,
  fnv1a64, wordCount, truncate, scrubSecrets, classifyNodeError,
};
