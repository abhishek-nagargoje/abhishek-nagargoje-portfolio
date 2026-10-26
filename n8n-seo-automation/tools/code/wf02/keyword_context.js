// @include common
// Entry point of the per-keyword sub-execution. Re-validates the record it was
// given (defence in depth) and fixes the context every later node refers to.
const input = $input.first().json;
const config = input.config;
if (!config || !config.BRAND_ID) throw new Error('CONFIGURATION: sub-execution started without configuration; start the workflow from its Manual or Schedule trigger');
const r = input.record || input;
const url = validateTargetUrl(r.target_page_url, config);
if (!url.ok) throw new Error(`INPUT: ${url.reason}`);
if (!asText(r.keyword_id)) throw new Error('INPUT: Keyword_ID missing');
if (normalizeKeyword(r.primary_keyword).length < 3) throw new Error('INPUT: Primary_Keyword missing');
return [{ json: {
  config,
  parent_run_id: input.parent_run_id || null,
  execution_id: String($execution.id),
  keyword_id: r.keyword_id,
  row_number: r.row_number,
  target_page_url: url.url,
  normalized_url: url.normalized,
  site_host: url.host,
  primary_keyword: asText(r.primary_keyword),
  normalized_keyword: normalizeKeyword(r.primary_keyword),
  supporting_keywords: splitList(r.supporting_keywords),
  search_intent: asText(r.search_intent),
  target_audience: asText(r.target_audience),
  target_location: asText(r.target_location),
  language: asText(r.language) || 'English',
  regenerate: r.regenerate === true,
  started_at_ist: DateTime.now().setZone(config.TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss'),
} }];
