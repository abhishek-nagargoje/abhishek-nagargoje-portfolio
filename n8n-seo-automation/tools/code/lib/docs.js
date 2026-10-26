// ---- lib/docs.js : Markdown article -> Google Docs batchUpdate requests ----
// Google Docs API v1 documents.batchUpdate request types used:
//   insertText, updateParagraphStyle(namedStyleType), updateTextStyle(bold/italic/link/fontSize/foregroundColor),
//   createParagraphBullets(bulletPreset), insertPageBreak.
// Indices are UTF-16 code units, which is what JavaScript string length counts.

const DOC_MARKER_PREFIX = 'SEO-ARTICLE-MARKER: ';

// Parses inline markdown (links, **bold**, *italic*/_italic_) into plain text + style runs.
function parseInline(src) {
  let text = '';
  const runs = [];
  let i = 0;
  const s = String(src || '');
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/))) {
      const inner = parseInline(m[1]);
      const start = text.length;
      text += inner.text;
      inner.runs.forEach((r) => runs.push({ ...r, start: r.start + start, end: r.end + start }));
      runs.push({ start, end: text.length, link: m[2] });
      i += m[0].length;
    } else if ((m = rest.match(/^\*\*([^*]+)\*\*/)) || (m = rest.match(/^__([^_]+)__/))) {
      const start = text.length;
      const inner = parseInline(m[1]);
      text += inner.text;
      inner.runs.forEach((r) => runs.push({ ...r, start: r.start + start, end: r.end + start }));
      runs.push({ start, end: text.length, bold: true });
      i += m[0].length;
    } else if ((m = rest.match(/^\*([^*\s][^*]*)\*/)) || (m = rest.match(/^_([^_\s][^_]*)_(?![A-Za-z0-9])/))) {
      const start = text.length;
      text += m[1];
      runs.push({ start, end: text.length, italic: true });
      i += m[0].length;
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      text += m[1];
      i += m[0].length;
    } else {
      text += s[i];
      i += 1;
    }
  }
  return { text, runs };
}

function para(textOrMd, style, extra) {
  const parsed = parseInline(textOrMd);
  return { text: parsed.text.replace(/\n/g, ' '), runs: parsed.runs, style: style || 'NORMAL_TEXT', ...(extra || {}) };
}

