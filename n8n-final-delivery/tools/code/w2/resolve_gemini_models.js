// @mode each
// @lib common
// Verifies the Gemini credential and the configured models against the live
// ListModels response. Never guesses a model ID.
const ctx = $('Validate Configuration').item.json.ctx;
const c = ctx.config;
const fail = httpFailure($json);
if (fail) {
  throw new Error('CONFIG_ERROR: Gemini credential check failed (ListModels). ' + fail.message +
    ' — open the "Google Gemini(PaLM) Api" credential used by this node and verify the API key and Host (https://generativelanguage.googleapis.com).');
}
const models = Array.isArray($json.models) ? $json.models : [];
if (!models.length) throw new Error('CONFIG_ERROR: Gemini ListModels returned no models for this API key');
const byName = new Map(models.map((m) => [asText(m.name).replace(/^models\//, ''), m]));
const supports = (m, method) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes(method);

const emb = byName.get(c.embedding_model);
if (!emb || !supports(emb, 'embedContent')) {
  throw new Error('CONFIG_ERROR: embedding model ' + c.embedding_model + ' is not available for embedContent with this API key');
}

let textModel = asText(c.gemini_text_model);
let selection = 'configured';
if (textModel.toLowerCase() === 'auto') {
  const prefs = (c.gemini_auto_tier_preference || ['flash', 'pro']).map((t) => asText(t).toLowerCase());
  const candidates = [];
  for (const [name, m] of byName) {
    const mm = /^gemini-(\d+(?:\.\d+)?)-(flash|pro)$/.exec(name); // stable IDs only: no -preview/-exp/-lite/-latest/dated suffixes
    if (!mm || !supports(m, 'generateContent')) continue;
    const tierRank = prefs.indexOf(mm[2]);
    if (tierRank < 0) continue;
    candidates.push({ name, version: parseFloat(mm[1]), tierRank });
  }
  candidates.sort((a, b) => a.tierRank - b.tierRank || b.version - a.version);
  if (!candidates.length) {
    const seen = [...byName.keys()].filter((n) => /^gemini/.test(n)).slice(0, 40).join(', ');
    throw new Error('CONFIG_ERROR: gemini_text_model is "auto" but no stable gemini-<version>-flash/pro model supporting generateContent was found. Set gemini_text_model in the Configuration node to one of: ' + seen);
  }
  textModel = candidates[0].name;
  selection = 'auto (newest stable ' + prefs[candidates[0].tierRank] + ')';
}
textModel = textModel.replace(/^models\//, '');
const tm = byName.get(textModel);
if (!tm || !supports(tm, 'generateContent')) {
  throw new Error('CONFIG_ERROR: Gemini text model "' + textModel + '" is not available for generateContent with this API key');
}
const maxOut = Math.max(2048, Math.min(c.gemini_max_output_tokens || 32768, tm.outputTokenLimit || 8192));
ctx.models = {
  text_model: textModel, text_model_selection: selection, text_model_display: asText(tm.displayName),
  text_output_token_limit: maxOut, text_input_token_limit: tm.inputTokenLimit || null,
  embedding_model: c.embedding_model, embedding_dimensions: c.embedding_dimensions,
};
return { json: { ctx } };
