#!/usr/bin/env node
// Structural validation of the workflow exports against the node definitions
// exported from n8n 2.44.6 (tests/fixtures/n8n_2.44.6_node_definitions_subset.json).
// This is NOT a substitute for importing/executing in n8n; see
// documentation/TESTING_AND_TROUBLESHOOTING.md for the import/execution tests.
// Usage: node tools/validate_workflows.js   (exit code 1 on any error)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'n8n_2.44.6_node_definitions_subset.json'), 'utf8')).nodes;
const FILES = ['01_Brand_RAG_Ingestion.json', '02_SEO_Article_Automation.json', '03_Error_Recovery.json'];

const TRIGGERS = new Set(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.errorTrigger']);
const CRED_TYPES = {
  'n8n-nodes-base.postgres': ['postgres'],
  'n8n-nodes-base.googleSheets': ['googleSheetsOAuth2Api'],
  'n8n-nodes-base.httpRequest': ['httpHeaderAuth', 'httpQueryAuth', 'googleDocsOAuth2Api'],
};
// Every cycle must pass through one of these bounded guards.
const LOOP_GUARDS = {
  'Article Prompt Valid?': 'one correction (Build Prompt Correction Request isExecuted)',
  'Article Structure Valid?': 'one correction (Build Article Correction Request isExecuted)',
  'Editorial Report Valid?': 'one correction per attempt (for_attempt)',
  'Check Attempt Limit': 'MAX_ARTICLE_ATTEMPTS',
  'Plagiarism Report Status': 'PLAGIARISM_MAX_POLLS (buildScanState)',
  'Lock Wait Allowed?': 'DOC_LOCK_MAX_WAITS',
};
const SECRET_PATTERNS = [/AIza[0-9A-Za-z_\-]{20,}/, /Bearer\s+[A-Za-z0-9._\-]{20,}/, /ya29\.[0-9A-Za-z_\-]+/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"(password|apiKey|api_key|token|secret|accessToken|refreshToken)"\s*:\s*"[^"=][^"]{6,}"/i];

// names of all functions exported by tools/code/lib/*.js
const LIB_FUNCTIONS = fs.readdirSync(path.join(ROOT, 'tools', 'code', 'lib')).flatMap((f) => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'code', 'lib', f), 'utf8');
  return [...src.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
});

const errors = [];
const warnings = [];
const err = (wf, msg) => errors.push(`[${wf}] ${msg}`);
const warn = (wf, msg) => warnings.push(`[${wf}] ${msg}`);

function defFor(type, version) {
  return DEFS.find((d) => d.name === type && (Array.isArray(d.version) ? d.version.includes(version) : d.version === version));
}

function propAllowedForVersion(p, version) {
  if (!p.versions) return true;
  return p.versions.some((c) => {
    if (typeof c === 'number') return c === version;
    const cnd = c && c._cnd;
    if (!cnd) return true;
    if (cnd.eq !== undefined) return version === cnd.eq;
    if (cnd.gte !== undefined && cnd.lt !== undefined) return version >= cnd.gte && version < cnd.lt;
    if (cnd.gte !== undefined) return version >= cnd.gte;
    if (cnd.lte !== undefined) return version <= cnd.lte;
    if (cnd.lt !== undefined) return version < cnd.lt;
    if (cnd.between) return version >= cnd.between.from && version <= cnd.between.to;
    return true;
  });
}

