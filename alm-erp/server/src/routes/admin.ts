import { Router } from 'express';
import { z } from 'zod';
import { clientIp, currentUser, requirePermission } from '../auth/middleware.js';
import { destroyUserSessions } from '../auth/session.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound, ruleViolation } from '../lib/errors.js';
import { camelAll, likePattern, paramId, parse, Where } from '../lib/http.js';
import { hashPassword, passwordPolicyError } from '../lib/password.js';
import { logActivity } from '../services/activity.js';
import { getSetting, settingSchemas, type SettingKey } from '../services/settings.js';

export const adminRouter = Router();

adminRouter.get('/roles', requirePermission('admin.users'), async (_req, res) => {
  const rows = await query(
    `SELECT r.id, r.code, r.name, r.description,
            COALESCE((SELECT json_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp WHERE rp.role_id = r.id), '[]') AS permissions,
            (SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id)::int AS user_count
       FROM roles r ORDER BY r.name`);
  const perms = await query('SELECT code, description FROM permissions ORDER BY code');
  res.json({ items: camelAll(rows), permissions: camelAll(perms) });
});

adminRouter.get('/users', requirePermission('admin.users'), async (req, res) => {
  const f = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
  const w = new Where();
  if (f.q) w.add('(u.full_name ILIKE ? OR u.email ILIKE ?)', likePattern(f.q), likePattern(f.q));
  const rows = await query(
    `SELECT u.id, u.email, u.full_name, u.location, u.is_active, u.is_sample, u.must_change_password, u.last_login_at, u.created_at,
            (u.password_hash IS NOT NULL) AS can_sign_in, COALESCE(u.locked_until > now(), false) AS locked,
            COALESCE((SELECT json_agg(r.code ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles
       FROM users u ${w.sql} ORDER BY u.full_name`, w.params);
  res.json({ items: camelAll(rows) });
});

const roleCodes = z.array(z.string().max(20)).min(1, 'Assign at least one role.').max(20);

async function resolveRoles(db: Parameters<typeof query>[2], codes: string[]) {
  const rows = await query<{ id: number; code: string }>('SELECT id, code FROM roles WHERE code = ANY($1::text[])', [codes], db);
  if (rows.length !== new Set(codes).size) throw badRequest('Unknown role code.');
  return rows;
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  fullName: z.string().trim().min(1).max(120),
  location: z.string().trim().max(80).optional(),
  roles: roleCodes,
  temporaryPassword: z.string().max(128),
});

adminRouter.post('/users', requirePermission('admin.users'), async (req, res) => {
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const policy = passwordPolicyError(b.temporaryPassword, b.email);
  if (policy) throw badRequest(policy);
  const hash = await hashPassword(b.temporaryPassword);
  const id = await withTransaction(async (db) => {
    const exists = await queryOne('SELECT 1 FROM users WHERE lower(email) = $1', [b.email], db);
    if (exists) throw conflict('A user with this email already exists.');
    const roles = await resolveRoles(db, b.roles);
    const u = await queryOne<{ id: number }>(
      `INSERT INTO users (email, full_name, location, password_hash, must_change_password, password_changed_at)
       VALUES ($1,$2,$3,$4,true,now()) RETURNING id`, [b.email, b.fullName, b.location ?? null, hash], db);
    for (const r of roles) await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [u!.id, r.id], db);
    await logActivity(db, { actorId: me.id, category: 'security', action: 'user_created', entityType: 'user', entityId: u!.id,
      summary: `${me.fullName} created user ${b.email} with roles ${b.roles.join(', ')}`, ip: clientIp(req) });
    return u!.id;
  });
  res.status(201).json({ id });
});

const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
  roles: roleCodes.optional(),
  unlock: z.literal(true).optional(),
});

