// @mode each
const j = $json;
return { json: { recovered: false, action: j.action, article_id: j.article_id, error_id: j.error_id,
  message: j.action === 'NONE' && !j.article_id ? 'Nothing to recover (no job owned by the failed execution, or nothing found by the sweep).' : 'No further action required.' } };
