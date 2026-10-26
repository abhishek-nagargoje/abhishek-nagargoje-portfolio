// Loads tools/code/lib/*.js exactly the way build_workflows.js inlines them into
// n8n Code nodes (concatenated, export blocks stripped), inside a VM context.
const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, '..', '..', 'tools', 'code', 'lib');

function stripExports(src) {
  const i = src.indexOf('/* @exports */');
  return i === -1 ? src : src.slice(0, i);
}

function exportedNames(src) {
  const i = src.indexOf('/* @exports */');
  if (i === -1) return [];
  const block = src.slice(i).match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  return block ? block[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function loadLibs(names) {
  const sources = names.map((n) => fs.readFileSync(path.join(LIB_DIR, `${n}.js`), 'utf8'));
  const code = sources.map(stripExports).join('\n');
  const exported = sources.flatMap(exportedNames);
  // Same realm as the tests (a VM context would create foreign Array prototypes).
  // Globals that n8n's task-runner sandbox does NOT provide are shadowed with
  // undefined, so a library that depends on them fails here as it would in n8n.
  const unavailable = ['URL', 'URLSearchParams', 'structuredClone', 'fetch', 'require', 'process'];
  return new Function(...unavailable, `${code}\n;return { ${exported.join(', ')} };`)();
}

module.exports = { loadLibs, stripExports, exportedNames };
