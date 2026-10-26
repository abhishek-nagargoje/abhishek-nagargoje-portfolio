// @mode each
// @lib common,article,docs
// Builds the formatted Google Docs section and the approval payload that is
// persisted (so a later run can publish without regenerating anything).
assertLease($json, 'Format Approved Article');
const ctx = $json.ctx;
ctx.doc_section = buildDocSection(ctx);
if (ctx.doc_section.text.indexOf(ctx.job.marker) < 0) throw new Error('Formatting error: document marker missing from formatted section');
ctx.approval_payload = {
  article: ctx.article, keyword: ctx.keyword, attempts: ctx.attempt,
  editorial: { overall_status: ctx.editorial.overall_status, individual_checks: ctx.editorial.individual_checks,
    deterministic_checks: ctx.editorial.deterministic_checks, failed_conditions: ctx.editorial.failed_conditions,
    unsupported_claims: ctx.editorial.unsupported_claims, disclaimer: ctx.editorial.disclaimer, reviewer_comments: ctx.editorial.reviewer_comments },
  plagiarism: { provider: ctx.plagiarism.provider || 'duplichecker', status: ctx.plagiarism.status, result_label: ctx.plagiarism.result_label, plag_percent: ctx.plagiarism.plag_percent,
    unique_percent: ctx.plagiarism.unique_percent, rephrased_percent: ctx.plagiarism.rephrased_percent, exact_percent: ctx.plagiarism.exact_percent,
    threshold_percent: ctx.plagiarism.threshold_percent, report_reference: ctx.plagiarism.report_reference, provider_hash: ctx.plagiarism.provider_hash },
  links: ctx.links,
};
return { json: { ctx } };
