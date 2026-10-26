// Builds the retrieval query from the keyword record and the analysed page,
// and the embedContent request (task type RETRIEVAL_QUERY, same model and
// dimensionality as ingestion).
const ctx = $('Keyword Context').first(0).json;
const page = $('Analyze Target Page').first(0).json.page;
const cfg = ctx.config;
const query = [
  `Primary keyword: ${ctx.primary_keyword}`,
  ctx.supporting_keywords.length ? `Supporting keywords: ${ctx.supporting_keywords.join(', ')}` : '',
  ctx.search_intent ? `Search intent: ${ctx.search_intent}` : '',
  ctx.target_audience ? `Audience: ${ctx.target_audience}` : '',
  ctx.target_location ? `Location: ${ctx.target_location}` : '',
  `Target page: ${page.title} - ${page.h1.join(' / ')}`,
  page.meta_description ? `Page summary: ${page.meta_description}` : '',
  page.h2.length ? `Page sections: ${page.h2.slice(0, 12).join('; ')}` : '',
  `Page content: ${page.main_text_excerpt.slice(0, 1500)}`,
].filter(Boolean).join('\n');
return [{ json: {
  rag_query: query,
  embedding_request: {
    model: `models/${cfg.EMBEDDING_MODEL}`,
    content: { parts: [{ text: query }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: cfg.EMBEDDING_DIMENSIONS,
  },
} }];
