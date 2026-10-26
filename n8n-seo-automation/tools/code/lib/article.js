// ---- lib/article.js : structural validation and deterministic content checks ----
// Requires lib/common.js (normalizeKeyword, normalizeUrl, sameSite, wordCount, asText).

function extractMarkdownLinks(md) {
  const links = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(String(md || '')))) links.push({ anchor: m[1].trim(), url: m[2].trim() });
  return links;
}

function extractHeadings(md) {
  return String(md || '')
    .split('\n')
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/))
    .filter(Boolean)
    .map((m) => ({ level: m[1].length, text: m[2].trim() }));
}

function markdownToPlain(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

function isHttpUrl(value) {
  const u = parseUrl(String(value ?? ''));
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:');
}

function safeNormalize(url) {
  try {
    return normalizeUrl(url);
  } catch (e) {
    return null;
  }
}

// Validates and normalises a writer/reviser article.
// ctx: { article_id, keyword_id, target_page_url, primary_keyword, supporting_keywords[], site_host }
// allowedInternal: array of URLs that may be linked internally.
// Returns { valid, usable, errors[], warnings[], article }.
function validateArticle(raw, ctx, allowedInternal, config) {
  const errors = [];
  const warnings = [];
  const cfg = config || {};
  if (!raw || typeof raw !== 'object') {
    return { valid: false, usable: false, errors: ['STRUCTURE: article is not a JSON object'], warnings, article: null };
  }
  const a = JSON.parse(JSON.stringify(raw));

  // Primary keyword association is checked BEFORE the identifiers are pinned.
  if (asText(a.Primary_Keyword) && normalizeKeyword(a.Primary_Keyword) !== normalizeKeyword(ctx.primary_keyword)) {
    errors.push(`KEYWORD_MISMATCH: model returned Primary_Keyword "${asText(a.Primary_Keyword)}" but the record keyword is "${ctx.primary_keyword}"`);
  }
  if (asText(a.Target_Page_URL) && safeNormalize(a.Target_Page_URL) !== safeNormalize(ctx.target_page_url)) {
    errors.push(`TARGET_URL_MISMATCH: model returned Target_Page_URL "${asText(a.Target_Page_URL)}"`);
  }
  // Pin identifiers - the model can never change the keyword/URL association.
  a.Article_ID = ctx.article_id;
  a.Keyword_ID = ctx.keyword_id;
  a.Target_Page_URL = ctx.target_page_url;
  a.Primary_Keyword = ctx.primary_keyword;
  a.Supporting_Keywords = ctx.supporting_keywords || [];

  const requiredStrings = ['Article_Title', 'SEO_Title', 'H1', 'Meta_Description', 'URL_Slug', 'Excerpt', 'Article_Markdown'];
  for (const f of requiredStrings) {
    if (typeof a[f] !== 'string' || !a[f].trim()) errors.push(`MISSING_FIELD: ${f} is empty or missing`);
  }
  const requiredArrays = ['Suggested_FAQs', 'Internal_Link_Suggestions', 'External_Sources', 'Verified_Brand_Facts_Used'];
  for (const f of requiredArrays) {
    if (a[f] === undefined || a[f] === null) a[f] = [];
    if (!Array.isArray(a[f])) errors.push(`MISSING_FIELD: ${f} must be an array`);
  }

  const md = typeof a.Article_Markdown === 'string' ? a.Article_Markdown.replace(/\r\n/g, '\n').trim() : '';
  a.Article_Markdown = md;
  const usable = md.length > 0;
  a.Word_Count = wordCount(markdownToPlain(md));
  const minWords = cfg.ARTICLE_MIN_WORDS || 0;
  if (usable && a.Word_Count < minWords) errors.push(`TOO_SHORT: article has ${a.Word_Count} words; minimum configured is ${minWords}`);

  const headings = extractHeadings(md);
  const h1s = headings.filter((h) => h.level === 1);
  const h2s = headings.filter((h) => h.level === 2);
  if (usable && h1s.length === 0) {
    if (asText(a.H1)) a.Article_Markdown = `# ${asText(a.H1)}\n\n${md}`;
    else errors.push('STRUCTURE: Article_Markdown has no H1');
  }
  if (h1s.length > 1) errors.push(`STRUCTURE: Article_Markdown has ${h1s.length} H1 headings; exactly one is required`);
  if (usable && h2s.length < 2) errors.push('STRUCTURE: Article_Markdown needs at least two H2 sections');
  if (/^\s*#{1,6}\s*$/m.test(md)) errors.push('STRUCTURE: empty heading found');

  // URL slug is deterministic housekeeping: normalise instead of failing.
  const slug = slugify(a.URL_Slug || a.H1 || a.Article_Title);
  if (slug !== a.URL_Slug) warnings.push(`URL_Slug normalised to "${slug}"`);
  a.URL_Slug = slug;
  if (asText(a.SEO_Title).length > 70) warnings.push(`SEO_Title is ${asText(a.SEO_Title).length} characters (recommended <= 60)`);
  const md_len = asText(a.Meta_Description).length;
  if (md_len && (md_len < 70 || md_len > 170)) warnings.push(`Meta_Description is ${md_len} characters (recommended 140-160)`);

  // Links -----------------------------------------------------------------
  const allowedSet = new Set((allowedInternal || []).map(safeNormalize).filter(Boolean));
  const targetNorm = safeNormalize(ctx.target_page_url);
  allowedSet.add(targetNorm);
  const sources = Array.isArray(a.External_Sources) ? a.External_Sources : [];
  const sourceUrls = new Set(sources.map((s) => safeNormalize(s && s.URL)).filter(Boolean));
  let targetLinked = false;
  for (const link of extractMarkdownLinks(a.Article_Markdown)) {
    if (!isHttpUrl(link.url)) {
      errors.push(`MALFORMED_LINK: "${link.url}" is not an absolute http(s) URL`);
      continue;
    }
    const n = safeNormalize(link.url);
    const host = parseUrl(link.url).hostname;
    if (n === targetNorm) targetLinked = true;
    if (sameSite(host, ctx.site_host)) {
      if (!allowedSet.has(n)) errors.push(`UNVERIFIED_INTERNAL_LINK: ${link.url} is not a verified internal URL`);
    } else if (!sourceUrls.has(n)) {
      errors.push(`UNLISTED_EXTERNAL_LINK: ${link.url} is linked in the article but not listed in External_Sources`);
    }
    if (/^(click here|here|read more|this link|link)$/i.test(link.anchor)) warnings.push(`Non-descriptive anchor text "${link.anchor}"`);
  }
  if (cfg.REQUIRE_TARGET_PAGE_LINK !== false && usable && !targetLinked) {
    errors.push(`MISSING_TARGET_LINK: the article does not link to the target page ${ctx.target_page_url}`);
  }
  sources.forEach((s, i) => {
    if (!s || typeof s !== 'object') return errors.push(`SOURCE_INVALID: External_Sources[${i}] is not an object`);
    if (!isHttpUrl(s.URL)) errors.push(`SOURCE_INVALID: External_Sources[${i}].URL "${asText(s.URL)}" is not a valid http(s) URL`);
    if (!asText(s.Title)) errors.push(`SOURCE_INVALID: External_Sources[${i}] has no Title`);
    if (!asText(s.Supports_Claim)) errors.push(`SOURCE_INVALID: External_Sources[${i}] does not state which claim it supports`);
    if (isHttpUrl(s.URL) && sameSite(parseUrl(s.URL).hostname, ctx.site_host)) {
      errors.push(`SOURCE_INVALID: External_Sources[${i}] points to the brand's own site; use Internal_Link_Suggestions instead`);
    }
  });
  (Array.isArray(a.Internal_Link_Suggestions) ? a.Internal_Link_Suggestions : []).forEach((s, i) => {
    const n = safeNormalize(s && s.URL);
    if (!n || !allowedSet.has(n)) errors.push(`UNVERIFIED_INTERNAL_LINK: Internal_Link_Suggestions[${i}] URL "${asText(s && s.URL)}" is not a verified internal URL`);
  });
  (Array.isArray(a.Suggested_FAQs) ? a.Suggested_FAQs : []).forEach((f, i) => {
    if (!f || !asText(f.Question) || !asText(f.Answer)) errors.push(`MISSING_FIELD: Suggested_FAQs[${i}] needs Question and Answer`);
  });

  // Keyword relevance (presence, not density).
  const plain = normalizeKeyword(markdownToPlain(a.Article_Markdown));
  const kw = normalizeKeyword(ctx.primary_keyword);
  const kwTokens = kw.split(' ').filter((t) => t.length > 2);
  const covered = kwTokens.filter((t) => plain.includes(t)).length;
  if (usable && kwTokens.length && covered / kwTokens.length < 0.75) {
    errors.push(`KEYWORD_RELEVANCE: the article mentions only ${covered}/${kwTokens.length} significant terms of the primary keyword`);
  }
  if (usable && kw) {
    const occurrences = plain.split(kw).length - 1;
    const density = occurrences / Math.max(1, a.Word_Count / 100);
    if (occurrences >= 4 && density > 3) errors.push(`KEYWORD_STUFFING: exact primary keyword appears ${occurrences} times (${density.toFixed(1)} per 100 words)`);
  }

  // Repetition: identical paragraphs.
  const paras = a.Article_Markdown.split(/\n{2,}/).map((p) => normalizeKeyword(p)).filter((p) => p.split(' ').length >= 12);
  const seen = new Set();
  for (const p of paras) {
    if (seen.has(p)) {
      errors.push('REPETITIVE_CONTENT: a paragraph is repeated verbatim');
      break;
    }
    seen.add(p);
  }

  return { valid: errors.length === 0, usable, errors, warnings, article: a };
}

// Heuristic, deterministic screening for unsupported company claims.
// A sentence that mentions the brand (or "we/our") AND contains a number,
// a credential/award word or a guarantee must be backed by a brand_knowledge
// chunk that contains the same number / credential word.
function deterministicClaimChecks(article, chunks, brandNames) {
  const findings = [];
  const knowledge = (chunks || []).map((c) => String(c.content || '')).join('\n').toLowerCase();
  const brandRe = new RegExp(`\\b(${(brandNames || []).filter(Boolean).map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || 'zzzz'}|we|our|us)\\b`, 'i');
  const credentialRe = /\b(certified|certification|accredited|accreditation|award(?:ed|s|-winning)?|iso\s?\d{3,5}|licen[cs]ed|registered with|member of|partnered with|recogni[sz]ed by|ranked|no\.\s?1|number one|#1|leading|largest|best in)\b/i;
  const guaranteeRe = /\b(guarantee[sd]?|100%|always on time|zero (?:incidents|complaints)|within \d+\s*(?:minutes|hours))\b/i;
  const numberRe = /\b\d[\d,.]*\s*\+?\s*(?:%|percent\b|years?\b|clients?\b|customers?\b|sites?\b|staff\b|employees\b|professionals\b|cities\b|projects\b|locations\b|branches\b|buildings\b|guards\b|technicians\b)|\b\d[\d,.]*\+/gi;
  const testimonialRe = /(said|says|told us|according to (?:our )?client|testimonial|one of our clients|a client of ours)/i;
  const plain = markdownToPlain(article.Article_Markdown || '');
  const sentences = plain.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (!brandRe.test(s)) continue;
    const lower = s.toLowerCase();
    const cred = s.match(credentialRe);
    if (cred && !knowledge.includes(cred[0].toLowerCase().replace(/\s+/g, ' '))) {
      findings.push({ code: 'UNSUPPORTED_BRAND_CREDENTIAL', severity: 'CRITICAL', sentence: s.slice(0, 300), detail: `"${cred[0]}" is not documented in brand knowledge` });
      continue;
    }
    const g = s.match(guaranteeRe);
    if (g && !knowledge.includes(g[0].toLowerCase())) {
      findings.push({ code: 'UNSUPPORTED_GUARANTEE', severity: 'CRITICAL', sentence: s.slice(0, 300), detail: `"${g[0]}" is not documented in brand knowledge` });
      continue;
    }
    const nums = (lower.match(numberRe) || []).map((n) => n.trim()).filter((n) => /\d/.test(n) && !/^(19|20)\d\d$/.test(n));
    const unsupportedNum = nums.find((n) => !knowledge.includes(n.replace(/[^\d.,%+]/g, '').replace(/[+]/g, '')));
    if (unsupportedNum) {
      findings.push({ code: 'UNSUPPORTED_BRAND_STATISTIC', severity: 'CRITICAL', sentence: s.slice(0, 300), detail: `number "${unsupportedNum}" is not documented in brand knowledge` });
      continue;
    }
    if (testimonialRe.test(s)) {
      findings.push({ code: 'POSSIBLE_TESTIMONIAL_OR_CASE', severity: 'CRITICAL', sentence: s.slice(0, 300), detail: 'client statements or case references must come from brand knowledge' });
    }
  }
  return findings;
}

/* @exports */
module.exports = { extractMarkdownLinks, extractHeadings, markdownToPlain, slugify, isHttpUrl, safeNormalize, validateArticle, deterministicClaimChecks };
