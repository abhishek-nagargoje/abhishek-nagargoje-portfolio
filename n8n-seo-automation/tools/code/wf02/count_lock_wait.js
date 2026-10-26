// Bounded wait for the master-document lock.
const cfg = $('Keyword Context').first(0).json.config;
const prev = $('Count Doc Lock Wait').isExecuted ? $('Count Doc Lock Wait').first(0).json.lock_waits : 0;
const lock = $input.first().json;
const waits = prev + 1;
return [{ json: {
  lock_waits: waits,
  wait_allowed: waits <= cfg.DOC_LOCK_MAX_WAITS,
  holder: lock.holder || null,
  error_class: 'API_TRANSIENT',
  retryable: true,
  error: `DOC_LOCK_TIMEOUT: master document locked by ${lock.holder || 'another execution'} for more than ${cfg.DOC_LOCK_MAX_WAITS * cfg.DOC_LOCK_WAIT_SECONDS}s`,
} }];
