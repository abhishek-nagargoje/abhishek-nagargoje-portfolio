// @mode each
// @lib common,article
// Validates the article returned by Gemini Call 2 or by the reviser.
const ctx = $('Article Request').item.json.ctx;
const c = ctx.config;
const g = readGemini($json);
const problems = [];
let a = null;
if (g.ok) {
  const j = extractJson(g.text);
  if (!j.ok) problems.push(j.error); else a = j.value;
} else if (['PERMANENT', 'TRANSIENT', 'API_ERROR'].includes(g.kind)) {
  setOutcome(ctx, 'ERROR', ctx.article_kind === 'REVISION' ? 'ARTICLE_REVISION' : 'ARTICLE_GENERATION', g.error, g.kind === 'TRANSIENT');
  return { json: { ctx, route: 'FAIL' } };
} else {
  problems.push(g.error + (g.kind === 'TRUNCATED' ? ' (output was cut off before the JSON was complete)' : ''));
}
const warnings = [];
if (a && typeof a === 'object' && !Array.isArray(a)) {
  const s = (v) => typeof v === 'string' && v.trim().length > 0;
  ['Article_Title', 'SEO_Title', 'H1', 'Meta_Description', 'Excerpt', 'Article_Markdown'].forEach((f) => { if (!s(a[f])) problems.push('missing or empty "' + f + '"'); });
  if (s(a.Article_Markdown)) {
    // A single "# " heading in the body is demoted; the document title is the only H1.
    a.Article_Markdown = a.Article_Markdown.replace(/^#\s+(.+)$/gm, (m, t, off) => (off === 0 && parseInline(t).text.trim() === parseInline(a.H1 || '').text.trim()) ? '' : '## ' + t).trim();
    const h2 = (a.Article_Markdown.match(/^##\s+\S/gm) || []).length;
    if (h2 < 3) problems.push('Article_Markdown must contain at least three "## " (H2) sections; found ' + h2);
    if (/\[(insert|add|todo|placeholder)[^\]]*\]|lorem ipsum/i.test(a.Article_Markdown)) problems.push('Article_Markdown contains placeholder text');
  }
  if (s(a.Meta_Description) && a.Meta_Description.length > 165) problems.push('Meta_Description is ' + a.Meta_Description.length + ' characters; maximum 160');
  if (s(a.SEO_Title) && a.SEO_Title.length > 70) problems.push('SEO_Title is ' + a.SEO_Title.length + ' characters; maximum 60-65');
  a.URL_Slug = slugify(a.URL_Slug || a.H1 || a.Article_Title);
  if (!a.URL_Slug) problems.push('URL_Slug is empty');
  a.FAQs = Array.isArray(a.FAQs) ? a.FAQs.filter((f) => f && s(f.question) && s(f.answer)) : [];
  a.External_Sources = Array.isArray(a.External_Sources) ? a.External_Sources : [];
  a.Internal_Link_Suggestions = Array.isArray(a.Internal_Link_Suggestions) ? a.Internal_Link_Suggestions : [];
  a.Verified_Brand_Facts_Used = Array.isArray(a.Verified_Brand_Facts_Used) ? a.Verified_Brand_Facts_Used : [];
  if (s(a.Article_Markdown)) {
    const words = countWords(plainFromMarkdown(a.Article_Markdown));
    const range = (ctx.prompt && ctx.prompt.target_word_range) || {};
    const min = Math.max(300, Math.min(Number(range.min) || c.target_min_words, c.target_min_words));
    if (words < Math.round(min * 0.6)) problems.push('article body has only ' + words + ' words; the brief requires about ' + min + '+ (likely incomplete)');
    if (words > Math.round(Math.max(Number(range.max) || c.target_max_words, c.target_max_words) * 1.6)) problems.push('article body has ' + words + ' words, far above the brief range');
    a.Word_Count = words;
  }
} else if (!problems.length) {
  problems.push('model output is not a JSON object');
}
if (problems.length) {
  if (ctx.gemini.retries < 1) {
    ctx.gemini.request = correctiveRequest(ctx.gemini.request, g.text, problems);
    ctx.gemini.retries += 1;
    return { json: { ctx, route: 'RETRY' } };
  }
  setOutcome(ctx, 'REVIEW_REQUIRED', ctx.article_kind === 'REVISION' ? 'ARTICLE_REVISION' : 'ARTICLE_GENERATION',
    'Article output was invalid after one corrective retry (attempt ' + ctx.attempt + '): ' + problems.join('; '), false);
  return { json: { ctx, route: 'FAIL' } };
}

// Link and fact integrity (deterministic findings feed the editorial check).
const verified = new Set(ctx.links.verified_internal.map((l) => l.url));
const known = new Set(ctx.rag.knowledge_ids);
const integrity = { unverified_internal_links: [], invalid_external_sources: [], unknown_fact_ids: [], dropped_link_suggestions: [] };
for (const l of markdownLinks(a.Article_Markdown)) {
  const p = parseUrl(l.url);
  if (p && hostAllowed(p.host, c.allowed_target_domains) && !verified.has(normalizeUrl(l.url))) integrity.unverified_internal_links.push(l.url);
}
a.Internal_Link_Suggestions = a.Internal_Link_Suggestions.filter((l) => {
  const keep = l && verified.has(normalizeUrl(l.url));
  if (!keep) integrity.dropped_link_suggestions.push(asText(l && l.url));
  return keep;
}).map((l) => ({ url: normalizeUrl(l.url), anchor_text: asText(l.anchor_text), context: asText(l.context) }));
a.External_Sources = a.External_Sources.filter((src) => {
  const p = src && parseUrl(src.url);
  const ok = p && p.protocol === 'https' && asText(src.title);
  if (!ok) integrity.invalid_external_sources.push(asText(src && src.url) || '(missing url)');
  return ok;
});
a.Verified_Brand_Facts_Used.forEach((f) => { if (!f || !known.has(asText(f.knowledge_id))) integrity.unknown_fact_ids.push(asText(f && f.knowledge_id)); });

const k = ctx.keyword;
const article = Object.assign({
  Article_ID: ctx.job.article_id, Keyword_ID: k.Keyword_ID, Target_Page_URL: k.Target_Page_URL,
  Primary_Keyword: k.Primary_Keyword, Supporting_Keywords: k.Supporting_Keywords,
}, {
  Article_Title: asText(a.Article_Title), SEO_Title: asText(a.SEO_Title), H1: asText(a.H1), Meta_Description: asText(a.Meta_Description),
  URL_Slug: a.URL_Slug, Excerpt: asText(a.Excerpt), Article_Markdown: a.Article_Markdown, FAQs: a.FAQs,
  Internal_Link_Suggestions: a.Internal_Link_Suggestions, External_Sources: a.External_Sources,
  Verified_Brand_Facts_Used: a.Verified_Brand_Facts_Used, Word_Count: a.Word_Count,
});
ctx.article = article;
ctx.article_integrity = integrity;
ctx.article_meta = { attempt: ctx.attempt, kind: ctx.article_kind, corrective_retries: ctx.gemini.retries, usage: g.usage, model_version: g.modelVersion, warnings };
ctx.check_text = buildCheckText(article);
ctx.check_word_count = countWords(ctx.check_text);
// Reports from earlier attempts are never reused for this text.
ctx.editorial = null;
ctx.plagiarism = null;
ctx.gemini = null;
ctx.progress_status = 'ARTICLE_GENERATED';
return { json: { ctx, route: 'VALID' } };