function collectStrings(value, out, pathStr) {
  if (typeof value === 'string') out.push({ path: pathStr, value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, out, `${pathStr}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collectStrings(v, out, pathStr ? `${pathStr}.${k}` : k);
  return out;
}

function expressionBodies(str) {
  if (!str.startsWith('=')) return [];
  const bodies = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(str))) bodies.push(m[1]);
  return bodies;
}

function checkJsSyntax(code, wrapAsync) {
  try {
    if (wrapAsync) {
      // eslint-disable-next-line no-new-func
      new Function('$', '$input', '$json', '$execution', '$workflow', 'DateTime', `return (async () => {\n${code}\n})`);
    } else {
      // eslint-disable-next-line no-new-func
      new Function('$', '$input', '$json', '$execution', '$workflow', '$itemIndex', 'DateTime', `return (${code});`);
    }
    return null;
  } catch (e) {
    return e.message;
  }
}

function outputCount(node) {
  const t = node.type;
  let n = 1;
  if (t === 'n8n-nodes-base.if') n = 2;
  if (t === 'n8n-nodes-base.switch') n = node.parameters.rules.values.length + (node.parameters.options && node.parameters.options.fallbackOutput === 'extra' ? 1 : 0);
  if (TRIGGERS.has(t) && t !== 'n8n-nodes-base.executeWorkflowTrigger') n = 1;
  if (node.onError === 'continueErrorOutput') n += 1;
  return n;
}

function findCycles(nodesByName, connections) {
  const adj = {};
  for (const [from, c] of Object.entries(connections)) adj[from] = c.main.flat().map((t) => t.node);
  const cycles = [];
  const stack = [];
  const onStack = new Set();
  const visited = new Set();
  const dfs = (n) => {
    visited.add(n);
    stack.push(n);
    onStack.add(n);
    for (const m of adj[n] || []) {
      if (onStack.has(m)) cycles.push(stack.slice(stack.indexOf(m)).concat(m));
      else if (!visited.has(m)) dfs(m);
    }
    stack.pop();
    onStack.delete(n);
  };
  for (const n of Object.keys(nodesByName)) if (!visited.has(n)) dfs(n);
  return cycles;
}

for (const file of FILES) {
  const wfPath = path.join(ROOT, 'workflows', file);
  let raw;
  let wf;
  try {
    raw = fs.readFileSync(wfPath, 'utf8');
    wf = JSON.parse(raw);
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    continue;
  }
  for (const k of ['name', 'nodes', 'connections', 'settings']) if (!(k in wf)) err(file, `missing top-level key "${k}"`);
  if (wf.active !== false) err(file, 'workflow must be exported inactive (active: false)');
  if (!wf.settings || wf.settings.timezone !== 'Asia/Kolkata') err(file, 'settings.timezone must be Asia/Kolkata');
  if (!wf.settings || wf.settings.executionOrder !== 'v1') err(file, 'settings.executionOrder must be v1');
  for (const p of SECRET_PATTERNS) if (p.test(raw)) err(file, `possible secret matches ${p}`);

  const byName = {};
  const ids = new Set();
  for (const n of wf.nodes) {
    if (byName[n.name]) err(file, `duplicate node name ${n.name}`);
    byName[n.name] = n;
    if (ids.has(n.id)) err(file, `duplicate node id ${n.id}`);
    ids.add(n.id);
    const def = defFor(n.type, n.typeVersion);
    if (!def) {
      err(file, `${n.name}: node type ${n.type} v${n.typeVersion} does not exist in n8n 2.44.6`);
      continue;
    }
    const propNames = new Set(def.properties.filter((p) => propAllowedForVersion(p, n.typeVersion)).map((p) => p.name));
    for (const key of Object.keys(n.parameters || {})) {
      if (!propNames.has(key)) err(file, `${n.name}: parameter "${key}" is not defined for ${n.type} v${n.typeVersion}`);
    }
    // n8n defines several same-named properties under different displayOptions
    // (e.g. "operation" per resource); a value must be valid for at least one.
    const optionUnion = {};
    for (const p of def.properties) {
      if (!p.options || !propAllowedForVersion(p, n.typeVersion)) continue;
      optionUnion[p.name] = (optionUnion[p.name] || new Set());
      p.options.forEach((o) => optionUnion[p.name].add(o));
    }
    for (const [name, allowedValues] of Object.entries(optionUnion)) {
      const v = n.parameters && n.parameters[name];
      if (typeof v === 'string' && !v.startsWith('=') && !allowedValues.has(v)) err(file, `${n.name}: "${name}" = "${v}" is not one of ${[...allowedValues].join('|')}`);
    }
    // credentials
    const allowed = CRED_TYPES[n.type];
    for (const [ctype, ref] of Object.entries(n.credentials || {})) {
      if (!def.credentials.includes(ctype) && !(allowed || []).includes(ctype)) err(file, `${n.name}: credential type ${ctype} not supported by ${n.type}`);
      if (!ref || !ref.id || !ref.name) err(file, `${n.name}: credential reference must have id and name`);
    }
    if (n.type === 'n8n-nodes-base.postgres' && !n.credentials) err(file, `${n.name}: Postgres node without credential`);
    if (n.type === 'n8n-nodes-base.googleSheets' && !n.credentials) err(file, `${n.name}: Google Sheets node without credential`);
    if (n.type === 'n8n-nodes-base.httpRequest' && /googleapis\.com|DOCS_API_BASE/.test(JSON.stringify(n.parameters.url)) && !(n.credentials || {}).googleDocsOAuth2Api) {
      err(file, `${n.name}: Google Docs request without Google Docs OAuth2 credential`);
    }
    if (n.type === 'n8n-nodes-base.httpRequest' && /GEMINI_API_BASE/.test(JSON.stringify(n.parameters.url)) && !(n.credentials || {}).httpHeaderAuth) {
      err(file, `${n.name}: Gemini request without header-auth credential`);
    }

    // expressions + node references
    const strings = collectStrings(n.parameters || {}, [], '');
    for (const s of strings) {
      for (const body of expressionBodies(s.value)) {
        const e = checkJsSyntax(body, false);
        if (e) err(file, `${n.name}: invalid expression at ${s.path}: ${e} :: {{${body.slice(0, 120)}}}`);
      }
      for (const m of s.value.matchAll(/\$\('([^']+)'\)/g)) if (!byName[m[1]] && !wf.nodes.some((x) => x.name === m[1])) err(file, `${n.name}: references unknown node '${m[1]}'`);
      if (/\$\('[^']+'\)\.(first|all|last)\(\)/.test(s.value)) err(file, `${n.name}: $('Node').first()/all()/last() without an explicit output index at ${s.path} (n8n may resolve an error/false branch)`);
    }
    if (n.type === 'n8n-nodes-base.code') {
      const e = checkJsSyntax(n.parameters.jsCode, true);
      if (e) err(file, `${n.name}: Code node syntax error: ${e}`);
      // full-line comments are ignored for the usage checks below
      const js = n.parameters.jsCode.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/\$env\b/.test(js)) err(file, `${n.name}: uses $env (blocked by default in n8n 2.x)`);
      if (/\brequire\(/.test(js)) err(file, `${n.name}: uses require() (needs NODE_FUNCTION_ALLOW_* configuration)`);
      // globals missing from the n8n 2.x JS task-runner VM context
      for (const g of ['new URL(', 'URLSearchParams', 'structuredClone(', 'fetch(', 'process.']) {
        if (js.includes(g)) err(file, `${n.name}: uses "${g}" which is not available in the n8n task-runner sandbox`);
      }
      // Without an explicit output index, n8n picks the output from the first
      // connection path it finds, which can be an empty error/false branch.
      if (/(\$\('[^']+'\)|\$\(\w+\)|\b\w+Node)\.(first|all|last)\(\)/.test(js)) err(file, `${n.name}: node reference .first()/.all()/.last() without an explicit output index`);
      // every shared-library function that is called must be inlined in this node
      for (const fn of LIB_FUNCTIONS) {
        const called = new RegExp(`(^|[^.\\w$])${fn}\\(`).test(js);
        const declared = new RegExp(`function ${fn}\\(|const ${fn} =`).test(js);
        if (called && !declared) err(file, `${n.name}: calls ${fn}() but its library is not included`);
      }
    }
    if (n.type === 'n8n-nodes-base.postgres') {
      const q = n.parameters.query || '';
      const maxParam = Math.max(0, ...[...q.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      const rep = (n.parameters.options || {}).queryReplacement || '';
      const count = rep ? (rep.match(/\?\? null/g) || []).length : 0;
      if (maxParam !== count) err(file, `${n.name}: query uses $1..$${maxParam} but ${count} parameters are supplied`);
      if (/\{\{/.test(q)) err(file, `${n.name}: expressions inside SQL text are not allowed (use query parameters)`);
    }
  }
  // all $('X') references inside code nodes must exist (checked after map is complete)
  for (const n of wf.nodes) {
    const text = n.type === 'n8n-nodes-base.code' ? n.parameters.jsCode : JSON.stringify(n.parameters);
    for (const m of text.matchAll(/\$\('([^']+)'\)/g)) if (!byName[m[1]]) err(file, `${n.name}: references unknown node '${m[1]}'`);
  }

  // connections
  const incoming = {};
  for (const [from, c] of Object.entries(wf.connections)) {
    const src = byName[from];
    if (!src) { err(file, `connection from unknown node ${from}`); continue; }
    const outs = outputCount(src);
    if (c.main.length > outs) err(file, `${from}: has ${c.main.length} connected outputs but only ${outs} exist`);
    c.main.forEach((targets, idx) => {
      for (const t of targets || []) {
        if (!byName[t.node]) err(file, `${from} -> unknown node ${t.node}`);
        incoming[t.node] = (incoming[t.node] || 0) + 1;
      }
      if (src.onError === 'continueErrorOutput' && idx === outs - 1 && (!targets || targets.length === 0)) err(file, `${from}: error output is not connected`);
    });
    if (src.onError === 'continueErrorOutput' && c.main.length < outs) err(file, `${from}: error output is not connected`);
  }
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.stickyNote') continue;
    if (!TRIGGERS.has(n.type) && !incoming[n.name]) err(file, `${n.name}: has no incoming connection (disconnected)`);
    if (n.type === 'n8n-nodes-base.switch' || n.type === 'n8n-nodes-base.if') {
      const outs = (wf.connections[n.name] || { main: [] }).main;
      for (let i = 0; i < outputCount(n); i++) if (!outs[i] || outs[i].length === 0) err(file, `${n.name}: output ${i} is not connected (every branch must lead to a defined state)`);
    }
  }
  // reachability from triggers
  const reach = new Set();
  const queue = wf.nodes.filter((n) => TRIGGERS.has(n.type)).map((n) => n.name);
  while (queue.length) {
    const n = queue.shift();
    if (reach.has(n)) continue;
    reach.add(n);
    for (const t of ((wf.connections[n] || {}).main || []).flat()) queue.push(t.node);
  }
  for (const n of wf.nodes) if (n.type !== 'n8n-nodes-base.stickyNote' && !reach.has(n.name)) err(file, `${n.name}: unreachable from any trigger`);

  // loops must be bounded
  const cycles = findCycles(byName, wf.connections);
  for (const cyc of cycles) {
    const guard = cyc.find((n) => LOOP_GUARDS[n]);
    if (!guard) err(file, `unbounded loop: ${cyc.join(' -> ')}`);
  }
  console.log(`${file}: ${wf.nodes.length} nodes, ${Object.keys(wf.connections).length} connected sources, ${cycles.length} cycle(s) all guarded=${cycles.every((c) => c.some((n) => LOOP_GUARDS[n]))}`);
}

for (const w of warnings) console.log('WARN  ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(errors.length ? `\nSTRUCTURAL VALIDATION FAILED: ${errors.length} error(s)` : '\nSTRUCTURAL VALIDATION PASSED (0 errors)');
process.exit(errors.length ? 1 : 0);
