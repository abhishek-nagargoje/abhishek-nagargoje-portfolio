// ---- lib/gemini.js : Gemini generateContent request/response helpers ----
// REST contract used (Gemini API v1beta):
//   POST {base}/models/{model}:generateContent   header x-goog-api-key (n8n Header Auth credential)
//   body: { systemInstruction:{parts:[{text}]}, contents:[{role:'user',parts:[{text}]}],
//           generationConfig:{ responseMimeType:'application/json', responseSchema:{...}, maxOutputTokens } }
//   response: candidates[0].content.parts[].text, candidates[0].finishReason, promptFeedback.blockReason

function buildGeminiRequest(systemText, userPayload, schema, maxOutputTokens) {
  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload, null, 1) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: maxOutputTokens || 32768,
    },
  };
}

// Wraps untrusted material so the model treats it as data (see prompts/05).
function dataBlock(tag, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  return `<${tag}>\n${String(body).replace(new RegExp(`</?${tag}>`, 'g'), '')}\n</${tag}>`;
}

function stripJsonFences(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : t;
}

// Returns { ok, data, text, finishReason, error } - never throws.
function parseGeminiJson(response) {
  const r = response || {};
  if (r.promptFeedback && r.promptFeedback.blockReason) {
    return { ok: false, error: `PROMPT_BLOCKED: ${r.promptFeedback.blockReason}`, errorType: 'BLOCKED' };
  }
  const cand = Array.isArray(r.candidates) ? r.candidates[0] : null;
  if (!cand) return { ok: false, error: 'NO_CANDIDATES: Gemini returned no candidates', errorType: 'EMPTY' };
  const finishReason = cand.finishReason || 'UNKNOWN';
  const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
  const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (finishReason === 'MAX_TOKENS') {
    return { ok: false, finishReason, text, error: 'TRUNCATED: response hit maxOutputTokens', errorType: 'TRUNCATED' };
  }
  if (!['STOP', 'FINISH_REASON_UNSPECIFIED', 'UNKNOWN'].includes(finishReason)) {
    return { ok: false, finishReason, text, error: `FINISH_REASON_${finishReason}`, errorType: 'BLOCKED' };
  }
  if (!text.trim()) return { ok: false, finishReason, error: 'EMPTY_TEXT: no text parts in response', errorType: 'EMPTY' };
  try {
    const data = JSON.parse(stripJsonFences(text));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, finishReason, text, error: 'INVALID_JSON: top-level value is not an object', errorType: 'INVALID' };
    }
    return { ok: true, data, text, finishReason };
  } catch (e) {
    return { ok: false, finishReason, text, error: `INVALID_JSON: ${e.message}`, errorType: 'INVALID' };
  }
}

// Minimal validator for the Gemini responseSchema subset we use
// (OBJECT/ARRAY/STRING/INTEGER/NUMBER/BOOLEAN, required, enum).
// Returns a list of human-readable problems ([] = valid).
function checkAgainstSchema(value, schema, path) {
  const p = path || '$';
  const problems = [];
  const t = schema.type;
  if (value === undefined || value === null) {
    problems.push(`${p} is missing`);
    return problems;
  }
  if (t === 'OBJECT') {
    if (typeof value !== 'object' || Array.isArray(value)) return [`${p} must be an object`];
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) problems.push(`${p}.${key} is missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined && value[key] !== null) problems.push(...checkAgainstSchema(value[key], sub, `${p}.${key}`));
    }
  } else if (t === 'ARRAY') {
    if (!Array.isArray(value)) return [`${p} must be an array`];
    value.forEach((v, i) => problems.push(...checkAgainstSchema(v, schema.items, `${p}[${i}]`)));
  } else if (t === 'STRING') {
    if (typeof value !== 'string') problems.push(`${p} must be a string`);
    else if (schema.enum && !schema.enum.includes(value)) problems.push(`${p} must be one of ${schema.enum.join('|')}`);
  } else if (t === 'INTEGER') {
    if (!Number.isInteger(value)) problems.push(`${p} must be an integer`);
  } else if (t === 'NUMBER') {
    if (typeof value !== 'number' || Number.isNaN(value)) problems.push(`${p} must be a number`);
  } else if (t === 'BOOLEAN') {
    if (typeof value !== 'boolean') problems.push(`${p} must be a boolean`);
  }
  return problems;
}

// Builds a follow-up request asking the model to fix its own malformed output.
function buildCorrectionRequest(originalRequest, badText, problems) {
  const req = JSON.parse(JSON.stringify(originalRequest));
  req.contents.push({ role: 'model', parts: [{ text: String(badText || '').slice(0, 60000) || '(empty response)' }] });
  req.contents.push({
    role: 'user',
    parts: [{
      text: 'Your previous response was rejected by automated validation for these reasons:\n- ' +
        problems.slice(0, 40).join('\n- ') +
        '\nReturn the COMPLETE corrected response as a single JSON object that satisfies the response schema and all rules. Do not add commentary.',
    }],
  });
  return req;
}

/* @exports */
module.exports = { buildGeminiRequest, dataBlock, stripJsonFences, parseGeminiJson, checkAgainstSchema, buildCorrectionRequest };
