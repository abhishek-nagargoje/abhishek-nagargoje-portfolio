// The article was already written to Google Docs and verified by an earlier
// execution that did not finish its bookkeeping. Finish it - never regenerate
// or append again.
const claim = $('Claim Keyword Record').first(0).json;
return [{ json: { recovered_article_id: claim.article_id, note: claim.reason } }];