adminRouter.patch('/users/:id', requirePermission('admin.users'), async (req, res) => {
  const me = currentUser(req);
  const id = paramId(req);
  const b = parse(updateSchema, req.body);
  await withTransaction(async (db) => {
    const u = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1 FOR UPDATE', [id], db);
    if (!u) throw notFound('User');
    if (id === me.id && b.isActive === false) throw ruleViolation('You cannot deactivate your own account.');
    if (id === me.id && b.roles && !b.roles.includes('ADMIN')) throw ruleViolation('You cannot remove your own Administrator role.');
    await query(
      `UPDATE users SET full_name = COALESCE($2, full_name), location = CASE WHEN $3::boolean THEN $4 ELSE location END,
              is_active = COALESCE($5, is_active),
              locked_until = CASE WHEN $6::boolean THEN NULL ELSE locked_until END,
              failed_login_count = CASE WHEN $6::boolean THEN 0 ELSE failed_login_count END, updated_at = now()
        WHERE id = $1`,
      [id, b.fullName ?? null, b.location !== undefined, b.location ?? null, b.isActive ?? null, !!b.unlock], db);
    const changes: string[] = [];
    if (b.roles) {
      const roles = await resolveRoles(db, b.roles);
      await query('DELETE FROM user_roles WHERE user_id = $1', [id], db);
      for (const r of roles) await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [id, r.id], db);
      changes.push(`roles → ${b.roles.join(', ')}`);
    }
    if (b.isActive !== undefined) changes.push(b.isActive ? 'activated' : 'deactivated');
    if (b.unlock) changes.push('unlocked');
    if (b.isActive === false || b.roles) await destroyUserSessions(id, undefined, db); // permissions take effect immediately
    await logActivity(db, { actorId: me.id, category: 'security', action: 'user_updated', entityType: 'user', entityId: id,
      summary: `${me.fullName} updated user ${u.email}${changes.length ? ': ' + changes.join(', ') : ''}`, ip: clientIp(req) });
  });
  res.status(204).end();
});

adminRouter.post('/users/:id/reset-password', requirePermission('admin.users'), async (req, res) => {
  const me = currentUser(req);
  const id = paramId(req);
  const b = parse(z.object({ temporaryPassword: z.string().max(128) }), req.body);
  const u = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
  if (!u) throw notFound('User');
  const policy = passwordPolicyError(b.temporaryPassword, u.email);
  if (policy) throw badRequest(policy);
  const hash = await hashPassword(b.temporaryPassword);
  await withTransaction(async (db) => {
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(), failed_login_count = 0,
              locked_until = NULL, updated_at = now() WHERE id = $1`, [id, hash], db);
    await destroyUserSessions(id, id === me.id ? req.auth!.sessionId : undefined, db);
    await logActivity(db, { actorId: me.id, category: 'security', action: 'password_reset', entityType: 'user', entityId: id,
      summary: `${me.fullName} set a temporary password for ${u.email}`, ip: clientIp(req) });
  });
  res.status(204).end();
});

adminRouter.get('/settings', requirePermission('admin.settings'), async (_req, res) => {
  const rows = await query(
    `SELECT s.key, s.value, s.description, s.updated_at, u.full_name AS updated_by_name
       FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by ORDER BY s.key`);
  res.json({ items: camelAll(rows) });
});

adminRouter.put('/settings/:key', requirePermission('admin.settings'), async (req, res) => {
  const me = currentUser(req);
  const key = req.params.key as SettingKey;
  if (!(key in settingSchemas)) throw notFound('Setting');
  const { value } = parse(z.object({ value: settingSchemas[key] }), req.body);
  const before = await getSetting(key);
  await withTransaction(async (db) => {
    await query('UPDATE app_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1', [key, JSON.stringify(value), me.id], db);
    await logActivity(db, { actorId: me.id, category: 'security', action: 'setting_changed', entityType: 'setting',
      summary: `${me.fullName} changed ${key} from ${JSON.stringify(before)} to ${JSON.stringify(value)}`, ip: clientIp(req) });
  });
  res.json({ key, value });
});
