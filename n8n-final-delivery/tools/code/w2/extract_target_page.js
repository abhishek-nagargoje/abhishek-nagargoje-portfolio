// @mode each
// @lib common
// Extracts title, meta description, canonical, headings, main text and
// internal links from the fetched HTML using plain parsing (no external
// libraries). A page is only "analysed" if real body text was retrieved.
const ctx = $('Start Generation').item.json.ctx;
const c = ctx.config;
const url = ctx.keyword.Target_Page_URL;
const page = { url, ok: false, limitations: [] };

const decode = (s) => String(s || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&#x27;/gi, "'").replace(/&rsquo;|&lsquo;/gi, "'").replace(/&rdquo;|&ldquo;/gi, '"')
  .replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—').replace(/&hellip;/gi, '…')
  .replace(/&#(\d+);/g, (m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; });
const stripTags = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : ''; };

const fail = httpFailure($json);
const status = Number($json.statusCode || 0);
const headers = $json.headers || {};
const ctype = asText(headers['content-type'] || headers['Content-Type']);
let html = typeof $json.body === 'string' ? $json.body : (typeof $json.data === 'string' ? $json.data : '');

if (fail) {
  page.error = 'Target page could not be fetched: ' + fail.message;
  page.retryable = isTransientCode(fail.code, fail.message);
} else if (status < 200 || status >= 300) {
  page.error = 'Target page returned HTTP ' + status;
  page.retryable = status >= 500 || status === 429;
} else if (ctype && !/html|xml/i.test(ctype)) {
  page.error = 'Target page is not HTML (content-type ' + ctype + ')';
} else if (!html || !html.trim()) {
  page.error = 'Target page returned an empty response body';
} else {
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const head = (/<head[\s\S]*?<\/head>/i.exec(html) || [''])[0];
  page.title = stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const n = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    if (n === 'description' && !page.meta_description) page.meta_description = attr(tag, 'content').trim();
    if (n === 'og:title' && !page.og_title) page.og_title = attr(tag, 'content').trim();
    if (n === 'robots') page.robots = attr(tag, 'content').trim();
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (/\bcanonical\b/i.test(attr(tag, 'rel'))) { page.canonical_url = resolveUrl(attr(tag, 'href'), url); break; }
  }
  let body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) || [null, html])[1];
  body = body.replace(/<(script|style|noscript|svg|template|iframe|canvas|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ');
  const mainMatch = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body) || /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body);
  let main = mainMatch ? mainMatch[1] : body;
  if (!mainMatch) page.limitations.push('No <main>/<article> element; navigation/header/footer were removed heuristically');
  const headings = [];
  const hre = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm;
  while ((hm = hre.exec(body)) && headings.length < 60) { const t = stripTags(hm[2]); if (t) headings.push({ level: Number(hm[1]), text: t }); }
  page.h1 = headings.filter((h) => h.level === 1).map((h) => h.text);
  page.headings = headings;
  const links = new Map();
  const are = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = are.exec(body)) && links.size < 120) {
    const abs = resolveUrl(attr(am[1], 'href'), url);
    const p = parseUrl(abs);
    if (!p || !hostAllowed(p.host, c.allowed_target_domains)) continue;
    const n = normalizeUrl(abs.replace(/#.*$/, ''));
    if (!links.has(n)) links.set(n, { url: n, anchor_text: truncate(stripTags(am[2]), 120) });
  }
  page.internal_links = [...links.values()].slice(0, 80);
  main = main.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = stripTags(main.replace(/<\/(p|div|li|h[1-6]|tr|section|br)\s*>/gi, '\n'));
  page.word_count = countWordsSimple(text);
  page.main_text_excerpt = truncate(text, 12000);
  page.main_text_truncated = text.length > 12000;
  const jsShell = /id=["'](root|__next|app|__nuxt)["']|data-reactroot|ng-app|window\.__NUXT__|__NEXT_DATA__|enable javascript/i.test(html);
  if (page.word_count < c.page_min_words) {
    page.error = 'Only ' + page.word_count + ' words of body text were retrieved (minimum ' + c.page_min_words + ')' +
      (jsShell ? '. The page appears to require JavaScript rendering, which this workflow does not perform' : '');
    if (jsShell) page.limitations.push('JavaScript rendering required but unavailable');
  } else {
    page.ok = true;
    if (jsShell) page.limitations.push('Page uses a JavaScript framework; content rendered only client-side may be missing');
  }
  if (page.robots && /noindex/i.test(page.robots)) page.limitations.push('Target page has robots "' + page.robots + '"');
  if (page.canonical_url && normalizeUrl(page.canonical_url) !== normalizeUrl(url)) page.limitations.push('Canonical URL differs from target URL: ' + page.canonical_url);
}
function countWordsSimple(t) { const m = String(t || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu); return m ? m.length : 0; }

page.http_status = status || null;
ctx.page = page;
if (!page.ok) {
  setOutcome(ctx, page.retryable ? 'ERROR' : 'REVIEW_REQUIRED', 'PAGE_ANALYSIS', page.error, !!page.retryable);
}
return { json: { ctx, ok: page.ok } };
