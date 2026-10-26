// @mode all
// @lib common
// Reads every row of the Keywords tab, keeps rows whose Status is READY and
// validates them. Produces exactly one item: the candidate list (priority
// order) plus invalid READY rows to be marked ERROR.
const ctx = $('Verify Schema & Settings').first().json.ctx;
const c = ctx.config;
const REQUIRED_HEADERS = ['Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Supporting_Keywords', 'Search_Intent',
  'Target_Audience', 'Target_Location', 'Language', 'Priority', 'Status', 'Processing_Started_At', 'Processed_At', 'Last_Error'];
const rows = $input.all().map((i) => i.json)
  .filter((r) => r && typeof r === 'object' && r.row_number !== undefined)
  .filter((r) => REQUIRED_HEADERS.some((h) => asText(r[h]) !== ''));

if (rows.length) {
  const missing = REQUIRED_HEADERS.filter((h) => !(h in rows[0]));
  if (missing.length) throw new Error('CONFIG_ERROR: Keywords sheet is missing header(s): ' + missing.join(', '));
}
const idCount = {};
rows.forEach((r) => { const id = asText(r.Keyword_ID).toLowerCase(); if (id) idCount[id] = (idCount[id] || 0) + 1; });
const prioRank = (p) => {
  const t = asText(p).toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return { urgent: 0, highest: 0, high: 1, medium: 2, normal: 2, low: 3, lowest: 4 }[t] ?? 5;
};
const splitList = (v) => asText(v).split(/[,;\n|]/).map((s) => s.trim()).filter(Boolean);

const candidates = [];
const invalid = [];
const ready = rows.filter((r) => asText(r.Status).toUpperCase() === 'READY');
for (const r of ready) {
  const problems = [];
  const id = asText(r.Keyword_ID);
  const kw = asText(r.Primary_Keyword).replace(/\s+/g, ' ');
  let url = asText(r.Target_Page_URL);
  if (url && !/^https?:\/\//i.test(url) && /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(url)) url = 'https://' + url;
  const p = parseUrl(url);
  if (!id) problems.push('Keyword_ID is blank');
  else if (idCount[id.toLowerCase()] > 1) problems.push('Keyword_ID "' + id + '" is used by more than one row; Keyword_IDs must be unique');
  else if (!/^[A-Za-z0-9._:\-]{1,64}$/.test(id)) problems.push('Keyword_ID may only contain letters, digits and . _ : -');
  if (!kw) problems.push('Primary_Keyword is blank');
  else if (kw.length < 2 || kw.length > 150) problems.push('Primary_Keyword must be 2-150 characters');
  if (!url) problems.push('Target_Page_URL is blank');
  else if (!p) problems.push('Target_Page_URL is not a valid http(s) URL');
  else if (p.protocol !== 'https') problems.push('Target_Page_URL must use https');
  else if (!hostAllowed(p.host, c.allowed_target_domains)) problems.push('Target_Page_URL host ' + p.host + ' is not in allowed_target_domains (' + c.allowed_target_domains.join(', ') + ')');
  if (problems.length) {
    invalid.push({ row_number: r.row_number, Keyword_ID: id, Status: 'ERROR', Processed_At: nowLocal(c.timezone), Last_Error: 'Validation failed: ' + problems.join('; ') });
    continue;
  }
  const input = {
    Keyword_ID: id, Target_Page_URL: normalizeUrl(url), Primary_Keyword: kw,
    Supporting_Keywords: splitList(r.Supporting_Keywords).slice(0, 20),
    Search_Intent: asText(r.Search_Intent) || 'informational',
    Target_Audience: asText(r.Target_Audience) || 'HR leaders and business owners in India',
    Target_Location: asText(r.Target_Location) || 'India',
    Language: asText(r.Language) || 'English',
    Priority: asText(r.Priority), row_number: r.row_number,
  };
  candidates.push({ keyword_id: id, target_page_url: input.Target_Page_URL, primary_keyword: kw, row_number: r.row_number,
    priority_rank: prioRank(r.Priority), input });
}
candidates.sort((a, b) => a.priority_rank - b.priority_rank || a.row_number - b.row_number);
const summary = { total_rows: rows.length, ready_rows: ready.length, valid_ready_rows: candidates.length, invalid_ready_rows: invalid.length };
let message;
if (!rows.length) message = 'The Keywords sheet has no data rows. Add at least one row with Keyword_ID, Target_Page_URL, Primary_Keyword and Status = READY.';
else if (!ready.length) message = 'No row in the Keywords sheet has Status = READY. Add or update at least one valid row and set Status to READY.';
else if (!candidates.length) message = 'All READY rows failed validation and were marked ERROR (see Last_Error). Fix them and set Status back to READY.';
else message = candidates.length + ' valid READY keyword(s) found; one will be processed in this execution.';
return [{ json: { ctx, candidates, invalid_rows: invalid, summary, message } }];
