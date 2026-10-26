// @mode each
const ctx = $json.ctx;
return { json: { status: 'NOTHING_CLAIMED', message: ctx.claim.message, skipped: ctx.claim.skipped,
  hint: 'Keywords that are IN_PROGRESS are owned by another execution until their lease expires (lease_minutes in the Configuration node).' } };
