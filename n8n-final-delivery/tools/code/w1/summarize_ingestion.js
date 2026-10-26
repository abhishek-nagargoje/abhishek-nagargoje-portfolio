// @mode all
const items = $input.all().map((i) => i.json).filter((j) => j && j.outcome);
const ctx = items.length ? items[0].ctx : $('Filter Approved Records').first().json.ctx;
const count = (s) => items.filter((i) => i.outcome.status === s).length;
const summary = {
  rows_read: ctx.stats.rows_read, approved_rows: ctx.stats.approved_rows, unapproved_skipped: ctx.stats.unapproved_skipped,
  inserted: count('INSERTED'), updated: count('UPDATED'), unchanged: count('UNCHANGED'),
  skipped: count('SKIPPED') + ctx.stats.invalid_skipped + ctx.stats.duplicate_ids_skipped,
  failed: count('FAILED'),
  records: items.map((i) => i.outcome),
  sheet_level_skips: ctx.stats.invalid,
};
return [{ json: { ctx, summary, approved_ids: ctx.approved_ids }, pairedItem: { item: 0 } }];
