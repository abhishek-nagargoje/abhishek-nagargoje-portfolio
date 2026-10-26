// @include common, article, plagiarism
// Splits the article's plain text into provider-sized chunks. Each scan is tied
// to the sha256 of the exact attempt being checked (from Record Article Attempt).
const cfg = $('Keyword Context').first(0).json.config;
const att = $('Prepare Attempt').first(0).json;
const rec = $('Record Article Attempt').first(0).json;
const text = markdownToPlain(att.article.Article_Markdown);
const chunks = chunkTextByWords(text, cfg.PLAGIARISM_MAX_WORDS_PER_REQUEST);
if (!chunks.length) throw new Error('INTERNAL: article has no text to scan');
return chunks.map((t, i) => ({ json: { chunk_index: i, text: t, words: wordCount(t), attempt_no: att.attempt_no, content_sha256: rec.content_sha256 } }));
