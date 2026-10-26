// @include common
// Single technical-error funnel. Separates: configuration/auth (no auto retry),
// transient API/network (bounded automatic retry on later runs), and lost
// claims (another execution owns the record - touch nothing).
const ctx = $('Keyword Context').first(0).json;
const claimNode = $('Claim Keyword Record');
const claim = claimNode.isExecuted ? claimNode.first(0).json : {};
const inp = $input.first().json;
let info;
if (inp.error_class && typeof inp.error === 'string') {
  info = { stage: inp.error_stage || 'UNKNOWN', error_class: inp.error_class, retryable: inp.retryable !== false, http_code: null, message: truncate(scrubSecrets(inp.error), 1500) };
} else {
  info = classifyNodeError(inp, inp.error_stage);
}
const m = info.message;
if (/^(CONFIGURATION|INPUT)\b|EMBEDDING_(DIMENSION|CONFIG)_MISMATCH|PLAGIARISM_ASYNC_NOT_CONFIGURED|INTERNAL:/.test(m)) {
  info.error_class = 'CONFIGURATION';
  info.retryable = false;
}
if (/CLAIM_LOST/.test(m)) {
  info.error_class = 'CLAIM_LOST';
  info.retryable = false;
}
return [{ json: {
  ...info,
  keyword_id: ctx.keyword_id,
  article_id: claim.article_id || '',
  ledger_action: inp.ledger_action || 'KEEP',
  claim_lost: info.error_class === 'CLAIM_LOST',
  occurred_at: DateTime.now().setZone(ctx.config.TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss'),
  sheet_error_text: `[${info.error_class}] ${info.stage}: ${m}`.slice(0, 1000) + ` (execution ${ctx.execution_id})`,
} }];
