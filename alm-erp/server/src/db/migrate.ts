import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getPool } from './pool.js';

/** Apply pending SQL migrations in filename order, each in its own transaction. */
export async function migrate(log: (msg: string) => void = () => undefined): Promise<string[]> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(config.migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(config.migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise concurrent migrators.
      await client.query('SELECT pg_advisory_xact_lock(727274)');
      const again = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (again.rowCount === 0) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        done.push(file);
        log(`applied ${file}`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return done;
}
