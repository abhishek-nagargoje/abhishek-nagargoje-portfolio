// @mode each
// Final summary for one recovered job.
return { json: { recovered: true, article_id: $json.article_id || null, event_ok: $json.lease_ok !== false, status: $json.status || null, detail: $json.detail || null } };
