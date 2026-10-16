import { Router } from 'express';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { getPool, query, queryOne } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { camel, camelAll, likePattern, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity } from '../services/activity.js';
import { getSetting } from '../services/settings.js';
import { OPEN_DEFECT } from '../services/workflow.js';

/** Team directory (for assignment pickers and the team page). No credentials or security fields. */
export const usersRouter = Router();

usersRouter.get('/', async (req, res) => {
  const f = parse(z.object({ q: z.string().trim().max(100).optional(), role: z.string().max(20).optional() }), req.query);
  const w = new Where();
  w.add('u.is_active');
  if (f.q) w.add('u.full_name ILIKE ?', likePattern(f.q));
  if (f.role) w.add('EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = ?)', f.role);
  const rows = await query(
    `SELECT u.id, u.full_name, u.location, u.is_sample,
            COALESCE((SELECT json_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles,
            ((SELECT count(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'Done')
             + (SELECT count(*) FROM requirements r WHERE r.assignee_id = u.id AND r.status NOT IN ('Approved','Rejected'))
             + (SELECT count(*) FROM test_cases tc WHERE tc.assignee_id = u.id AND tc.status <> 'Passed')
             + (SELECT count(*) FROM defects d WHERE d.assignee_id = u.id AND d.status = ANY($${w.params.length + 1}::text[])))::int AS open_items
       FROM users u ${w.sql} ORDER BY u.full_name`, [...w.params, OPEN_DEFECT]);
  res.json({ items: camelAll(rows) });
});

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT p.id, p.code, p.name, p.customer, p.status, p.is_sample,
            (SELECT name FROM project_phases ph WHERE ph.project_id = p.id AND current_date BETWEEN ph.start_date AND ph.end_date
              ORDER BY seq LIMIT 1) AS current_phase
       FROM projects p ORDER BY p.id`);
  res.json({ items: camelAll(rows) });
});

projectsRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const p = await queryOne('SELECT * FROM projects WHERE id = $1', [id]);
  if (!p) throw notFound('Project');
  const phases = await query('SELECT id, name, seq, start_date, end_date FROM project_phases WHERE project_id = $1 ORDER BY seq', [id]);
  res.json({ ...camel(p), phases: camelAll(phases) });
});

projectsRouter.patch('/:id', async (req, res) => {
  assertCan(req, 'project.manage');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(z.object({ status: z.enum(['On Track', 'At Risk', 'Off Track', 'Closed']) }), req.body);
  const row = await queryOne<{ code: string }>('UPDATE projects SET status = $2, updated_at = now() WHERE id = $1 RETURNING code', [id, b.status]);
  if (!row) throw notFound('Project');
  await logActivity(getPool(), { actorId: me.id, action: 'update', entityType: 'project', entityId: id, entityRef: row.code,
    summary: `Project ${row.code} status set to ${b.status} by ${me.fullName}` });
  res.json({ status: b.status });
});

export const processesRouter = Router();

/** Business processes with their steps and the number of records evidencing each step. */
processesRouter.get('/', async (_req, res) => {
  const [procs, steps, reqs, counts] = await Promise.all([
    query('SELECT id, code, name, description FROM business_processes ORDER BY seq'),
    query('SELECT id, process_id, seq, name, record_type FROM process_steps ORDER BY process_id, seq'),
    query(`SELECT r.id, r.code, r.title, r.status, r.process_id FROM requirements r WHERE r.process_id IS NOT NULL ORDER BY r.id`),
    queryOne<Record<string, number>>(
      `SELECT (SELECT count(*) FROM requirements)::int AS requirement,
              (SELECT count(*) FROM purchase_requisitions)::int AS "PR",
              (SELECT count(*) FROM purchase_orders)::int AS "PO",
              (SELECT count(*) FROM goods_receipts)::int AS "GR",
              (SELECT count(*) FROM sales_orders)::int AS "SO",
              (SELECT count(*) FROM deliveries)::int AS "DL",
              (SELECT count(*) FROM deliveries WHERE status IN ('Goods Issued','Billed'))::int AS "GI",
              (SELECT count(*) FROM invoices)::int AS "INV",
              (SELECT count(*) FROM purchase_requisitions WHERE source = 'MRP')::int AS "MRP"`),
  ]);
  const stepRows = camelAll<{ processId: number; recordType: string | null }>(steps);
  const reqRows = camelAll<{ processId: number }>(reqs);
  res.json({
    items: camelAll<{ id: number }>(procs).map((p) => ({
      ...p,
      steps: stepRows.filter((s) => s.processId === p.id).map((s) => ({
        ...s,
        tracked: s.recordType !== null,
        recordCount: s.recordType ? counts![s.recordType] ?? 0 : null,
      })),
      requirements: reqRows.filter((r) => r.processId === p.id),
    })),
  });
});

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const f = parse(z.object({ unread: z.enum(['true']).optional() }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const rows = await query(
    `SELECT n.id, n.message, n.link, n.is_read, n.created_at, a.full_name AS actor_name, count(*) OVER() AS total_count
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = $1 AND ($2::boolean = false OR NOT n.is_read)
      ORDER BY n.created_at DESC, n.id DESC LIMIT ${pageSize} OFFSET ${offset}`, [me.id, !!f.unread]);
  const unread = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [me.id]);
  res.json({ ...toPage(rows, page, pageSize), unread: unread!.n });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const me = currentUser(req);
  const unread = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [me.id]);
  res.json({ unread: unread!.n });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const me = currentUser(req);
  // Scoped to the current user: other users' notifications are indistinguishable from missing ones.
  const row = await queryOne(
    'UPDATE notifications SET is_read = true, read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id',
    [paramId(req), me.id]);
  if (!row) throw notFound('Notification');
  res.status(204).end();
});

notificationsRouter.post('/read-all', async (req, res) => {
  const me = currentUser(req);
  await query('UPDATE notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND NOT is_read', [me.id]);
  res.status(204).end();
});

export const activityRouter = Router();

activityRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    category: z.enum(['business', 'security']).default('business'),
    entityType: z.string().max(30).optional(),
    actorId: z.coerce.number().int().positive().optional(),
  }), req.query);
  if (f.category === 'security') assertCan(req, 'admin.audit');
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  w.add('al.category = ?', f.category);
  if (f.entityType) w.add('al.entity_type = ?', f.entityType);
  if (f.actorId) w.add('al.actor_id = ?', f.actorId);
  const rows = await query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.entity_ref, al.summary, al.created_at, u.full_name AS actor_name,
            ${f.category === 'security' ? 'al.ip, al.details,' : ''} count(*) OVER() AS total_count
       FROM activity_log al LEFT JOIN users u ON u.id = al.actor_id
       ${w.sql} ORDER BY al.created_at DESC, al.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

export const settingsRouter = Router();

/** Business configuration that every signed-in user may read (to explain rules in the UI). */
settingsRouter.get('/business', async (_req, res) => {
  res.json({
    poApprovalThreshold: await getSetting('po_approval_threshold'),
    gstRateBp: await getSetting('gst_rate_bp'),
    allowSelfApproval: await getSetting('allow_self_approval'),
  });
});

export const searchRouter = Router();

searchRouter.get('/', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(2).max(60) }), req.query);
  const like = likePattern(q);
  const digits = /^\d+$/.test(q) ? `${q}%` : null;
  const rows = await query(
    `(SELECT 'requirement' AS kind, id, code AS ref, title AS label, '/requirements/' || id AS link FROM requirements
        WHERE code ILIKE $1 OR title ILIKE $1 ORDER BY id DESC LIMIT 5)
     UNION ALL (SELECT 'task', id, code, title, '/tasks/' || id FROM tasks WHERE code ILIKE $1 OR title ILIKE $1 ORDER BY id DESC LIMIT 5)
     UNION ALL (SELECT 'test', id, code, title, '/tests/' || id FROM test_cases WHERE code ILIKE $1 OR title ILIKE $1 ORDER BY id DESC LIMIT 5)
     UNION ALL (SELECT 'defect', id, code, title, '/defects/' || id FROM defects WHERE code ILIKE $1 OR title ILIKE $1 ORDER BY id DESC LIMIT 5)
     UNION ALL (SELECT 'company', id, code, name, '/companies/' || id FROM companies WHERE code ILIKE $1 OR name ILIKE $1 ORDER BY code LIMIT 5)
     UNION ALL (SELECT 'material', id, code, description, '/inventory/materials/' || id FROM materials
                 WHERE code ILIKE $1 OR description ILIKE $1 ORDER BY code LIMIT 5)
     UNION ALL (SELECT 'document', id, doc_type || ' ' || number, status,
                 CASE doc_type WHEN 'PO' THEN '/procurement/purchase-orders/' || id WHEN 'SO' THEN '/sales/orders/' || id
                   WHEN 'DL' THEN '/sales/deliveries/' || id WHEN 'INV' THEN '/sales/invoices/' || id
                   ELSE '/documents?type=' || doc_type || '&number=' || number END
                  FROM document_index WHERE $2::text IS NOT NULL AND number::text LIKE $2 ORDER BY number DESC LIMIT 5)`,
    [like, digits]);
  res.json({ items: camelAll(rows) });
});
