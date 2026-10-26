// @include common, plagiarism
// One request per still-pending chunk. The URL template must come from the
// provider documentation for your account (PLAGIARISM_POLL_URL_TEMPLATE),
// e.g. https://provider.example/api/report/{hash}/{key}
const cfg = $('Keyword Context').first(0).json.config;
const state = $input.first().json;
return state.pending.map((p) => ({ json: { ...p, poll_url: buildPollUrl(cfg.PLAGIARISM_POLL_URL_TEMPLATE, p.poll_ref), state } }));
