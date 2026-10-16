import type { Db } from '../db/pool.js';
import { query } from '../db/pool.js';

export interface ActivityInput {
  actorId: number | null;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: number;
  entityRef?: string;
  details?: Record<string, unknown>;
  category?: 'business' | 'security';
  ip?: string;
}

export async function logActivity(db: Db, a: ActivityInput) {
  await query(
    `INSERT INTO activity_log (actor_id, category, action, entity_type, entity_id, entity_ref, summary, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [a.actorId, a.category ?? 'business', a.action, a.entityType ?? null, a.entityId ?? null, a.entityRef ?? null,
     a.summary, JSON.stringify(a.details ?? {}), a.ip ?? null],
    db,
  );
}

/** Notify each recipient once; the acting user never notifies themself. */
export async function notify(
  db: Db,
  recipients: (number | null | undefined)[],
  actorId: number | null,
  message: string,
  link?: string,
) {
  const ids = [...new Set(recipients.filter((x): x is number => typeof x === 'number' && x !== actorId))];
  if (!ids.length) return;
  await query(
    `INSERT INTO notifications (user_id, actor_id, message, link)
     SELECT u.id, $2, $3, $4 FROM users u WHERE u.id = ANY($1::int[]) AND u.is_active`,
    [ids, actorId, message.slice(0, 500), link ?? null],
    db,
  );
}

/** Active users holding any of the given role codes. */
export async function usersWithRoles(db: Db, roleCodes: string[]): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
      WHERE r.code = ANY($1::text[]) AND u.is_active`,
    [roleCodes],
    db,
  );
  return rows.map((r) => r.id);
}

/** Active users holding a permission (through any role), excluding administrators-only grants when asked. */
export async function usersWithPermission(db: Db, permission: string, excludeAdmin = true): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
      WHERE rp.permission_code = $1 AND u.is_active AND ($2::boolean = false OR r.code <> 'ADMIN')`,
    [permission, excludeAdmin],
    db,
  );
  return rows.map((r) => r.id);
}