function markdownToParagraphs(md) {
  const out = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) {
      out.push(para(buffer.join(' '), 'NORMAL_TEXT'));
      buffer = [];
    }
  };
  for (const rawLine of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flush(); continue; } // horizontal rule
    if ((m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/))) {
      flush();
      const level = m[1].length;
      out.push(para(m[2], level === 1 ? 'HEADING_1' : level === 2 ? 'HEADING_2' : 'HEADING_3'));
      continue;
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { flush(); out.push(para(m[1], 'NORMAL_TEXT', { bullet: 'BULLET' })); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flush(); out.push(para(m[1], 'NORMAL_TEXT', { bullet: 'NUMBER' })); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      const p = para(m[1], 'NORMAL_TEXT');
      p.runs.push({ start: 0, end: p.text.length, italic: true });
      out.push(p);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      if (/^\s*\|[\s:\-|]+\|\s*$/.test(line)) continue; // table separator row
      out.push(para(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  |  '), 'NORMAL_TEXT'));
      continue;
    }
    buffer.push(line.trim());
  }
  flush();
  return out.filter((p) => p.text.trim().length > 0);
}

// Builds the complete section for one approved article.
function buildArticleParagraphs(article, meta) {
  const ps = [];
  const label = (name, value) => {
    const p = para('', 'NORMAL_TEXT');
    p.text = `${name}: ${value}`;
    p.runs = [{ start: 0, end: name.length + 1, bold: true }];
    return p;
  };
  const linkLabel = (name, url) => {
    const p = label(name, url);
    if (/^https?:\/\//.test(url)) p.runs.push({ start: name.length + 2, end: p.text.length, link: url });
    return p;
  };
  ps.push(para(article.Article_Title, 'TITLE'));
  ps.push(label('Article ID', article.Article_ID));
  ps.push(linkLabel('Target page URL', article.Target_Page_URL));
  ps.push(label('Primary keyword', article.Primary_Keyword));
  ps.push(label('Supporting keywords', (article.Supporting_Keywords || []).join(', ') || '—'));
  ps.push(label('SEO title', article.SEO_Title));
  ps.push(label('H1', article.H1));
  ps.push(label('Meta description', article.Meta_Description));
  ps.push(label('Suggested URL slug', article.URL_Slug));
  ps.push(label('Generation date', meta.generation_date));
  ps.push(label('Editorial quality status', meta.quality_status));
  ps.push(label('Plagiarism result', meta.plagiarism_result));
  ps.push(meta.plagiarism_report_ref && /^https?:\/\//.test(meta.plagiarism_report_ref)
    ? linkLabel('Plagiarism report reference', meta.plagiarism_report_ref)
    : label('Plagiarism report reference', meta.plagiarism_report_ref || 'n/a'));
  const marker = para('', 'NORMAL_TEXT', { marker: true });
  marker.text = DOC_MARKER_PREFIX + article.Article_ID;
  ps.push(marker);

  const body = markdownToParagraphs(article.Article_Markdown);
  ps.push(...body);

  const hasFaqHeading = body.some((p) => p.style !== 'NORMAL_TEXT' && /faq|frequently asked/i.test(p.text));
  const faqs = (article.Suggested_FAQs || []).filter((f) => f && f.Question && f.Answer);
  if (faqs.length && !hasFaqHeading) {
    ps.push(para('Frequently Asked Questions', 'HEADING_2'));
    for (const f of faqs) {
      ps.push(para(f.Question, 'HEADING_3'));
      ps.push(para(f.Answer, 'NORMAL_TEXT'));
    }
  }
  const sources = (article.External_Sources || []).filter((s) => s && s.URL && s.Title);
  if (sources.length) {
    ps.push(para('References', 'HEADING_2'));
    for (const s of sources) {
      const p = para('', 'NORMAL_TEXT', { bullet: 'BULLET' });
      p.text = s.Publisher ? `${s.Title} – ${s.Publisher}` : String(s.Title);
      p.runs = [{ start: 0, end: String(s.Title).length, link: s.URL }];
      ps.push(p);
    }
  }
  return ps;
}

// baseIndex: index at which to insert (document end index - 1).
function buildDocsRequests(paragraphs, baseIndex, withPageBreak) {
  const prefix = '\n';
  const start = baseIndex + prefix.length;
  let text = '';
  const placed = paragraphs.map((p) => {
    const s = start + text.length;
    text += p.text + '\n';
    return { ...p, s, e: s + p.text.length };
  });
  const end = start + text.length;
  const requests = [
    { insertText: { location: { index: baseIndex }, text: prefix + text } },
    { updateParagraphStyle: { range: { startIndex: start, endIndex: end }, paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } },
    { updateTextStyle: { range: { startIndex: start, endIndex: end }, textStyle: {}, fields: 'bold,italic,underline,link' } },
  ];
  for (const p of placed) {
    if (p.style !== 'NORMAL_TEXT') {
      requests.push({ updateParagraphStyle: { range: { startIndex: p.s, endIndex: p.e + 1 }, paragraphStyle: { namedStyleType: p.style }, fields: 'namedStyleType' } });
    }
  }
  // consecutive bullet paragraphs of the same kind form one list
  for (let i = 0; i < placed.length; i++) {
    if (!placed[i].bullet) continue;
    let j = i;
    while (j + 1 < placed.length && placed[j + 1].bullet === placed[i].bullet) j++;
    requests.push({ createParagraphBullets: {
      range: { startIndex: placed[i].s, endIndex: placed[j].e },
      bulletPreset: placed[i].bullet === 'NUMBER' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE',
    } });
    i = j;
  }
  for (const p of placed) {
    for (const r of p.runs || []) {
      if (r.end <= r.start) continue;
      const range = { startIndex: p.s + r.start, endIndex: p.s + r.end };
      if (r.link) requests.push({ updateTextStyle: { range, textStyle: { link: { url: r.link } }, fields: 'link' } });
      if (r.bold) requests.push({ updateTextStyle: { range, textStyle: { bold: true }, fields: 'bold' } });
      if (r.italic) requests.push({ updateTextStyle: { range, textStyle: { italic: true }, fields: 'italic' } });
    }
    if (p.marker) {
      requests.push({ updateTextStyle: { range: { startIndex: p.s, endIndex: p.e },
        textStyle: { fontSize: { magnitude: 8, unit: 'PT' }, foregroundColor: { color: { rgbColor: { red: 0.45, green: 0.45, blue: 0.45 } } } },
        fields: 'fontSize,foregroundColor' } });
    }
  }
  if (withPageBreak) requests.push({ insertPageBreak: { location: { index: start } } });
  return { requests, text, insertedLength: prefix.length + text.length + (withPageBreak ? 2 : 0) };
}

// Concatenates all text runs of a documents.get response body.
function documentPlainText(doc) {
  const out = [];
  const walk = (elements) => {
    for (const el of elements || []) {
      if (el.paragraph) for (const pe of el.paragraph.elements || []) if (pe.textRun) out.push(pe.textRun.content || '');
      if (el.table) for (const row of el.table.tableRows || []) for (const cell of row.tableCells || []) walk(cell.content);
      if (el.tableOfContents) walk(el.tableOfContents.content);
    }
  };
  walk(doc && doc.body && doc.body.content);
  return out.join('');
}

function documentEndIndex(doc) {
  const content = (doc && doc.body && doc.body.content) || [];
  const last = content[content.length - 1];
  return last && last.endIndex ? last.endIndex : 1;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
  return n;
}

/* @exports */
module.exports = { DOC_MARKER_PREFIX, parseInline, markdownToParagraphs, buildArticleParagraphs, buildDocsRequests, documentPlainText, documentEndIndex, countOccurrences };
