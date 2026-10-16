import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { camel, camelAll, parse } from '../lib/http.js';
import { logActivity, notify } from '../services/activity.js';

export const commentsRouter = Router();

const ENTITIES = {
  requirement: { table: 'requirements', link: '/requirements/' },
  task: { table: 'tasks', link: '/tasks/' },
  test_case: { table: 'test_cases', link: '/tests/' },
  defect: { table: 'defects', link: '/defects/' },
} as const;
const entityType = z.enum(['requirement', 'task', 'test_case', 'defect']);

commentsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ entityType, entityId: z.coerce.number().int().positive() }), req.query);
  const rows = await query(
    `SELECT c.id, c.body, c.created_at, c.author_id, u.full_name AS author_name
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.entity_type = $1 AND c.entity_id = $2 ORDER BY c.created_at, c.id`,
    [q.entityType, q.entityId],
  );
  res.json({ items: camelAll(rows) });
});

commentsRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const b = parse(
    z.object({ entityType, entityId: z.number().int().positive(), body: z.string().trim().min(1, 'Comment cannot be empty.').max(4000) }),
    req.body,
  );
  const meta = ENTITIES[b.entityType];
  const row = await withTransaction(async (db) => {
    // Table name comes from the fixed allow-list above, never from user input.
    const target = await queryOne<{ code: string; assignee_id: number | null; created_by: number }>(
      `SELECT code, assignee_id, created_by FROM ${meta.table} WHERE id = $1`, [b.entityId], db);
    if (!target) throw notFound('Record');
    const c = await queryOne(
      `INSERT INTO comments (entity_type, entity_id, author_id, body) VALUES ($1,$2,$3,$4)
       RETURNING id, body, created_at, author_id`, [b.entityType, b.entityId, me.id, b.body], db);
    await logActivity(db, { actorId: me.id, action: 'comment', entityType: b.entityType, entityId: b.entityId, entityRef: target.code,
      summary: `${me.fullName} commented on ${target.code}` });
    await notify(db, [target.assignee_id, target.created_by], me.id,
      `${me.fullName} commented on ${target.code}: “${b.body.slice(0, 60)}”`, `${meta.link}${b.entityId}`);
    return c!;
  });
  res.status(201).json({ ...camel(row), authorName: me.fullName });
});
