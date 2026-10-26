// @include gemini
const prev = $('Build Evaluator Input').first(0).json;
const v = $input.first().json;
return [{ json: { model: prev.model, for_attempt: prev.for_attempt, gemini_request: buildCorrectionRequest(prev.gemini_request, v.raw_text, v.problems) } }];
