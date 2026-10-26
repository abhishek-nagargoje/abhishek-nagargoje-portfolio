// @include common
// Verifies the Keywords tab has the required columns, then keeps rows whose
// Status is exactly READY (case-insensitive). Rows with any other status,
// including blank rows still being drafted, are left untouched.
const REQUIRED_COLUMNS = ['Keyword_ID', 'Target_Page_URL', 'Primary_Keyword', 'Supporting_Keywords', 'Search_Intent',
  'Target_Audience', 'Target_Location', 'Language', 'Priority', 'Status', 'Processing_Started_At', 'Processed_At', 'Last_Error'];
const rows = $input.all().map((i) => i.json).filter((r) => r && Object.keys(r).length > 0);
if (rows.length === 0) {
  return [];
}
const present = new Set(rows.flatMap((r) => Object.keys(r)));
const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
if (missing.length) {
  throw new Error(`CONFIGURATION: Keywords tab is missing column(s): ${missing.join(', ')}. See documentation/GOOGLE_SHEETS_SETUP.md`);
}
const ready = rows.filter((r) => asText(r.Status).toUpperCase() === 'READY');
return ready.map((r) => ({ json: r }));
