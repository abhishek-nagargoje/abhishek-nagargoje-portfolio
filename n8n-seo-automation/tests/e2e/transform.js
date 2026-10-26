// Produces TEST copies of the production workflows for end-to-end execution
// against tests/e2e/mock_services.js. Production logic (Code nodes, IF/Switch,
// loops, Wait, Postgres, HTTP Request for Gemini/DupliChecker/Docs, Execute
// Workflow self-call) is kept unchanged. Only these are changed:
//   * configuration values (IDs, API base URLs, small timings)
//   * Google Sheets nodes -> HTTP Request nodes against the in-memory mock sheet
//     (native Google OAuth cannot be mocked); same node names and wiring
//   * Google Docs HTTP nodes: OAuth credential removed (mock needs no auth)
//   * credential IDs -> locally imported test credentials
//   * a Webhook trigger is added next to the Manual/Schedule triggers so the
//     orchestrator path can be started on a running n8n server
const crypto = require('crypto');

function setConfig(jsCode, overrides) {
  let out = jsCode;
  for (const [k, v] of Object.entries(overrides)) {
    const re = new RegExp(`(\\n\\s*${k}: )([^\\n]*?)(,\\n)`);
    if (!re.test(out)) throw new Error(`config key ${k} not found`);
    out = out.replace(re, `$1${JSON.stringify(v)}$3`);
  }
  return out;
}

function exprToJs(value) {
  if (typeof value !== 'string') return JSON.stringify(value);
  const m = value.match(/^=\{\{([\s\S]*)\}\}$/);
  if (m && !m[1].includes('{{')) return `(${m[1].trim()})`;
  if (value.startsWith('=')) throw new Error(`unsupported mixed expression: ${value}`);
  return JSON.stringify(value);
}

function sheetsToHttp(node, mockBase) {
  const p = node.parameters;
  const tab = exprToJs(p.sheetName.value);
  const common = {
    name: node.name, id: node.id, position: node.position, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    ...(node.onError ? { onError: node.onError } : {}), ...(node.alwaysOutputData ? { alwaysOutputData: true } : {}),
    ...(node.retryOnFail ? { retryOnFail: true, maxTries: node.maxTries, waitBetweenTries: 1000 } : {}),
  };
  if (p.operation === 'read') {
    return { ...common, parameters: { method: 'GET', url: `=${mockBase}/sheets/read?tab={{ ${tab} }}`, options: {} } };
  }
  const values = Object.entries(p.columns.value).map(([k, v]) => `${JSON.stringify(k)}: ${exprToJs(v)}`).join(', ');
  const body = `={{ JSON.stringify({ op: ${JSON.stringify(p.operation)}, tab: ${tab}, matchOn: ${JSON.stringify(p.columns.matchingColumns[0])}, values: { ${values} } }) }}`;
  return { ...common, parameters: { method: 'POST', url: `${mockBase}/sheets/write`, sendBody: true, specifyBody: 'json', jsonBody: body, options: {} } };
}

function transformWorkflow(wf, opts) {
  const w = JSON.parse(JSON.stringify(wf));
  w.name = `${w.name} [E2E TEST]`;
  if (opts.id) w.id = opts.id;
  if (opts.settings) w.settings = { ...w.settings, ...opts.settings };
  w.nodes = w.nodes.map((n) => {
    if (n.type === 'n8n-nodes-base.googleSheets') return sheetsToHttp(n, opts.mockBase);
    if (n.type === 'n8n-nodes-base.code' && opts.config[n.name]) {
      return { ...n, parameters: { ...n.parameters, jsCode: setConfig(n.parameters.jsCode, opts.config[n.name]) } };
    }
    if (n.type === 'n8n-nodes-base.httpRequest' && n.parameters.nodeCredentialType === 'googleDocsOAuth2Api') {
      const parameters = { ...n.parameters, authentication: 'none' };
      delete parameters.nodeCredentialType;
      const copy = { ...n, parameters };
      delete copy.credentials;
      return copy;
    }
    if (n.credentials) {
      const credentials = {};
      for (const [type, ref] of Object.entries(n.credentials)) credentials[type] = opts.credentials[type] || ref;
      return { ...n, credentials };
    }
    return n;
  });
  if (opts.webhook) {
    const name = 'E2E Test Webhook';
    w.nodes.push({
      name, id: crypto.randomUUID(), type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-240, -400],
      webhookId: crypto.randomUUID(),
      parameters: { httpMethod: 'POST', path: opts.webhook.path, responseMode: 'lastNode', options: {} },
    });
    w.connections[name] = { main: [[{ node: opts.webhook.target, type: 'main', index: 0 }]] };
  }
  return w;
}

module.exports = { transformWorkflow, setConfig, exprToJs };
