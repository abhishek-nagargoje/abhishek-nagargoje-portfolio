// Final per-keyword result returned to the orchestrator for the run summary.
const ctx = $('Keyword Context').first(0).json;
const claimNode = $('Claim Keyword Record');
const claim = claimNode.isExecuted ? claimNode.first(0).json : {};
const ran = (n) => $(n).isExecuted;
let outcome = 'UNKNOWN';
if (ran('Mark Sheet Synced')) outcome = 'APPROVED';
else if (ran('Flag Sheet Sync Pending')) outcome = 'APPROVED_SHEET_SYNC_PENDING';
else if (ran('Mark REVIEW_REQUIRED')) outcome = 'REVIEW_REQUIRED';
else if (ran('Log Claim Lost')) outcome = 'CLAIM_LOST';
else if (ran('Record Technical Failure')) outcome = 'ERROR_' + ($('Record Technical Failure').first(0).json.sheet_status || 'ERROR');
else if (ran('Mark Skipped Record')) outcome = claim.outcome || 'SKIPPED_DUPLICATE';
else if (ran('Already Claimed Elsewhere')) outcome = 'IN_PROGRESS_ELSEWHERE';
return [{ json: { keyword_id: ctx.keyword_id, article_id: claim.article_id || null, outcome } }];
