// @include common
// Builds the target-page analysis input from the HTTP response and the HTML
// extraction. Never fabricates: if meaningful content was not retrieved the
// outcome is REVIEW (content/access problem) or TRANSIENT (server/network).
const ctx = $('Keyword Context').first(0).json;
const cfg = ctx.config;
const res = $('Fetch Target Page').first(0).json;
const x = $input.first().json;
const status = Number(res.statusCode || 0);
const headers = res.headers || {};
const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
// HTTP Request (fullResponse + text format) stores the body in "data"
const rawBody = res.data !== undefined ? res.data : res.body;
const html = typeof rawBody === 'string' ? rawBody : '';
const arr = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map((s) => asText(s).replace(/\s+/g, ' ')).filter(Boolean);
const mainText = asText(Array.isArray(x.main_text) ? x.main_text.join(' ') : x.main_text).replace(/\s+/g, ' ');
const bodyWords = wordCount(mainText);

let outcome = 'OK';
let reason = '';
if (res.error || status === 0) {
  outcome = 'TRANSIENT';
  reason = `PAGE_FETCH_FAILED: ${scrubSecrets(asText(res.error && (res.error.message || res.error)) || 'no response')}`;
} else if (status >= 500 || status === 429) {
  outcome = 'TRANSIENT';
  reason = `PAGE_HTTP_${status}: target page server error`;
} else if (status >= 400) {
  outcome = 'REVIEW';
  reason = `PAGE_HTTP_${status}: target page is not accessible (check URL, authentication or robots/firewall rules - access controls are not bypassed)`;
} else if (contentType && !/html|xml/i.test(contentType)) {
  outcome = 'REVIEW';
  reason = `PAGE_NOT_HTML: content-type ${contentType}`;
} else if (bodyWords < cfg.PAGE_MIN_WORDS) {
  const jsShell = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>|enable javascript|__NEXT_DATA__|window\.__INITIAL_STATE__/i.test(html);
  outcome = 'REVIEW';
  reason = jsShell
    ? `PAGE_REQUIRES_JS_RENDERING: only ${bodyWords} words in the server HTML; the page appears to be rendered client-side. Configure server-side rendering/prerendering for the page or supply its content manually.`
    : `PAGE_CONTENT_INSUFFICIENT: only ${bodyWords} words of main content retrieved (minimum ${cfg.PAGE_MIN_WORDS})`;
}
if (outcome === 'OK' && /noindex/i.test(String(headers['x-robots-tag'] || '') + ' ' + arr(x.meta_robots).join(' '))) {
  reason = 'WARNING: target page is marked noindex';
}

// internal links: absolute, same site, http(s), de-duplicated
const internalLinks = [];
const seen = new Set();
const hrefs = arr(x.links);
const texts = Array.isArray(x.link_texts) ? x.link_texts : [];
hrefs.forEach((href, i) => {
  const u = parseUrl(href, ctx.target_page_url); // null for mailto:, tel:, javascript:, malformed hrefs
  if (!u || !/^https?:$/.test(u.protocol) || !sameSite(u.hostname, ctx.site_host)) return;
  const n = normalizeUrl(u.href);
  if (seen.has(n) || n === ctx.normalized_url) return;
  seen.add(n);
  internalLinks.push({ url: n, anchor: asText(texts[i]).replace(/\s+/g, ' ').slice(0, 120) });
});

const page = {
  url: ctx.target_page_url,
  final_url: res.headers && res.headers['content-location'] ? res.headers['content-location'] : ctx.target_page_url,
  http_status: status,
  title: asText(x.title),
  meta_description: asText(x.meta_description),
  canonical_url: asText(x.canonical),
  og_title: asText(x.og_title),
  h1: arr(x.h1).slice(0, 5),
  h2: arr(x.h2).slice(0, 40),
  h3: arr(x.h3).slice(0, 60),
  ctas: [...new Set(arr(x.ctas))].slice(0, 15),
  internal_links: internalLinks.slice(0, 60),
  main_text_excerpt: truncate(mainText, 12000),
  main_text_words: bodyWords,
  retrieved_at: new Date().toISOString(),
};
return [{ json: {
  page_outcome: outcome,
  page_ok: outcome === 'OK',
  page,
  warning: outcome === 'OK' ? reason : '',
  review_reason: outcome === 'REVIEW' ? reason : '',
  review_failed_conditions: outcome === 'REVIEW' ? [reason.split(':')[0]] : [],
  error_class: outcome === 'TRANSIENT' ? 'API_TRANSIENT' : undefined,
  retryable: outcome === 'TRANSIENT' ? true : undefined,
  error: outcome === 'TRANSIENT' ? reason : undefined,
} }];
