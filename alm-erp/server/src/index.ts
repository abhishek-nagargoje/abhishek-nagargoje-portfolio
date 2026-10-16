import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth/session.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { logger } from './lib/logger.js';

async function main() {
  // Apply pending schema migrations on start-up (never destructive; no data is deleted).
  const applied = await migrate((m) => logger.info(m));
  if (applied.length) logger.info('migrations applied', applied);
  const app = createApp();
  const server = app.listen(config.port, () => logger.info(`API listening on http://localhost:${config.port}`));
  const purge = setInterval(() => purgeExpiredSessions().catch((e) => logger.warn('session purge failed', e)), 60 * 60_000);
  const shutdown = () => {
    clearInterval(purge);
    server.close(() => void closePool().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('startup failed', err);
  process.exit(1);
});
