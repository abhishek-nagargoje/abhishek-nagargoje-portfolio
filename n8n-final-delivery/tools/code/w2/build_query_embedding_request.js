// @mode each
// @lib common
const ctx = $json.ctx;
const k = ctx.keyword;
const p = ctx.page;
const text = [
  'Topic: ' + k.Primary_Keyword,
  k.Supporting_Keywords.length ? 'Related: ' + k.Supporting_Keywords.join(', ') : '',
  'Search intent: ' + k.Search_Intent,
  k.Target_Audience ? 'Audience: ' + k.Target_Audience : '',
  'Location: ' + k.Target_Location,
  p.title ? 'Target page: ' + p.title : '',
  p.h1 && p.h1.length ? 'Page heading: ' + p.h1.join(' / ') : '',
  p.meta_description ? 'Page summary: ' + p.meta_description : '',
  (p.headings || []).filter((h) => h.level >= 2).slice(0, 12).map((h) => h.text).join('; '),
].filter(Boolean).join('\n');
ctx.embedding_request = {
  model: 'models/' + ctx.models.embedding_model,
  content: { parts: [{ text: truncate(text, 6000) }] },
  taskType: 'RETRIEVAL_QUERY',
  outputDimensionality: ctx.models.embedding_dimensions,
};
return { json: { ctx } };
