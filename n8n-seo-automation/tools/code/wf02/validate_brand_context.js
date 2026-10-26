// @include common
// Checks that retrieval returned enough relevant, approved brand knowledge.
// Builds the list of verified internal URLs (target page, links found on the
// target page, URLs documented in brand knowledge on the same site).
const ctx = $('Keyword Context').first(0).json;
const cfg = ctx.config;
const page = $('Analyze Target Page').first(0).json.page;
const rows = $input.all().map((i) => i.json).filter((r) => r && r.chunk_id);
const relevant = rows.filter((r) => r.retrieval_reason === 'SEMANTIC_TOP_K' && Number(r.similarity) >= cfg.RAG_MIN_SIMILARITY);
const chunks = rows
  .sort((a, b) => Number(b.similarity) - Number(a.similarity))
  .map((r) => ({
    Knowledge_ID: r.knowledge_id,
    Chunk_ID: r.chunk_id,
    Category: r.category,
    Content: r.content,
    Source_URL: r.source_url || null,
    Similarity: Math.round(Number(r.similarity) * 1000) / 1000,
    Retrieval: r.retrieval_reason,
    Last_Updated: r.source_last_updated || null,
  }));

const allowed = new Map();
const addUrl = (u, label, origin) => {
  const parsed = parseUrl(u);
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !sameSite(parsed.hostname, ctx.site_host)) return;
  const n = normalizeUrl(parsed.href);
  if (!allowed.has(n)) allowed.set(n, { url: n, label: asText(label).slice(0, 120), origin });
};
addUrl(ctx.target_page_url, page.title || 'Target page', 'TARGET_PAGE');
for (const l of page.internal_links) addUrl(l.url, l.anchor, 'TARGET_PAGE_LINK');
for (const c of chunks) {
  if (c.Source_URL) addUrl(c.Source_URL, c.Category, 'BRAND_KNOWLEDGE_SOURCE');
  for (const m of String(c.Content).match(/https?:\/\/[^\s)"'<>]+/g) || []) addUrl(m.replace(/[.,;]+$/, ''), c.Category, 'BRAND_KNOWLEDGE');
}

const sufficient = relevant.length >= cfg.RAG_MIN_RELEVANT_CHUNKS;
const reason = sufficient ? '' :
  `INSUFFICIENT_BRAND_CONTEXT: only ${relevant.length} approved knowledge chunk(s) reached similarity ${cfg.RAG_MIN_SIMILARITY} for this keyword (minimum ${cfg.RAG_MIN_RELEVANT_CHUNKS}). Add approved Brand_Knowledge rows for this topic and re-run ingestion; no company information was invented.`;
return [{ json: {
  rag_ok: sufficient,
  brand_knowledge: chunks,
  relevant_count: relevant.length,
  retrieved_count: chunks.length,
  allowed_internal_links: [...allowed.values()],
  review_reason: reason,
  review_failed_conditions: sufficient ? [] : ['INSUFFICIENT_BRAND_CONTEXT'],
} }];
