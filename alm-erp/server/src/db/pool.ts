import pg from 'pg';
import { requireDatabaseUrl } from '../config.js';
import { logger } from '../lib/logger.js';

// Return BIGINT (document numbers, counts) as JS numbers; values stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
// Keep NUMERIC as strings so money is never routed through floating point.
// DATE as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (v) => v);

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: requireDatabaseUrl(), max: 10 });
    pool.on('error', (err) => logger.error('Idle database client error', err));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T | null> {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}

/** Run fn inside a single database transaction; rolls back on any thrown error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
