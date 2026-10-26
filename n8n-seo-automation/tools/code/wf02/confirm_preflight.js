// @include common
// Confirms the plagiarism provider accepted our credential before any article
// text is generated. The response format of the account-status endpoint is not
// documented in detail, so only clear failures are rejected; the first real
// scan is still validated strictly (fail closed).
const { config } = $('Workflow Configuration').first(0).json;
const models = $('Preflight - Verify Gemini Models').all(0).map((i) => i.json.name).filter(Boolean);
let plagiarism = { checked: false };
if (config.PLAGIARISM_PREFLIGHT_ENABLED) {
  const r = $('Preflight - Verify Plagiarism Account').first(0).json;
  const status = Number(r.statusCode || 0);
  const raw = r.data !== undefined ? r.data : r.body; // fullResponse + text format -> "data"
  const bodyText = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
  if (status === 401 || status === 403 || (status >= 400 && status < 500)) {
    throw new Error(`CONFIGURATION: plagiarism provider rejected the account check (HTTP ${status}): ${truncate(scrubSecrets(bodyText), 300)}`);
  }
  if (status >= 500 || status === 0) {
    throw new Error(`API_TRANSIENT: plagiarism provider unavailable (HTTP ${status}); no article will be approved while it is down`);
  }
  if (/invalid\s*token|unauthori[sz]ed|token\s*(is\s*)?(missing|required|expired)|no\s*active\s*plan/i.test(bodyText)) {
    throw new Error(`CONFIGURATION: plagiarism provider reported a credential/plan problem: ${truncate(scrubSecrets(bodyText), 300)}`);
  }
  plagiarism = { checked: true, http_status: status, account_info: truncate(scrubSecrets(bodyText), 500) };
}
return [{ json: { config, run_id: $('Workflow Configuration').first(0).json.run_id, verified_models: models, plagiarism } }];
