// @mode each
const ctx = $json.ctx;
ctx.attempt = 0;
ctx.history = [];
ctx.progress_status = 'PROCESSING';
return { json: { ctx } };
