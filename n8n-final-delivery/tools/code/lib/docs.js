// ---- Google Docs section builder (offsets are UTF-16 code units, as used by the Docs API) ----
// Returns the section text (starting with "\n" so it never merges with the
// previous paragraph) plus paragraph styles, text styles and bullet ranges,
// all relative to the insertion index.
function buildDocSection(ctx) {
  const a = ctx.article;
  const e = ctx.editorial;
  const p = ctx.plagiarism;
  const c = ctx.config;
  const allowed = new Set(ctx.links.verified_internal.map((l) => l.url));
  (a.External_Sources || []).forEach((s) => { const n = normalizeUrl(s.url); if (n && /^https:/.test(n)) allowed.add(n); });
  const linkOk = (u) => { const n = normalizeUrl(u); return n && allowed.has(n) ? n : ''; };
  const paras = [];
  // Paragraph text must not contain line breaks or control characters (the Docs API rejects them).
  // Removing characters would shift span offsets, so they are replaced one-for-one with spaces.
  const clean = (t) => String(t).replace(/[\u0000-\u0008\u000A-\u001F\u007F\u2028\u2029]/g, ' ');
  const add = (text, named, spans, bullet) => paras.push({ text: clean(text), named: named || 'NORMAL_TEXT', spans: spans || [], bullet: bullet || null });
  const inline = (md) => { const r = parseInline(md); const spans = []; r.spans.forEach((s) => { if (s.type !== 'link') spans.push(s); else { const u = linkOk(s.url); if (u) spans.push({ type: 'link', start: s.start, end: s.end, url: u }); } }); return { text: r.text, spans }; };
  const labelled = (label, value, url) => {
    const t = label + ': ' + value;
    const spans = [{ type: 'bold', start: 0, end: label.length + 1 }];
    if (url) spans.push({ type: 'link', start: label.length + 2, end: t.length, url });
    add(t, 'NORMAL_TEXT', spans);
  };
  add(parseInline(a.Article_Title).text, 'HEADING_1');
  add(ctx.job.marker, 'NORMAL_TEXT', [{ type: 'italic', start: 0, end: ctx.job.marker.length }]);
  labelled('Article ID', a.Article_ID);
  labelled('Keyword ID', a.Keyword_ID);
  labelled('Target URL', a.Target_Page_URL, normalizeUrl(a.Target_Page_URL));
  labelled('Primary keyword', a.Primary_Keyword);
  if ((a.Supporting_Keywords || []).length) labelled('Supporting keywords', a.Supporting_Keywords.join(', '));
  labelled('SEO title', a.SEO_Title);
  labelled('H1', a.H1);
  labelled('Meta description', a.Meta_Description);
  labelled('Suggested URL slug', a.URL_Slug);
  labelled('Editorial result', e.overall_status + ' — all ' + e.individual_checks.length + ' mandatory checks passed (attempt ' + ctx.attempt + ' of ' + c.max_attempts + '). ' + e.disclaimer);
  labelled('Plagiarism result', p.result_label + ' — DupliChecker reported ' + p.plag_percent + '% plagiarism' +
    (p.unique_percent !== null && p.unique_percent !== undefined ? ', ' + p.unique_percent + '% unique' : '') +
    (p.rephrased_percent !== null && p.rephrased_percent !== undefined ? ', ' + p.rephrased_percent + '% rephrased' : '') +
    ' (internal threshold ' + p.threshold_percent + '%)');
  labelled('Word count', String(a.Word_Count));
  labelled('Approved at', nowLocal(c.timezone) + ' IST');
  add('────────────────────────────────────────');
  for (const b of markdownToBlocks(a.Article_Markdown)) {
    if (b.type === 'heading') { const r = inline(b.text); add(r.text, 'HEADING_' + b.level, r.spans); }
    else if (b.type === 'paragraph') { const r = inline(b.text); add(r.text, 'NORMAL_TEXT', r.spans); }
    else { const listId = paras.length; b.items.forEach((it) => { const r = inline(it); add(r.text, 'NORMAL_TEXT', r.spans, { list: listId, numbered: b.type === 'numbered' }); }); }
  }
  if ((a.FAQs || []).length) {
    add('Frequently Asked Questions', 'HEADING_2');
    a.FAQs.forEach((f) => {
      add(parseInline(f.question).text, 'HEADING_3');
      markdownToBlocks(f.answer).forEach((b) => {
        if (b.items) { const listId = paras.length; b.items.forEach((it) => { const r = inline(it); add(r.text, 'NORMAL_TEXT', r.spans, { list: listId, numbered: b.type === 'numbered' }); }); }
        else { const r = inline(b.text); add(r.text, 'NORMAL_TEXT', r.spans); }
      });
    });
  }
  if ((a.Internal_Link_Suggestions || []).length) {
    add('Internal link suggestions', 'HEADING_2');
    const listId = paras.length;
    a.Internal_Link_Suggestions.forEach((l) => {
      const anchor = asText(l.anchor_text) || l.url;
      const t = anchor + ' → ' + l.url + (l.context ? ' (' + l.context + ')' : '');
      const u = linkOk(l.url);
      add(t, 'NORMAL_TEXT', u ? [{ type: 'link', start: anchor.length + 3, end: anchor.length + 3 + l.url.length, url: u }] : [], { list: listId, numbered: false });
    });
  }
  if ((a.External_Sources || []).length) {
    add('External references', 'HEADING_2');
    const listId = paras.length;
    a.External_Sources.forEach((s) => {
      const label = asText(s.title) + (s.publisher ? ' — ' + asText(s.publisher) : '');
      const u = linkOk(s.url);
      add(label, 'NORMAL_TEXT', u ? [{ type: 'link', start: 0, end: label.length, url: u }] : [], { list: listId, numbered: false });
    });
  }
  if ((a.Verified_Brand_Facts_Used || []).length) {
    add('Verified brand facts used', 'HEADING_2');
    const listId = paras.length;
    a.Verified_Brand_Facts_Used.forEach((f) => add(asText(f.knowledge_id) + ': ' + asText(f.fact), 'NORMAL_TEXT', [], { list: listId, numbered: false }));
  }
  // Assemble: leading "\n" terminates whatever paragraph precedes the insertion point.
  let text = '\n';
  const paragraphStyles = [];
  const textStyles = [];
  const bullets = [];
  let open = null;
  paras.forEach((pa, idx) => {
    const start = text.length;
    text += pa.text;
    const end = text.length;
    if (idx < paras.length - 1) text += '\n';
    paragraphStyles.push({ start, end: Math.max(end, start + 1), named: pa.named });
    pa.spans.forEach((s) => { if (s.end > s.start) textStyles.push({ start: start + s.start, end: start + s.end, type: s.type, url: s.url }); });
    if (pa.bullet) {
      if (open && open.list === pa.bullet.list) open.end = end;
      else { if (open) bullets.push(open); open = { list: pa.bullet.list, start, end, numbered: pa.bullet.numbered }; }
    } else if (open) { bullets.push(open); open = null; }
  });
  if (open) bullets.push(open);
  return { text, paragraphStyles, textStyles, bullets, char_count: text.length, paragraph_count: paras.length };
}
