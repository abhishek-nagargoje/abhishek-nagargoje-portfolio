/**
 * Create (or update) an administrator account.
 *   INITIAL_ADMIN_EMAIL=... INITIAL_ADMIN_PASSWORD='...' pnpm create-admin [--reset-password]
 * The password is read from the environment only; it is never written to disk or logged.
 */
import { closePool, queryOne, withTransaction, query } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { hashPassword, passwordPolicyError } from '../lib/password.js';
import { logActivity } from '../services/activity.js';

const email = (process.env.INITIAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = process.env.INITIAL_ADMIN_PASSWORD ?? '';
const fullName = process.env.INITIAL_ADMIN_NAME?.trim() || 'Training Administrator';
const reset = process.argv.includes('--reset-password');

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Set INITIAL_ADMIN_EMAIL to a valid email address.');
  process.exit(1);
}

await migrate();
const existing = await queryOne<{ id: number; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE lower(email) = $1', [email]);
const needPassword = !existing || !existing.password_hash || reset;
if (needPassword) {
  const policy = passwordPolicyError(password, email);
  if (!password) {
    console.error('Set INITIAL_ADMIN_PASSWORD in the environment (use single quotes in the shell if it contains $).');
    process.exit(1);
  }
  if (policy) {
    console.error(policy);
    process.exit(1);
  }
}
const hash = needPassword ? await hashPassword(password) : null;

await withTransaction(async (db) => {
  const admin = await queryOne<{ id: number }>("SELECT id FROM roles WHERE code = 'ADMIN'", [], db);
  let id = existing?.id;
  if (!id) {
    id = (await queryOne<{ id: number }>(
      `INSERT INTO users (email, full_name, password_hash, password_changed_at) VALUES ($1,$2,$3,now()) RETURNING id`,
      [email, fullName, hash], db))!.id;
  } else if (hash) {
    await query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL,
              is_active = true, updated_at = now() WHERE id = $1`, [id, hash], db);
    await query('DELETE FROM sessions WHERE user_id = $1', [id], db);
  }
  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, admin!.id], db);
  await logActivity(db, { actorId: null, category: 'security', action: existing ? 'admin_updated' : 'admin_created',
    entityType: 'user', entityId: id, summary: `Administrator account ${email} ${existing ? (hash ? 'password reset' : 'verified') : 'created'} via CLI` });
});
console.log(existing ? (hash ? `Administrator ${email}: password updated.` : `Administrator ${email} already exists; role verified. Use --reset-password to change the password.`) : `Administrator ${email} created.`);
await closePool();
