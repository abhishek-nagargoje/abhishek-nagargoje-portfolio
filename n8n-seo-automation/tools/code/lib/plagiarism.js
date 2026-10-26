// ---- lib/plagiarism.js : provider-neutral plagiarism report handling ----
// Requires lib/common.js (wordCount, truncate, scrubSecrets).
//
// DupliChecker facts used (official API documentation page, see
// documentation/PLAGIARISM_API_SETUP.md):
//   POST https://www.duplichecker.com/api/checkplag   fields: token, data, rephrased
//   POST https://www.duplichecker.com/api/info        field:  token  (account status)
//   response: details[] (one entry per sentence, `unique` boolean; unique=false = matched)
//             exactMatchedPercent, rephrasedPercent (when rephrased=true)
// Anything else (an overall-percent field name, polling/callback contract)
// is NOT assumed: it must be configured explicitly (PLAGIARISM_PERCENT_FIELD,
// PLAGIARISM_POLL_URL_TEMPLATE) after checking the account's API docs.
// Unrecognised responses fail closed (state ERROR, never PASS).

function chunkTextByWords(text, maxWords) {
  const max = Math.max(50, Number(maxWords) || 1000);
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let current = [];
  let count = 0;
  for (const s of sentences) {
    const w = wordCount(s);
    if (count + w > max && current.length) {
      chunks.push(current.join(' '));
      current = [];
      count = 0;
    }
    current.push(s);
    count += w;
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}

function getPath(obj, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

function collectUrls(value, out) {
  if (typeof value === 'string') {
    const m = value.match(/https?:\/\/[^\s"'<>]+/g);
    if (m) m.forEach((u) => out.add(u));
  } else if (Array.isArray(value)) value.forEach((v) => collectUrls(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectUrls(v, out));
  return out;
}

// statusCode: HTTP status; body: parsed JSON or raw string; chunkText: text sent.
// Returns { state: COMPLETE|PENDING|ERROR, ... }.
function normalizePlagiarismResponse(statusCode, body, chunkText, cfg) {
  const config = cfg || {};
  let data = body;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return { state: 'ERROR', error_class: statusCode >= 500 ? 'API_TRANSIENT' : 'CONFIGURATION', retryable: statusCode >= 500,
        message: `Plagiarism API returned a non-JSON response (HTTP ${statusCode}): ${truncate(scrubSecrets(body), 300)}` };
    }
  }
  if (statusCode === 401 || statusCode === 403) {
    return { state: 'ERROR', error_class: 'CONFIGURATION', retryable: false, message: `Plagiarism API authentication failed (HTTP ${statusCode})` };
  }
  if (statusCode === 429 || statusCode >= 500 || !statusCode) {
    return { state: 'ERROR', error_class: 'API_TRANSIENT', retryable: true, message: `Plagiarism API unavailable or rate limited (HTTP ${statusCode || 'no response'})` };
  }
  if (statusCode >= 400) {
    return { state: 'ERROR', error_class: 'CONFIGURATION', retryable: false, message: `Plagiarism API rejected the request (HTTP ${statusCode}): ${truncate(scrubSecrets(JSON.stringify(data)), 300)}` };
  }
  if (!data || typeof data !== 'object') {
    return { state: 'ERROR', error_class: 'API_TRANSIENT', retryable: true, message: 'Plagiarism API returned an empty body' };
  }

  const errText = [data.error, data.errors, data.message, data.msg].filter((v) => typeof v === 'string').join(' ');
  const details = Array.isArray(data.details) ? data.details : null;
  const configuredPercent = toNumber(getPath(data, config.PLAGIARISM_PERCENT_FIELD));
  const exact = toNumber(data.exactMatchedPercent);
  const rephrased = toNumber(data.rephrasedPercent);

  if (!details && configuredPercent === null && exact === null) {
    if (data.success === false || data.status === 'error' || data.error || /invalid|expired|unauthori|token|credit|limit|exceed|not allowed/i.test(errText)) {
      const auth = /token|unauthori|invalid key|expired/i.test(errText);
      const quota = /credit|limit|exceed|quota/i.test(errText);
      return { state: 'ERROR', error_class: auth ? 'CONFIGURATION' : (quota ? 'CONFIGURATION' : 'API_TRANSIENT'), retryable: !(auth || quota),
        message: `Plagiarism API error: ${truncate(scrubSecrets(errText || JSON.stringify(data)), 300)}` };
    }
    const pollRef = ['query_footprint', 'footprint', 'hash', 'key', 'id', 'query_id', 'scan_id'].reduce((acc, k) => {
      if (data[k] !== undefined && data[k] !== null && data[k] !== '') acc[k] = String(data[k]);
      return acc;
    }, {});
    if (Object.keys(pollRef).length) {
      return { state: 'PENDING', poll_ref: pollRef, message: 'Report not yet available' };
    }
    return { state: 'ERROR', error_class: 'CONFIGURATION', retryable: false,
      message: `REPORT_UNPARSEABLE: no details[], exactMatchedPercent or configured percent field in response. Keys: ${Object.keys(data).slice(0, 20).join(', ')}` };
  }

  const totalWords = wordCount(chunkText);
  let matchedWords = 0;
  const matched = [];
  if (details) {
    for (const d of details) {
      const sentence = String((d && (d.query || d.sentence || d.text)) || '');
      const isUnique = d && (d.unique === true || d.unique === 'true' || d.unique === 1);
      if (!isUnique) {
        const w = wordCount(sentence);
        matchedWords += w;
        const urls = [...collectUrls(d, new Set())];
        matched.push({ sentence: truncate(sentence, 400), words: w, sources: urls.slice(0, 5), quoted: /^["“].*["”]$/.test(sentence.trim()) });
      }
    }
  }
  const computedPercent = details && totalWords ? Math.min(100, (matchedWords / totalWords) * 100) : null;
  const reportedPercent = configuredPercent !== null ? configuredPercent : (exact !== null ? exact + (rephrased || 0) : null);
  const candidates = [computedPercent, reportedPercent].filter((v) => v !== null);
  return {
    state: 'COMPLETE',
    words: totalWords,
    similarity_percent: Math.round(Math.max(...candidates) * 100) / 100,
    reported_percent: reportedPercent,
    computed_percent: computedPercent === null ? null : Math.round(computedPercent * 100) / 100,
    exact_matched_percent: exact,
    rephrased_percent: rephrased,
    matched_passages: matched,
    report_url: typeof data.report_url === 'string' ? data.report_url : (typeof data.reportUrl === 'string' ? data.reportUrl : null),
  };
}

// Combines per-chunk COMPLETE results (word-weighted) and applies the policy.
function decidePlagiarism(chunkResults, cfg) {
  const threshold = Number(cfg.PLAGIARISM_THRESHOLD_PERCENT ?? 10);
  const total = chunkResults.reduce((s, r) => s + (r.words || 0), 0) || 1;
  const weighted = chunkResults.reduce((s, r) => s + (r.similarity_percent || 0) * (r.words || 0), 0) / total;
  const percent = Math.round(weighted * 100) / 100;
  const passages = chunkResults.flatMap((r) => r.matched_passages || []);
  const sources = [...new Set(passages.flatMap((p) => p.sources))].slice(0, 25);
  const failed = [];
  if (percent > threshold) {
    failed.push(`PLAGIARISM_THRESHOLD: reported similarity ${percent}% exceeds the configured ${threshold}% policy`);
  }
  const longUnquoted = passages.filter((p) => !p.quoted && p.words >= Number(cfg.PLAGIARISM_MAX_MATCHED_PASSAGE_WORDS || 40));
  if (longUnquoted.length) {
    failed.push(`PLAGIARISM_LONG_MATCH: ${longUnquoted.length} long matched passage(s) without quotation/attribution`);
  }
  return {
    status: failed.length ? 'FAIL' : 'PASS',
    percent,
    threshold,
    failed_conditions: failed,
    matched_passages: passages.slice(0, 30),
    matched_sources: sources,
    report_urls: chunkResults.map((r) => r.report_url).filter(Boolean),
    chunks: chunkResults.length,
  };
}

// Merges per-chunk results of one submit/poll round into the scan state that
// drives the bounded polling loop. state: COMPLETE | PENDING | ERROR
// results: [{ chunk: {chunk_index, text, words}, res: normalizePlagiarismResponse(...) }]
function buildScanState(previous, results, cfg) {
  const prev = previous || { completed: [], poll_round: -1 };
  const completed = [...(prev.completed || [])];
  const pending = [];
  const errors = [];
  for (const { chunk, res } of results) {
    if (res.state === 'COMPLETE') completed.push({ chunk_index: chunk.chunk_index, ...res });
    else if (res.state === 'PENDING') pending.push({ chunk_index: chunk.chunk_index, text: chunk.text, words: chunk.words, poll_ref: res.poll_ref });
    else errors.push({ chunk_index: chunk.chunk_index, ...res });
  }
  const pollRound = (prev.poll_round ?? -1) + 1;
  const state = { completed, pending, poll_round: pollRound };
  if (errors.length) {
    const first = errors[0];
    return { ...state, state: 'ERROR', error_class: first.error_class || 'API_TRANSIENT', retryable: first.retryable !== false,
      error: `PLAGIARISM_CHECK_FAILED (chunk ${first.chunk_index}): ${first.message}` };
  }
  if (pending.length) {
    if (!cfg.PLAGIARISM_POLL_URL_TEMPLATE) {
      return { ...state, state: 'ERROR', error_class: 'CONFIGURATION', retryable: false,
        error: 'PLAGIARISM_ASYNC_NOT_CONFIGURED: the provider returned a pending job but PLAGIARISM_POLL_URL_TEMPLATE is not configured; the article was not approved' };
    }
    if (pollRound >= Number(cfg.PLAGIARISM_MAX_POLLS || 10)) {
      return { ...state, state: 'ERROR', error_class: 'API_TRANSIENT', retryable: true,
        error: `PLAGIARISM_POLL_TIMEOUT: report not ready after ${pollRound} polls; the article was not approved` };
    }
    return { ...state, state: 'PENDING' };
  }
  return { ...state, state: 'COMPLETE' };
}

function buildPollUrl(template, pollRef) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(pollRef[k] ?? ''));
}

/* @exports */
module.exports = { chunkTextByWords, getPath, toNumber, normalizePlagiarismResponse, decidePlagiarism, buildScanState, buildPollUrl };
