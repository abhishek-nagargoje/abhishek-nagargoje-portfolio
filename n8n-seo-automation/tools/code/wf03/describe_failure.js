// @include common
// Normalises the Error Trigger payload. Never copies request headers or
// credentials - only ids, node name and a scrubbed message.
const d = $input.first().json;
const execution = d.execution || {};
const workflow = d.workflow || {};
const message = scrubSecrets(String((execution.error && (execution.error.message || execution.error.description)) || 'unknown error')).slice(0, 1500);
return [{ json: {
  execution_id: String(execution.id || ''),
  workflow_name: workflow.name || '',
  last_node: execution.lastNodeExecuted || '',
  mode: execution.mode || '',
  message: `Workflow "${workflow.name}" failed at node "${execution.lastNodeExecuted}": ${message}`,
} }];
