// @include common
// Validates each READY row, normalises it, applies the in-batch deduplication
// policy (brand + normalised keyword + normalised URL) and limits the batch.
// route: PROCESS | INVALID | DUPLICATE_IN_BATCH | DEFERRED
const { config } = $('Confirm Preflight').first(0).json;
const rows = $input.all().map((i) => i.json);
const nowIst = DateTime.now().setZone(config.TIMEZONE).toFormat("yyyy-LL-dd HH:mm:ss");
const idCounts = {};
for (const r of rows) {
  const id = asText(r.Keyword_ID);
  if (id) idCounts[id] = (idCounts[id] || 0) + 1;
}
const priorityRank = (p) => {
  const v = asText(p).toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  return { high: 1, medium: 2, normal: 2, low: 3 }[v] ?? 2;
};
const results = rows.map((r) => {
  const errors = [];
  const url = validateTargetUrl(r.Target_Page_URL, config);
  if (!url.ok) errors.push(url.reason);
  const keyword = asText(r.Primary_Keyword);
  const nk = normalizeKeyword(keyword);
  if (!keyword) errors.push('Primary_Keyword is empty');
  else if (nk.length < 3) errors.push('Primary_Keyword is too short');
  else if (keyword.length > 150) errors.push('Primary_Keyword is longer than 150 characters');
  else if (/https?:\/\//i.test(keyword)) errors.push('Primary_Keyword contains a URL');
  let keywordId = asText(r.Keyword_ID);
  let generated = false;
  if (keywordId && idCounts[keywordId] > 1) errors.push(`Keyword_ID ${keywordId} is used by ${idCounts[keywordId]} READY rows; Keyword_IDs must be unique`);
  if (keywordId && !/^[A-Za-z0-9_\-.]{1,64}$/.test(keywordId)) errors.push('Keyword_ID may contain only letters, digits, "_", "-" and "." (max 64)');
  if (!keywordId && url.ok && nk) {
    keywordId = 'KW-' + fnv1a64(`${config.BRAND_ID}|${nk}|${url.normalized}`).slice(0, 12).toUpperCase();
    generated = true;
  }
  const language = asText(r.Language) || 'English';
  return {
    row_number: r.row_number,
    keyword_id: keywordId,
    keyword_id_generated: generated,
    target_page_url: url.ok ? url.url : asText(r.Target_Page_URL),
    normalized_url: url.ok ? url.normalized : '',
    site_host: url.ok ? url.host : '',
    primary_keyword: keyword,
    normalized_keyword: nk,
    supporting_keywords: splitList(r.Supporting_Keywords),
    search_intent: asText(r.Search_Intent),
    target_audience: asText(r.Target_Audience),
    target_location: asText(r.Target_Location),
    language,
    priority: priorityRank(r.Priority),
    regenerate: isTruthyFlag(r.Regenerate),
    route: errors.length ? 'INVALID' : 'PROCESS',
    reason: errors.join('; '),
    validated_at: nowIst,
  };
});

// in-batch duplicates of the same brand+keyword+URL combination
const seen = new Map();
const processable = results.filter((r) => r.route === 'PROCESS').sort((a, b) => a.priority - b.priority || a.row_number - b.row_number);
for (const r of processable) {
  const combo = `${r.normalized_keyword}|${r.normalized_url}`;
  if (seen.has(combo)) {
    r.route = 'DUPLICATE_IN_BATCH';
    r.reason = `Same keyword and target URL as ${seen.get(combo)} in this batch`;
  } else {
    seen.set(combo, r.keyword_id);
  }
}
let selected = 0;
for (const r of processable) {
  if (r.route !== 'PROCESS') continue;
  selected += 1;
  if (selected > config.MAX_ARTICLES_PER_RUN) {
    r.route = 'DEFERRED';
    r.reason = `MAX_ARTICLES_PER_RUN (${config.MAX_ARTICLES_PER_RUN}) reached; stays READY for the next run`;
  }
}
const ordered = [...processable, ...results.filter((r) => r.route === 'INVALID')];
return ordered.map((r) => ({
  json: {
    ...r,
    sheet_status: r.route === 'INVALID' ? 'ERROR' : (r.route === 'DUPLICATE_IN_BATCH' ? 'SKIPPED_DUPLICATE' : ''),
  },
}));
