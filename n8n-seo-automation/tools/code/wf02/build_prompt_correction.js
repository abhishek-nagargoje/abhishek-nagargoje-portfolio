// @include gemini
// One bounded correction attempt for malformed prompt-creator output.
const prev = $('Build Gemini Prompt Creator Input').first(0).json;
const v = $input.first().json;
return [{ json: { model: prev.model, gemini_request: buildCorrectionRequest(prev.gemini_request, v.raw_text, v.problems) } }];
