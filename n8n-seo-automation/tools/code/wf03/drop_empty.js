// Postgres returns an empty placeholder item when a query has no rows
// (alwaysOutputData); drop it so downstream nodes only see real rows.
return $input.all().filter((i) => i.json && (i.json.keyword_id || i.json.article_id));
