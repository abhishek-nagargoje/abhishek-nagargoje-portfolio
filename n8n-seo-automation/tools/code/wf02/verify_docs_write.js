// @include docs
// Confirms the article really is in the master document exactly once and
// complete (marker present, final paragraph present after the marker).
const fmt = $('Format Approved Article').first(0).json;
const text = documentPlainText($input.first().json);
const count = countOccurrences(text, fmt.marker);
let verification = 'VERIFIED';
let message = 'marker found once and article tail present';
if (count === 0) {
  verification = 'MISSING';
  message = 'DOC_WRITE_NOT_FOUND: marker not present in the master document after the write';
} else {
  const at = text.indexOf(fmt.marker);
  const tailAt = text.indexOf(fmt.tail_text.trim().slice(-120), at);
  if (tailAt === -1) {
    verification = 'INCOMPLETE';
    message = 'DOC_WRITE_INCOMPLETE: marker present but the end of the article was not found after it; human cleanup required';
  } else if (count > 1) {
    message = `WARNING: marker found ${count} times; the article exists but duplicates must be removed manually`;
  }
}
return [{ json: {
  verification,
  marker_count: count,
  message,
  error_class: verification === 'MISSING' ? 'API_TRANSIENT' : undefined,
  retryable: verification === 'MISSING' ? true : undefined,
  error: verification === 'MISSING' ? message : undefined,
  review_reason: verification === 'INCOMPLETE' ? message : '',
  review_failed_conditions: verification === 'INCOMPLETE' ? ['DOC_WRITE_INCOMPLETE'] : [],
} }];
