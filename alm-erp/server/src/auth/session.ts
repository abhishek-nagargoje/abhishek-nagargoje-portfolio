import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne, type Db, getPool } from '../db/pool.js';

export const SESSION_COOKIE = config.isProduction ? '__Host-alm_sid' : 'alm_sid';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  location: string | null;
  mustChangePassword: boolean;
  roles: { code: string; name: string }[];
  permissions: string[];
}

export interface AuthContext {
  user: AuthUser;
  sessionId: number;
  csrfToken: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: number, ip: string | undefined, userAgent: string | undefined, db: Db = getPool()) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, absolute_expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4), now() + make_interval(mins => $5), $6, $7)`,
    [sha256(token), userId, csrfToken, config.sessionIdleMinutes, config.sessionAbsoluteMinutes, ip ?? null, (userAgent ?? '').slice(0, 300)],
    db,
  );
  return { token, csrfToken };
}

export async function loadUser(userId: number, db: Db = getPool()): Promise<AuthUser | null> {
  const row = await queryOne<{
    id: number; email: string; full_name: string; location: string | null; must_change_password: boolean;
    roles: { code: string; name: string }[] | null; permissions: string[] | null;
  }>(
    `SELECT u.id, u.email, u.full_name, u.location, u.must_change_password,
            (SELECT json_agg(json_build_object('code', r.code, 'name', r.name) ORDER BY r.name)
               FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
            (SELECT array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
               FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = u.id) AS permissions
       FROM users u WHERE u.id = $1 AND u.is_active`,
    [userId],
    db,
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    location: row.location,
    mustChangePassword: row.must_change_password,
    roles: row.roles ?? [],
    permissions: row.permissions ?? [],
  };
}

/** Resolve a session token; extends the idle expiry (bounded by the absolute expiry). */
export async function resolveSession(token: string): Promise<AuthContext | null> {
  const row = await queryOne<{ id: number; user_id: number; csrf_token: string }>(
    `UPDATE sessions
        SET last_seen_at = now(),
            expires_at = LEAST(absolute_expires_at, now() + make_interval(mins => $2))
      WHERE token_hash = $1 AND expires_at > now() AND absolute_expires_at > now()
      RETURNING id, user_id, csrf_token`,
    [sha256(token), config.sessionIdleMinutes],
  );
  if (!row) return null;
  const user = await loadUser(row.user_id);
  if (!user) return null;
  return { user, sessionId: row.id, csrfToken: row.csrf_token };
}

export async function destroySession(sessionId: number) {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function destroyUserSessions(userId: number, exceptSessionId?: number, db: Db = getPool()) {
  await query('DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [userId, exceptSessionId ?? null], db);
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= now() OR absolute_expires_at <= now()');
}

export function cookieOptions(maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}
