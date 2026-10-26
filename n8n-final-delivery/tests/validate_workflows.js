// Structural validation of the three workflow exports.
// Usage: node tests/validate_workflows.js [path/to/n8n-nodes-base/dist/types/nodes.json ...]
// With node registries supplied (one per n8n version), node types, type
// versions and top-level parameter names are checked against the REAL node
// definitions of those n8n versions.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'workflows');
const FILES = ['01_Brand_RAG_Ingestion.json', '02_SEO_Article_Automation.json', '03_Error_Recovery.json', '02_SEO_Article_Automation_Gemini_Review.json'];
const registries = process.argv.slice(2).map((p) => ({ path: p, nodes: JSON.parse(fs.readFileSync(p, 'utf8')) }));
const CRED_TYPES = { postgres: 'SEO PostgreSQL', googleSheetsOAuth2Api: 'Google Sheets account', googleDocsOAuth2Api: 'Google Docs account',
  googlePalmApi: 'Google Gemini(PaLM) Api account', httpCustomAuth: 'DupliChecker API' };
const TRIGGERS = new Set(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.errorTrigger']);
// Nodes that are allowed to end a branch.
const TERMINALS = {
  '01_Brand_RAG_Ingestion.json': ['Ingestion Result'],
  '02_SEO_Article_Automation.json': ['No Eligible Keywords', 'Mark Invalid Keyword Rows', 'Mark Skipped Duplicates', 'Nothing Claimed', 'Final Result'],
  '03_Error_Recovery.json': ['Recovery Result', 'No Recovery Needed'],
  '02_SEO_Article_Automation_Gemini_Review.json': ['No Eligible Keywords', 'Mark Invalid Keyword Rows', 'Mark Skipped Duplicates', 'Nothing Claimed', 'Final Result'],
};
// Every cycle must pass through one of these bounded decision points.
const LOOP_GUARDS = {
  'Loop Over Records': 'SplitInBatches ends when all records are processed',
  'Prompt Output Route': 'RETRY only while ctx.gemini.retries < 1',
  'Article Output Route': 'RETRY only while ctx.gemini.retries < 1',
  'Editorial Report Route': 'RETRY only while ctx.gemini.retries < 1',
  'Poll Route': 'PENDING only while poll_count < plagiarism_max_polls',
  'Originality Review Route': 'RETRY only while ctx.gemini.retries < 1',
  'Decision Route': 'REVISE only while attempt < max_attempts (also enforced in PostgreSQL)',
  'Use Stored Master Doc': 'document creation bounded to one per execution (Create Master Doc Request)',
};
let errors = 0;
const err = (f, m) => { errors++; console.log('  ERROR [' + f + '] ' + m); };
const ok = (m) => console.log('  ok   ' + m);

for (const file of FILES) {
  console.log('\n' + file);
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  let wf;
  try { wf = JSON.parse(raw); ok('valid JSON (' + raw.length + ' bytes)'); } catch (e) { err(file, 'invalid JSON: ' + e.message); continue; }
  for (const k of ['name', 'nodes', 'connections', 'settings']) if (!(k in wf)) err(file, 'missing top-level key ' + k);
  if (wf.active !== false) err(file, 'workflow must be inactive on import');
  if (wf.settings.executionOrder !== 'v1') err(file, 'executionOrder must be v1');
  if (wf.settings.timezone !== 'Asia/Kolkata') err(file, 'timezone must be Asia/Kolkata');
  const names = new Map();
  const ids = new Set();
  wf.nodes.forEach((n) => {
    if (names.has(n.name)) err(file, 'duplicate node name ' + n.name); names.set(n.name, n);
    if (ids.has(n.id)) err(file, 'duplicate node id ' + n.id); ids.add(n.id);
    if (!Array.isArray(n.position) || n.position.length !== 2) err(file, 'bad position on ' + n.name);
  });
  ok(wf.nodes.length + ' nodes, unique names and ids');

  // --- node types / versions / parameters against real registries
  for (const reg of registries) {
    let bad = 0;
    for (const n of wf.nodes) {
      const short = n.type.replace(/^n8n-nodes-base\./, '');
      const defs = reg.nodes.filter((d) => d.name === short || d.name === n.type);
      const def = defs.find((d) => (Array.isArray(d.version) ? d.version : [d.version]).includes(n.typeVersion));
      if (!def) { bad++; err(file, n.name + ': ' + n.type + ' v' + n.typeVersion + ' not found in ' + reg.path); continue; }
      const propNames = new Set(def.properties.map((p) => p.name));
      for (const key of Object.keys(n.parameters || {})) if (!propNames.has(key)) { bad++; err(file, n.name + ': parameter "' + key + '" is not a property of ' + n.type + ' v' + n.typeVersion); }
      for (const ct of Object.keys(n.credentials || {})) {
        const allowed = (def.credentials || []).map((c) => c.name);
        const generic = n.parameters.authentication === 'predefinedCredentialType' || n.parameters.authentication === 'genericCredentialType';
        if (!allowed.includes(ct) && !generic) { bad++; err(file, n.name + ': credential type ' + ct + ' not accepted by ' + n.type); }
      }
    }
    if (!bad) ok('all node types, versions and parameter names exist in ' + reg.path.split('/node_modules/')[0].split('/').pop());
  }

  // --- credentials
  for (const n of wf.nodes) {
    for (const [type, ref] of Object.entries(n.credentials || {})) {
      if (!(type in CRED_TYPES)) err(file, n.name + ': unexpected credential type ' + type);
      if (!ref || ref.id !== null || ref.name !== CRED_TYPES[type]) err(file, n.name + ': credential reference must be {id:null,name:"' + CRED_TYPES[type] + '"}');
    }
    if (n.type === 'n8n-nodes-base.postgres' && !(n.credentials && n.credentials.postgres)) err(file, n.name + ': Postgres node without credential');
    if (n.type === 'n8n-nodes-base.googleSheets' && !(n.credentials && n.credentials.googleSheetsOAuth2Api)) err(file, n.name + ': Sheets node without credential');
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const a = n.parameters.authentication;
      if (a === 'predefinedCredentialType' && !(n.credentials && n.credentials[n.parameters.nodeCredentialType])) err(file, n.name + ': predefined credential not attached');
      if (a === 'genericCredentialType' && !(n.credentials && n.credentials[n.parameters.genericAuthType])) err(file, n.name + ': generic credential not attached');
    }
  }
  ok('credential references are name-based (id null) and attached where required');

  // --- connections
  const incoming = new Map(wf.nodes.map((n) => [n.name, 0]));
  const outputsUsed = new Map();
  for (const [from, c] of Object.entries(wf.connections)) {
    if (!names.has(from)) { err(file, 'connection from missing node ' + from); continue; }
    const fn = names.get(from);
    const maxOut = fn.type.endsWith('.if') ? 2 : fn.type.endsWith('.splitInBatches') ? 2 : fn.type.endsWith('.switch') ? fn.parameters.rules.values.length : 1;
    if (c.main.length > maxOut) err(file, from + ' uses ' + c.main.length + ' outputs but has ' + maxOut);
    c.main.forEach((targets, idx) => {
      if (!targets.length) err(file, from + ' output ' + idx + ' has no connection');
      targets.forEach((t) => { if (!names.has(t.node)) err(file, from + ' -> missing node ' + t.node); else incoming.set(t.node, incoming.get(t.node) + 1); });
    });
    outputsUsed.set(from, c.main.length);
    if (fn.type.endsWith('.if') && c.main.length !== 2) err(file, 'IF ' + from + ' must connect both branches');
    if (fn.type.endsWith('.switch') && c.main.length !== maxOut) err(file, 'Switch ' + from + ' must connect all ' + maxOut + ' outputs');
    if (fn.type.endsWith('.switch')) {
      const fb = fn.parameters.options && fn.parameters.options.fallbackOutput;
      if (!(Number.isInteger(fb) && fb >= 0 && fb < maxOut)) err(file, 'Switch ' + from + ' must route unmatched items to an existing output');
    }
  }
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.stickyNote') continue;
    if (!TRIGGERS.has(n.type) && incoming.get(n.name) === 0) err(file, 'node without input: ' + n.name);
    if (!outputsUsed.has(n.name) && !TERMINALS[file].includes(n.name)) err(file, 'unexpected dead end: ' + n.name);
  }
  // n8n's v1 execution order runs sibling branches one after another in canvas
  // order, so a fan-out must never let a side branch write state the main
  // path also writes. Only these independent side branches are allowed.
  const FANOUT_OK = { 'Validate Target URL and Keyword': 'Expand Invalid Rows (other rows only)', 'Claim Processing Record': 'Expand Skipped Duplicates (other rows only)' };
  for (const [from, c] of Object.entries(wf.connections)) c.main.forEach((ts) => {
    if (ts.length > 1 && !FANOUT_OK[from]) err(file, 'fan-out from ' + from + ' to ' + ts.map((x) => x.node).join(', ') + ' (execution-order hazard)');
  });
  ok('all connections reference existing nodes; every IF/Switch output is connected; no orphan nodes');

  // --- cycles must contain a bounded guard
  const adj = new Map(wf.nodes.map((n) => [n.name, []]));
  for (const [from, c] of Object.entries(wf.connections)) c.main.forEach((ts) => ts.forEach((t) => adj.get(from).push(t.node)));
  const index = new Map(); const low = new Map(); const stack = []; const on = new Set(); let i = 0; const sccs = [];
  const strong = (v) => { index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of adj.get(v)) { if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w))); }
    if (low.get(v) === index.get(v)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v); if (comp.length > 1) sccs.push(comp); } };
  for (const n of adj.keys()) if (!index.has(n)) strong(n);
  sccs.forEach((comp) => {
    const guards = comp.filter((n) => LOOP_GUARDS[n]);
    if (!guards.length) err(file, 'cycle without a bounded guard: ' + comp.join(' -> '));
    else ok('loop {' + comp.length + ' nodes} bounded by: ' + guards.map((g) => g + ' (' + LOOP_GUARDS[g] + ')').join('; '));
  });

  // --- expressions, node references, code syntax
  const allExpr = [];
  const walk = (v, where) => {
    if (typeof v === 'string') { if (v.startsWith('=')) allExpr.push({ where, text: v }); }
    else if (Array.isArray(v)) v.forEach((x, k) => walk(x, where + '[' + k + ']'));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, where + '.' + k));
  };
  wf.nodes.forEach((n) => walk(n.parameters, n.name));
  for (const e of allExpr) {
    const parts = e.text.slice(1).split('{{');
    for (const seg of parts.slice(1)) {
      const close = seg.indexOf('}}');
      if (close < 0) { err(file, e.where + ': unterminated expression'); continue; }
      const body = seg.slice(0, close);
      try { new vm.Script('(function($json,$,$execution,$now){ return (' + body + '); })'); } catch (x) { err(file, e.where + ': expression syntax error: ' + x.message + ' :: ' + body.slice(0, 120)); }
    }
  }
  const refRe = /\$\('([^']+)'\)/g;
  wf.nodes.forEach((n) => {
    const text = JSON.stringify(n.parameters);
    let m; while ((m = refRe.exec(text))) if (!names.has(m[1])) err(file, n.name + ' references missing node $(\'' + m[1] + '\')');
    if (n.type === 'n8n-nodes-base.code') {
      try { new vm.Script('(async function(){\n' + n.parameters.jsCode + '\n})'); } catch (x) { err(file, n.name + ': JavaScript syntax error: ' + x.message); }
      if (/\brequire\s*\(|\bprocess\.env|\$env\b/.test(n.parameters.jsCode)) err(file, n.name + ': uses require/process.env/$env (not available by default)');
    }
    if (n.type === 'n8n-nodes-base.postgres') {
      const q = n.parameters.query;
      if (/\{\{/.test(q)) err(file, n.name + ': SQL text contains an n8n expression (must be parameterised)');
      if (/'\$[0-9]+'/.test(q)) err(file, n.name + ": SQL contains a quoted '$n' literal");
      const maxParam = Math.max(0, ...[...q.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
      const repl = n.parameters.options && n.parameters.options.queryReplacement;
      if (maxParam > 0 && !repl) err(file, n.name + ': uses $' + maxParam + ' but has no query parameters');
      if (repl) {
        // count top-level array elements
        const inner = repl.replace(/^=\{\{\s*\[/, '').replace(/\]\s*\}\}$/, '');
        let depth = 0, count = 1, str = null;
        for (let k = 0; k < inner.length; k++) { const ch = inner[k];
          if (str) { if (ch === '\\') k++; else if (ch === str) str = null; continue; }
          if (ch === '\'' || ch === '"' || ch === '`') str = ch; else if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; else if (ch === ',' && depth === 0) count++; }
        if (count !== maxParam) err(file, n.name + ': SQL uses ' + maxParam + ' parameters but ' + count + ' are supplied');
      }
    }
    if (n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation !== 'read') {
      if (!n.parameters.options || n.parameters.options.handlingExtraData !== 'ignoreIt') err(file, n.name + ': Sheets write must set handlingExtraData = ignoreIt (never adds columns)');
      if (n.parameters.columns.mappingMode !== 'autoMapInputData' || n.parameters.columns.matchingColumns.length !== 1) err(file, n.name + ': unexpected Sheets mapping');
    }
  });
  ok(allExpr.length + ' expressions parse; all $(\'Node\') references exist; Code nodes compile; SQL is parameterised');

  if (file.includes('Gemini_Review')) {
    const dupli = wf.nodes.filter((n) => (n.credentials && n.credentials.httpCustomAuth) || /duplichecker/i.test(JSON.stringify(n.parameters.url || '') + JSON.stringify(n.parameters.options || {})) || /DupliChecker/.test(n.name));
    if (dupli.length) err(file, 'DupliChecker dependency left in: ' + dupli.map((n) => n.name).join(', '));
    else ok('no DupliChecker node, URL or credential remains');
  }
  // --- secrets and hard-coded identifiers
  if (/AIza[0-9A-Za-z_\-]{20,}/.test(raw)) err(file, 'looks like a Google API key');
  if (/"password"\s*:/.test(raw) || /localtest/.test(raw)) err(file, 'password-like content found');
  if (/"token"\s*:\s*"[A-Za-z0-9]{12,}"/.test(raw)) err(file, 'token-like content found');
  if (/KARGAR/i.test(raw)) err(file, 'KARGAR content must never be used');
  const ssIds = raw.match(/171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg/g) || [];
  ok('no secrets found; spreadsheet ID literal occurrences: ' + ssIds.length + (ssIds.length ? ' (Configuration node only)' : ''));
  const cfgNodes = wf.nodes.filter((n) => JSON.stringify(n.parameters).includes('171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg')).map((n) => n.name);
  if (cfgNodes.some((n) => n !== 'Configuration')) err(file, 'spreadsheet ID duplicated outside the Configuration node: ' + cfgNodes.join(', '));
  const sched = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  sched.forEach((s) => { if (!s.disabled) err(file, s.name + ' must be disabled by default'); });
  if (sched.length) ok('schedule trigger(s) disabled by default: ' + sched.map((s) => s.name).join(', '));
}
console.log('\n' + (errors ? errors + ' ERROR(S)' : 'ALL STRUCTURAL CHECKS PASSED'));
process.exit(errors ? 1 : 0);
