// @mode each
// @lib common
const ctx = $('Verify Schema').item.json.ctx;
const c = ctx.config;
const fail = httpFailure($json);
if (fail) throw new Error('CONFIG_ERROR: Gemini credential check failed (ListModels): ' + fail.message + ' — verify the API key in the "Google Gemini(PaLM) Api" credential.');
const m = (Array.isArray($json.models) ? $json.models : []).find((x) => asText(x.name).replace(/^models\//, '') === c.embedding_model);
if (!m) throw new Error('CONFIG_ERROR: embedding model ' + c.embedding_model + ' is not available to this Gemini API key');
if (!(m.supportedGenerationMethods || []).includes('embedContent')) throw new Error('CONFIG_ERROR: ' + c.embedding_model + ' does not support embedContent');
ctx.embedding = { model: c.embedding_model, dimensions: c.embedding_dimensions, input_token_limit: m.inputTokenLimit || null };
return { json: { ctx } };
