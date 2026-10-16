/* Minimal structured logger. Never pass credentials or request bodies to it. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === 'test' ? 'error' : 'info');

function emit(level: Level, msg: string, extra?: unknown) {
  if (order[level] < (order[min] ?? 20)) return;
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, msg };
  if (extra instanceof Error) entry.err = { message: extra.message, stack: extra.stack };
  else if (extra !== undefined) entry.data = extra;
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, e?: unknown) => emit('debug', m, e),
  info: (m: string, e?: unknown) => emit('info', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  error: (m: string, e?: unknown) => emit('error', m, e),
};
