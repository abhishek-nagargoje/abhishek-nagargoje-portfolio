// @include common, article
// One item per external source URL to check (bounded), or a single skip item.
const cfg = $('Keyword Context').first(0).json.config;
const att = $('Prepare Attempt').first(0).json;
const sources = (att.article.External_Sources || []).filter((s) => s && isHttpUrl(s.URL)).slice(0, cfg.MAX_EXTERNAL_SOURCES_CHECKED);
if (!sources.length) return [{ json: { check: false } }];
return sources.map((s, i) => ({ json: { check: true, index: i, url: s.URL, title: s.Title } }));
