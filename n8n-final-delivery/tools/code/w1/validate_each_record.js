// @mode each
// @lib common
const ctx = $json.ctx;
const r = Object.assign({}, $json.record);
const c = ctx.config;
const problems = [];
if (r.knowledge_id.length > 100) problems.push('Knowledge_ID longer than 100 characters');
if (r.content.length > c.max_content_chars) problems.push('Content is ' + r.content.length + ' characters; split it into several Knowledge_IDs of at most ' + c.max_content_chars + ' characters (content is never truncated)');
if (r.content.length < 20) problems.push('Content is too short to be useful (< 20 characters)');
let official = false;
if (r.source_url) {
  const p = parseUrl(r.source_url);
  if (!p) problems.push('Source_URL is not a valid http(s) URL');
  else { r.source_url = normalizeUrl(r.source_url); official = hostAllowed(p.host, c.official_domains); }
}
r.metadata = { category: r.category, source_url: r.source_url, source_is_official_domain: official, sheet_row: r.row_number,
  last_updated: r.last_updated, ingested_by_execution: ctx.run.execution_id, ingested_at: new Date().toISOString() };
if (problems.length) {
  return { json: { ctx, record: r, valid: false, outcome: { knowledge_id: r.knowledge_id, row_number: r.row_number, status: 'SKIPPED', error: problems.join('; ') } } };
}
return { json: { ctx, record: r, valid: true } };
