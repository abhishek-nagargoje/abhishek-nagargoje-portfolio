// @include gemini
// Validates the evaluator's JSON. outcome: VALID | RETRY | FAILED
// One correction attempt per article attempt (tracked by for_attempt).
const att = $('Prepare Attempt').first(0).json;
const parsed = parseGeminiJson($input.first().json);
const problems = [];
if (!parsed.ok) problems.push(parsed.error);
else problems.push(...checkAgainstSchema(parsed.data, __SCHEMA_EVALUATOR__));
const corr = $('Build Evaluator Correction Request');
const correctionUsed = corr.isExecuted && corr.first(0).json.for_attempt === att.attempt_no;
const outcome = problems.length === 0 ? 'VALID' : (correctionUsed || parsed.errorType === 'BLOCKED' ? 'FAILED' : 'RETRY');
return [{ json: {
  outcome,
  attempt_no: att.attempt_no,
  report: problems.length ? null : parsed.data,
  problems,
  raw_text: parsed.text || '',
  error_class: outcome === 'FAILED' ? 'API_TRANSIENT' : undefined,
  retryable: outcome === 'FAILED' ? true : undefined,
  error: outcome === 'FAILED' ? `EDITORIAL_EVALUATION_INVALID (after one correction): ${problems.slice(0, 8).join('; ')}` : undefined,
} }];
