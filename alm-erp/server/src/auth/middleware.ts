import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { forbidden, HttpError, unauthorized } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE, type AuthContext } from './session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Attach req.auth when a valid session cookie is present (does not reject). */
export async function sessionLoader(req: Request, _res: Response, next: NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token && token.length < 200) req.auth = (await resolveSession(token)) ?? undefined;
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF and cross-origin protection for state-changing requests:
 *  - Origin (when sent) must be same-origin or explicitly allowed;
 *  - body must be JSON (blocks simple cross-site form posts);
 *  - authenticated requests must echo the per-session CSRF token in X-CSRF-Token.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    const sameOrigin = host && (origin === `http://${host}` || origin === `https://${host}`);
    if (!sameOrigin && !config.allowedOrigins.includes(origin)) {
      return next(new HttpError(403, 'ORIGIN_REJECTED', 'Cross-origin request rejected.'));
    }
  }
  const hasBody = req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0';
  if (hasBody && !req.is('application/json')) {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must use application/json.'));
  }
  if (req.auth) {
    const sent = req.headers['x-csrf-token'];
    if (typeof sent !== 'string' || sent !== req.auth.csrfToken) {
      return next(new HttpError(403, 'CSRF_REJECTED', 'Security token missing or invalid. Reload the page and try again.'));
    }
  }
  next();
}

/** Require an authenticated session; also enforces the forced password change. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.mustChangePassword) {
    return next(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing.'));
  }
  next();
}

export function can(req: Request, permission: string): boolean {
  return !!req.auth?.user.permissions.includes(permission);
}

export function assertCan(req: Request, permission: string) {
  if (!req.auth) throw unauthorized();
  if (!can(req, permission)) throw forbidden();
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      assertCan(req, permission);
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function currentUser(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress;
}
