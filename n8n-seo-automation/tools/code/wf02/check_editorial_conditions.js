// The workflow - not the model - decides the editorial result. PASS requires:
// every mandatory check PASS, Overall_Status PASS, no unsupported claims,
// and all deterministic checks passing.
const CHECKS = __CHECK_NAMES__;
const att = $('Prepare Attempt').first(0).json;
const report = $('Validate Editorial Report').first(0).json.report;
const det = $('Aggregate Source Checks').first(0).json;
const failed = [];
let anyFail = false;
for (const name of CHECKS) {
  const c = report[name] || { Status: 'FAIL', Explanation: 'missing from report' };
  if (c.Status !== 'PASS') {
    if (c.Status === 'FAIL') anyFail = true;
    failed.push(`${name}=${c.Status}: ${c.Explanation}`);
  }
}
if (report.Overall_Status !== 'PASS') failed.push(`Overall_Status=${report.Overall_Status}`);
for (const u of report.Unsupported_Claims || []) {
  if (u.Severity === 'CRITICAL') anyFail = true;
  failed.push(`UNSUPPORTED_CLAIM(${u.Severity}): "${u.Claim}" - ${u.Reason}`);
}
for (const f of det.deterministic_checks.findings.filter((x) => x.severity === 'CRITICAL')) {
  anyFail = true;
  failed.push(`${f.code}: ${f.detail}${f.sentence ? ' | "' + f.sentence + '"' : ''}`);
}
const pass = failed.length === 0;
return [{ json: {
  attempt_no: att.attempt_no,
  editorial_pass: pass,
  editorial_status: pass ? 'PASS' : (anyFail ? 'FAIL' : 'REVIEW_REQUIRED'),
  failed_conditions: failed,
  report,
  deterministic_checks: det.deterministic_checks,
  source_checks: det.source_checks,
} }];
