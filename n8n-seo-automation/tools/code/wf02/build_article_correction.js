// @include gemini
// One bounded correction attempt for the writer's structured output.
const prev = $('Build Article Writer Input').first(0).json;
const v = $input.first().json;
return [{ json: { model: prev.model, gemini_request: buildCorrectionRequest(prev.gemini_request, v.raw_text, v.structure_errors) } }];
