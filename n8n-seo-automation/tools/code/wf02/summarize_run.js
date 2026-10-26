// Summary of one orchestrator run (shown in the execution log).
const results = $input.all().map((i) => i.json);
const outcomes = {};
for (const r of results) {
  const k = r.outcome || (r.error ? 'SUB_EXECUTION_FAILED' : 'UNKNOWN');
  outcomes[k] = (outcomes[k] || 0) + 1;
}
return [{ json: {
  run_id: $('Confirm Preflight').first(0).json.run_id,
  finished_at: new Date().toISOString(),
  processed: results.length,
  outcomes,
  details: results.map((r) => ({ keyword_id: r.keyword_id, article_id: r.article_id, outcome: r.outcome || null, error: r.error ? String(r.error.message || r.error).slice(0, 300) : undefined })),
} }];
