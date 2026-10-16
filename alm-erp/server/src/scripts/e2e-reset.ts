/**
 * Reset a DISPOSABLE database for browser tests: drop schema, migrate, seed sample data, create test users.
 * Refuses to run unless NODE_ENV=test and the database name ends in _test or _e2e.
 * Users come from E2E_USERS (JSON: [{ "email", "name", "roles": [...] }]) with password E2E_PASSWORD.
 */
import { closePool, getPool, query, queryOne } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { seedSampleData } from '../db/sample-data.js';
import { hashPassword } from '../lib/password.js';

const url = new URL(process.env.DATABASE_URL ?? '');
const dbName = url.pathname.replace(/^\//, '');
if (process.env.NODE_ENV !== 'test' || !/_(test|e2e)$/.test(dbName)) {
  console.error(`Refusing to reset database "${dbName}" (NODE_ENV=${process.env.NODE_ENV}).`);
  process.exit(1);
}
const password = process.env.E2E_PASSWORD ?? '';
const users = JSON.parse(process.env.E2E_USERS ?? '[]') as { email: string; name: string; roles: string[] }[];

await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate();
await seedSampleData();
const hash = await hashPassword(password);
for (const u of users) {
  const row = await queryOne<{ id: number }>(
    'INSERT INTO users (email, full_name, password_hash, password_changed_at) VALUES ($1,$2,$3,now()) RETURNING id', [u.email, u.name, hash]);
  for (const r of u.roles) await query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [row!.id, r]);
}
console.log(`E2E database ${dbName} reset with ${users.length} users.`);
await closePool();
