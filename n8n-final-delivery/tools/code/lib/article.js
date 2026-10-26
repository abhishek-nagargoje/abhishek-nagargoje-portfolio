// ---- article / markdown helpers (inlined into Code nodes) ----
// Parses inline markdown (links, bold, italic, inline code) into plain text
// plus style spans with offsets relative to the returned text.
function parseInline(src) {
  src = String(src === undefined || src === null ? '' : src);
  let out = '';
  const spans = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m;
    if ((m = /^\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
      const inner = parseInline(m[1]);
      const start = out.length;
      out += inner.text;
      inner.spans.forEach((s) => spans.push(Object.assign({}, s, { start: s.start + start, end: s.end + start })));
      spans.push({ type: 'link', start, end: out.length, url: m[2] });
      i += m[0].length; continue;
    }
    if ((m = /^(\*\*|__)(?=\S)([\s\S]+?\S)\1/.exec(rest))) {
      const inner = parseInline(m[2]);
      const start = out.length;
      out += inner.text;
      inner.spans.forEach((s) => spans.push(Object.assign({}, s, { start: s.start + start, end: s.end + start })));
      spans.push({ type: 'bold', start, end: out.length });
      i += m[0].length; continue;
    }
    if ((m = /^\*(?=\S)([^*]+?\S|\S)\*/.exec(rest))) {
      const start = out.length;
      out += m[1];
      spans.push({ type: 'italic', start, end: out.length });
      i += m[0].length; continue;
    }
    if ((m = /^`([^`]+)`/.exec(rest))) { out += m[1]; i += m[0].length; continue; }
    out += src[i]; i++;
  }
  return { text: out, spans: spans.filter((s) => s.end > s.start) };
}
// Converts article markdown into blocks. Headings in the body are capped at
// H2-H4 (the document title is the only H1).
function markdownToBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: 'paragraph', text: para.join(' ') }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); flushList(); continue; }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flushPara(); flushList();
      blocks.push({ type: 'heading', level: Math.min(4, Math.max(2, m[1].length)), text: m[2] });
      continue;
    }
    if ((m = /^\s*[-*+•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.type !== 'bullet') { flushList(); list = { type: 'bullet', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.type !== 'numbered') { flushList(); list = { type: 'numbered', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushList(); para.push(m[1]); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      if (/^\s*\|?\s*:?-{2,}/.test(line.replace(/\|/g, '|'))) continue; // table separator row
      blocks.push({ type: 'paragraph', text: line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' | ') });
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks;
}
function plainFromMarkdown(md) {
  return markdownToBlocks(md).map((b) => b.items ? b.items.map((t) => parseInline(t).text).join('\n') : parseInline(b.text).text).join('\n');
}
function countWords(text) { const m = String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu); return m ? m.length : 0; }
// The exact text submitted to the plagiarism checker for an attempt.
function buildCheckText(a) {
  const faqs = (a.FAQs || []).map((f) => parseInline(f.question).text + '\n' + plainFromMarkdown(f.answer)).join('\n');
  return [parseInline(a.Article_Title).text, plainFromMarkdown(a.Article_Markdown), faqs].filter((x) => x && x.trim()).join('\n\n').trim();
}
function markdownLinks(md) {
  const links = [];
  const re = /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m;
  while ((m = re.exec(String(md || '')))) links.push({ text: m[1], url: m[2] });
  return links;
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}
