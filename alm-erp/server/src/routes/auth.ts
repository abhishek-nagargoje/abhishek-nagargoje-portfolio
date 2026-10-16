import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { clientIp } from '../auth/middleware.js';
import {
  cookieOptions, createSession, destroySession, destroyUserSessions, loadUser, SESSION_COOKIE,
} from '../auth/session.js';
import { config } from '../config.js';
import { getPool, queryOne, withTransaction, query } from '../db/pool.js';
import { badRequest, HttpError, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/http.js';
import { dummyHash, hashPassword, passwordPolicyError, verifyPassword } from '../lib/password.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { logActivity } from '../services/activity.js';

export const loginIpLimiter = new RateLimiter(30, 15 * 60_000);
export const loginAccountLimiter = new RateLimiter(10, 15 * 60_000);
const passwordChangeLimiter = new RateLimiter(10, 15 * 60_000);

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const INVALID = 'Invalid email or password.';
const TOO_MANY = 'Too many sign-in attempts. Please wait a few minutes and try again.';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Password is required.').max(256),
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().max(256),
});

const emailKey = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 16);

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const ip = clientIp(req) ?? 'unknown';
  if (loginIpLimiter.hit(ip)) throw new HttpError(429, 'RATE_LIMITED', TOO_MANY);
  const { email, password } = parse(loginSchema, req.body);
  if (loginAccountLimiter.hit(email)) throw new HttpError(429, 'RATE_LIMITED', TOO_MANY);

  const user = await queryOne<{
    id: number; password_hash: string | null; is_active: boolean; locked: boolean;
  }>(
    `SELECT id, password_hash, is_active, COALESCE(locked_until > now(), false) AS locked
       FROM users WHERE lower(email) = $1`,
    [email],
  );

  if (user?.locked) {
    await logActivity(getPool(), {
      actorId: null, category: 'security', action: 'login_blocked', ip,
      summary: 'Sign-in attempt on a temporarily locked account', entityType: 'user', entityId: user.id,
    });
    throw new HttpError(429, 'RATE_LIMITED', TOO_MANY);
  }

  const ok =
    user && user.is_active && user.password_hash
      ? await verifyPassword(password, user.password_hash)
      : (await verifyPassword(password, await dummyHash()), false);

  if (!ok || !user) {
    await withTransaction(async (db) => {
      if (user) {
        await query(
          `UPDATE users SET
             failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
             locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1`,
          [user.id, MAX_FAILED, LOCK_MINUTES],
          db,
        );
      }
      await logActivity(db, {
        actorId: null, category: 'security', action: 'login_failed', ip,
        summary: 'Failed sign-in attempt', details: { account: emailKey(email), known: !!user },
        entityType: user ? 'user' : undefined, entityId: user?.id,
      });
    });
    throw new HttpError(401, 'INVALID_CREDENTIALS', INVALID);
  }

  const { token, csrfToken } = await withTransaction(async (db) => {
    await query(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id],
      db,
    );
    await logActivity(db, {
      actorId: user.id, category: 'security', action: 'login', ip, summary: 'Signed in',
      entityType: 'user', entityId: user.id,
    });
    return createSession(user.id, ip, req.headers['user-agent'], db);
  });
  loginAccountLimiter.reset(email);
  // A previous session presented with this request is discarded (prevents session fixation).
  if (req.auth) await destroySession(req.auth.sessionId);

  const authUser = await loadUser(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions(config.sessionAbsoluteMinutes * 60_000));
  res.json({ user: authUser, csrfToken });
});

authRouter.get('/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.auth) return void res.json({ user: null, csrfToken: null });
  res.json({ user: req.auth.user, csrfToken: req.auth.csrfToken });
});

authRouter.post('/logout', async (req, res) => {
  if (req.auth) {
    await destroySession(req.auth.sessionId);
    await logActivity(getPool(), {
      actorId: req.auth.user.id, category: 'security', action: 'logout', summary: 'Signed out', ip: clientIp(req),
      entityType: 'user', entityId: req.auth.user.id,
    });
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.status(204).end();
});

authRouter.post('/change-password', async (req, res) => {
  if (!req.auth) throw unauthorized();
  const me = req.auth.user;
  if (passwordChangeLimiter.hit(String(me.id))) throw new HttpError(429, 'RATE_LIMITED', TOO_MANY);
  const { currentPassword, newPassword } = parse(changeSchema, req.body);

  const row = await queryOne<{ password_hash: string | null; email: string }>(
    'SELECT password_hash, email FROM users WHERE id = $1',
    [me.id],
  );
  if (!row?.password_hash || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new HttpError(400, 'INVALID_CURRENT_PASSWORD', 'The current password is incorrect.');
  }
  const policy = passwordPolicyError(newPassword, row.email);
  if (policy) throw badRequest(policy);
  if (newPassword === currentPassword) throw badRequest('The new password must differ from the current password.');

  const hash = await hashPassword(newPassword);
  const ip = clientIp(req);
  const { token, csrfToken } = await withTransaction(async (db) => {
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now()
        WHERE id = $1`,
      [me.id, hash],
      db,
    );
    // Revoke every existing session (including this one) and issue a fresh one.
    await destroyUserSessions(me.id, undefined, db);
    await logActivity(db, {
      actorId: me.id, category: 'security', action: 'password_changed', summary: 'Changed own password', ip,
      entityType: 'user', entityId: me.id,
    });
    return createSession(me.id, ip, req.headers['user-agent'], db);
  });
  passwordChangeLimiter.reset(String(me.id));
  res.cookie(SESSION_COOKIE, token, cookieOptions(config.sessionAbsoluteMinutes * 60_000));
  res.json({ user: await loadUser(me.id), csrfToken });
});
