// Final ingestion report. Fails the execution (so the error workflow and the
// n8n execution list show it) when nothing could be ingested because of errors.
const run = $input.first().json;
const summary = {
  run_id: run.run_id, status: run.status, brand_id: run.brand_id,
  rows_read: run.rows_read, rows_approved: run.rows_approved, rows_invalid: run.rows_invalid,
  chunks_inserted: run.chunks_inserted, chunks_updated: run.chunks_updated, chunks_unchanged: run.chunks_unchanged,
  chunks_deactivated: run.chunks_deactivated, errors: run.errors,
};
if (run.status === 'FAILED') {
  throw new Error(`INGESTION_FAILED: ${JSON.stringify(summary)} - see seo.brand_ingestion_errors for run ${run.run_id}`);
}
return [{ json: summary }];
