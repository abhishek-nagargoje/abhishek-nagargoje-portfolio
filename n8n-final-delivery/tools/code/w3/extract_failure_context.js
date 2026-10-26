// @mode each
// @lib common
// Error Trigger payload: { execution: {id, url, error, lastNodeExecuted, mode, retryOf}, workflow: {id, name} }
// (or { trigger: {...}, workflow } when the failing node was the trigger).
const ex = $json.execution || {};
const wf = $json.workflow || {};
const err = ex.error || ($json.trigger && $json.trigger.error) || {};
// n8n shortens some messages to the text after their last colon (e.g. inside a
// URL); the first line of the stack keeps the full original message.
const stackLine = asText(err.stack).split('\n')[0].replace(/^(Node|NodeOperation|NodeApi|Expression)?Error:\s*/, '');
const primary = stackLine.length > asText(err.message).length ? stackLine : asText(err.message);
const message = [primary, asText(err.description)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ') || 'Unknown error';
return { json: {
  execution_id: ex.id !== undefined && ex.id !== null ? String(ex.id) : '',
  workflow_id: asText(wf.id), workflow_name: asText(wf.name), mode: asText(ex.mode || 'trigger'),
  last_node: asText(ex.lastNodeExecuted || (err.node && err.node.name) || 'unknown'),
  error_message: truncate(redact(message), 4000), execution_url: asText(ex.url),
} };
