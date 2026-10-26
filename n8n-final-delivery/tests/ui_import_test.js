// Real editor test: imports each workflow with the n8n editor's
// "Import from File" action (Playwright + Chromium), saves it, then checks via
// the n8n REST API that every node's credential was bound by name.
// Usage: N8N_BIN=... WORK=... node tests/ui_import_test.js   (n8n must not already run on port 5679)
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5690;
const BASE = 'http://127.0.0.1:' + PORT;
const OWNER = { email: 'owner@example.com', firstName: 'Test', lastName: 'Owner', password: 'Bench-Passw0rd!' };
const CREDS = [
  { name: 'SEO PostgreSQL', type: 'postgres', data: { host: 'seo-postgres', port: 5432, database: 'seo_content', user: 'seo_n8n', password: 'not-a-real-password', ssl: 'disable' } },
  { name: 'Google Sheets account', type: 'googleSheetsOAuth2Api', data: { clientId: 'dummy', clientSecret: 'dummy' } },
  { name: 'Google Docs account', type: 'googleDocsOAuth2Api', data: { clientId: 'dummy', clientSecret: 'dummy' } },
  { name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi', data: { host: 'https://generativelanguage.googleapis.com', apiKey: 'dummy' } },
  { name: 'DupliChecker API', type: 'httpCustomAuth', data: { json: '{"body":{"token":"dummy"}}' } },
];

async function rest(method, p, body, cookie) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json', 'browser-id': 'bench' }, cookie ? { cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: r.status, json, cookie: r.headers.get('set-cookie') };
}

(async () => {
  const home = path.join(process.env.WORK, 'ui_home');
  fs.rmSync(home, { recursive: true, force: true });
  const env = Object.assign({}, process.env, { N8N_USER_FOLDER: home, N8N_PORT: String(PORT), N8N_LISTEN_ADDRESS: '127.0.0.1', N8N_RUNNERS_BROKER_PORT: '5693', N8N_SECURE_COOKIE: 'false', N8N_LOG_LEVEL: 'warn',
    DB_TYPE: 'sqlite', N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false', N8N_DIAGNOSTICS_ENABLED: 'false', N8N_PERSONALIZATION_ENABLED: 'false' });
  delete env.NODE_PATH; // only needed to resolve Playwright for this script
  const srv = spawn(process.env.N8N_BIN, ['start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => { log += c; }); srv.stderr.on('data', (c) => { log += c; });
  let ok = 0; const fails = [];
  const check = (n, c, info) => { if (c) { ok++; console.log('  PASS', n); } else { fails.push(n); console.log('  FAIL', n, info ? JSON.stringify(info).slice(0, 400) : ''); } };
  try {
    for (let i = 0; i < 120; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) break; } catch (e) { /* starting */ } await new Promise((s) => setTimeout(s, 1000)); }
    let setup;
    for (let i = 0; i < 400; i++) { setup = await rest('POST', '/rest/owner/setup', OWNER).catch((e) => ({ status: 0, json: e.message })); if (setup.status === 200 && setup.json && typeof setup.json === 'object') break; await new Promise((s) => setTimeout(s, 1000)); }
    const cookie = (setup.cookie || '').split(';')[0];
    check('owner created and logged in', setup.status === 200 && cookie, setup.json);
    for (const c of CREDS) { const r = await rest('POST', '/rest/credentials', c, cookie); if (r.status !== 200) console.log('   credential', c.name, r.status, JSON.stringify(r.json).slice(0, 200)); }
    const credList = await rest('GET', '/rest/credentials', null, cookie);
    const credIds = Object.fromEntries((credList.json.data || []).map((c) => [c.name, c.id]));
    check('5 named credentials exist', Object.keys(credIds).length === 5, Object.keys(credIds));

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    // Sign in through the real login form (n8n binds the session to the browser ID).
    await page.goto(BASE + '/signin');
    await page.waitForSelector('input[name="emailOrLdapLoginId"]', { timeout: 120000 });
    await page.fill('input[name="emailOrLdapLoginId"]', OWNER.email);
    await page.fill('input[name="password"]', OWNER.password);
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => !/signin/.test(String(u)), { timeout: 60000 });
    const browserFetch = (p) => page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { 'browser-id': localStorage.getItem('n8n-browserId') || '' } });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, p);
    for (const file of ['01_Brand_RAG_Ingestion.json', '02_SEO_Article_Automation.json', '03_Error_Recovery.json']) {
      const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
      await page.goto(BASE + '/workflow/new');
      await page.waitForSelector('[data-test-id="canvas-wrapper"]', { timeout: 120000 });
      // Same hidden <input type=file> that the "Import from File..." menu entry opens.
      await page.setInputFiles('[data-test-id="workflow-import-input"]', path.join(ROOT, 'workflows', file));
      await page.waitForFunction((n) => document.querySelectorAll('[data-test-id="canvas-node"]').length >= n, wf.nodes.length - 5, { timeout: 120000 });
      const nodeCount = await page.locator('[data-test-id="canvas-node"]').count();
      await page.waitForTimeout(1500);
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(4000);
      const id = /\/workflow\/([A-Za-z0-9]+)/.exec(page.url())[1];
      const saved = await browserFetch('/rest/workflows/' + id);
      const data = saved.json && saved.json.data;
      if (!data) { check(file + ' saved', false, saved); continue; }
      const nodes = data.nodes;
      const refs = nodes.flatMap((n) => Object.entries(n.credentials || {}).map(([t, c]) => ({ node: n.name, type: t, id: c.id, name: c.name })));
      const unbound = refs.filter((r) => !r.id || r.id !== credIds[r.name]);
      console.log('  ' + file + ': ' + nodeCount + ' nodes rendered on canvas, ' + nodes.length + ' saved, ' + refs.length + ' credential references');
      check(file + ' imported via the editor import input with all ' + wf.nodes.length + ' nodes saved', nodes.length === wf.nodes.length, nodes.length);
      check(file + ' every credential bound to the existing credential by name after Save', refs.length > 0 && unbound.length === 0, unbound.slice(0, 5));
      check(file + ' saved inactive', data.active === false);
      await page.screenshot({ path: path.join(process.env.WORK, 'ui_' + file.replace('.json', '.png')) });
    }
    await browser.close();
  } catch (e) {
    fails.push('exception: ' + e.message); console.log('  ERROR', e.message); console.log(log.slice(-2000));
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 3000));
    try { srv.kill('SIGKILL'); } catch (e) { /* already stopped */ }
  }
  console.log('\n' + ok + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
})();
