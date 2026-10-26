// @mode each
const s = $('Summarize Ingestion').item.json.summary;
const res = $json;
if (!(res.active_records > 0)) {
  throw new Error('KNOWLEDGE_BASE_EMPTY: no active HR Remedy India knowledge records exist after ingestion. The article workflow will refuse to run until verified, approved records are ingested. Details: ' + JSON.stringify(s.records.slice(0, 10)));
}
return { json: {
  status: res.status, run_id: res.run_id, active_records: res.active_records, total_records: res.total_records,
  deactivated_unapproved: res.deactivated,
  inserted: s.inserted, updated: s.updated, unchanged: s.unchanged, skipped: s.skipped, failed: s.failed,
  rows_read: s.rows_read, approved_rows: s.approved_rows, unapproved_rows_ignored: s.unapproved_skipped,
  failures: s.records.filter((r) => r.status === 'FAILED' || r.status === 'SKIPPED').concat(s.sheet_level_skips),
} };
