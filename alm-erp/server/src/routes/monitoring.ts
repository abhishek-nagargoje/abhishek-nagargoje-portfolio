import { Router } from 'express';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity, notify, usersWithRoles } from '../services/activity.js';
import { nextCode } from '../services/codes.js';
import { assertUserExists, resolveProjectId } from '../services/projects.js';
import { getSetting } from '../services/settings.js';
import { SEVERITIES } from '../services/workflow.js';

export const monitoringRouter = Router();

/**
 * KPIs are computed from the business documents stored in this system.
 * No external telemetry provider is connected.
 */
monitoringRouter.get('/kpis', async (_req, res) => {
  const stuckHours = await getSetting('po_stuck_after_hours');
  const [k, volume, incidents] = await Promise.all([
    queryOne(
      `SELECT
         (SELECT count(*) FROM purchase_orders WHERE status = 'Pending Approval')::int AS pos_pending_approval,
         (SELECT count(*) FROM purchase_orders WHERE status = 'Pending Approval'
             AND created_at < now() - make_interval(hours => $1))::int AS pos_stuck,
         (SELECT count(*) FROM purchase_orders WHERE created_at >= current_date)::int AS pos_created_today,
         (SELECT count(*) FROM deliveries WHERE status IN ('Created','Picked'))::int AS deliveries_awaiting_gi,
         (SELECT count(*) FROM deliveries WHERE status = 'Goods Issued')::int AS deliveries_awaiting_billing,
         (SELECT count(*) FROM (
             SELECT so.plant_id, i.material_id
               FROM sales_order_items i JOIN sales_orders so ON so.id = i.sales_order_id
              WHERE so.status IN ('Open','Partially Delivered') AND i.delivered_qty < i.quantity
              GROUP BY so.plant_id, i.material_id) d
            LEFT JOIN inventory_balances b ON b.plant_id = d.plant_id AND b.material_id = d.material_id
           WHERE COALESCE(b.on_hand, 0) = 0)::int AS stockouts_with_demand,
         (SELECT count(*) FROM monitoring_incidents WHERE status <> 'Resolved')::int AS open_incidents`,
      [stuckHours],
    ),
    query(
      `WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS day)
       SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
              (SELECT count(*) FROM purchase_orders x WHERE x.created_at::date = days.day)::int AS po,
              (SELECT count(*) FROM goods_receipts x WHERE x.posted_at::date = days.day)::int AS gr,
              (SELECT count(*) FROM sales_orders x WHERE x.created_at::date = days.day)::int AS so,
              (SELECT count(*) FROM deliveries x WHERE x.created_at::date = days.day)::int AS dl,
              (SELECT count(*) FROM invoices x WHERE x.created_at::date = days.day)::int AS inv
         FROM days ORDER BY days.day`,
    ),
    query(`SELECT severity, count(*)::int AS count FROM monitoring_incidents WHERE status <> 'Resolved' GROUP BY severity`),
  ]);
  res.json({ ...camel(k!), stuckAfterHours: stuckHours, volume: camelAll(volume), openIncidentsBySeverity: camelAll(incidents) });
});

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.union([z.enum(['Open', 'Investigating', 'Resolved']), z.literal('open')]).optional(),
  severity: z.enum(SEVERITIES).optional(),
});

monitoringRouter.get('/incidents', async (req, res) => {
  const f = parse(listQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.q) w.add('(i.code ILIKE ? OR i.title ILIKE ?)', likePattern(f.q), likePattern(f.q));
  if (f.status === 'open') w.add("i.status <> 'Resolved'");
  else if (f.status) w.add('i.status = ?', f.status);
  if (f.severity) w.add('i.severity = ?', f.severity);
  const rows = await query(
    `SELECT i.id, i.code, i.title, i.severity, i.status, i.source, i.is_sample, i.created_at, i.resolved_at,
            bp.name AS process_name, a.full_name AS assignee_name, count(*) OVER() AS total_count
       FROM monitoring_incidents i LEFT JOIN business_processes bp ON bp.id = i.process_id LEFT JOIN users a ON a.id = i.assignee_id
       ${w.sql} ORDER BY (i.status = 'Resolved'), i.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
    w.params,
  );
  res.json(toPage(rows, page, pageSize));
});

async function loadIncident(id: number) {
  const i = await queryOne(
    `SELECT i.*, bp.name AS process_name, a.full_name AS assignee_name, c.full_name AS created_by_name, rb.full_name AS resolved_by_name
       FROM monitoring_incidents i LEFT JOIN business_processes bp ON bp.id = i.process_id
       LEFT JOIN users a ON a.id = i.assignee_id LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users rb ON rb.id = i.resolved_by
      WHERE i.id = $1`, [id]);
  if (!i) return null;
  const [notes, defects] = await Promise.all([
    query(`SELECT n.id, n.kind, n.body, n.created_at, u.full_name AS author_name FROM incident_notes n
             JOIN users u ON u.id = n.author_id WHERE n.incident_id = $1 ORDER BY n.created_at, n.id`, [id]),
    query('SELECT id, code, title, status, severity FROM defects WHERE incident_id = $1 ORDER BY id', [id]),
  ]);
  return { ...camel(i), notes: camelAll(notes), defects: camelAll(defects) };
}

monitoringRouter.get('/incidents/:id', async (req, res) => {
  const i = await loadIncident(paramId(req));
  if (!i) throw notFound('Incident');
  res.json(i);
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().max(10000).default(''),
  severity: z.enum(SEVERITIES).default('High'),
  processId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  isSample: z.boolean().default(false),
});

monitoringRouter.post('/incidents', async (req, res) => {
  assertCan(req, 'incident.manage');
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const id = await withTransaction(async (db) => {
    await assertUserExists(db, b.assigneeId);
    const code = await nextCode(db, 'INC');
    const row = await queryOne<{ id: number }>(
      `INSERT INTO monitoring_incidents (code, title, description, severity, process_id, assignee_id, is_sample, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [code, b.title, b.description, b.severity, b.processId ?? null, b.assigneeId ?? null, b.isSample, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'incident', entityId: row!.id, entityRef: code,
      summary: `${me.fullName} opened incident ${code} “${b.title}”${b.isSample ? ' (demonstration)' : ''}` });
    const team = await usersWithRoles(db, ['PM', 'TECH', 'BASIS', 'PROC_CONS', 'OSCM']);
    await notify(db, [b.assigneeId, ...team], me.id, `Alert ${code} (${b.severity}): ${b.title}`, `/monitoring/incidents/${row!.id}`);
    return row!.id;
  });
  res.status(201).json(await loadIncident(id));
});

monitoringRouter.post('/incidents/:id/notes', async (req, res) => {
  assertCan(req, 'incident.manage');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(z.object({ kind: z.enum(['Investigation', 'Action']), body: z.string().trim().min(1).max(4000) }), req.body);
  await withTransaction(async (db) => {
    const i = await queryOne<{ code: string; status: string }>('SELECT code, status FROM monitoring_incidents WHERE id = $1 FOR UPDATE', [id], db);
    if (!i) throw notFound('Incident');
    if (i.status === 'Resolved') throw ruleViolation('The incident is resolved. Reopen it before adding notes.');
    await query('INSERT INTO incident_notes (incident_id, author_id, kind, body) VALUES ($1,$2,$3,$4)', [id, me.id, b.kind, b.body], db);
    if (i.status === 'Open') await query("UPDATE monitoring_incidents SET status = 'Investigating', updated_at = now() WHERE id = $1", [id], db);
    await logActivity(db, { actorId: me.id, action: 'incident_note', entityType: 'incident', entityId: id, entityRef: i.code,
      summary: `${me.fullName} added ${b.kind.toLowerCase()} note to ${i.code}` });
  });
  res.status(201).json(await loadIncident(id));
});

monitoringRouter.post('/incidents/:id/resolve', async (req, res) => {
  assertCan(req, 'incident.manage');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(z.object({ resolution: z.string().trim().min(1, 'Describe the resolution.').max(4000) }), req.body);
  await withTransaction(async (db) => {
    const i = await queryOne<{ code: string; status: string; title: string }>(
      'SELECT code, status, title FROM monitoring_incidents WHERE id = $1 FOR UPDATE', [id], db);
    if (!i) throw notFound('Incident');
    if (i.status === 'Resolved') throw ruleViolation('The incident is already resolved.');
    await query(`UPDATE monitoring_incidents SET status = 'Resolved', resolution = $2, resolved_by = $3, resolved_at = now(), updated_at = now()
                  WHERE id = $1`, [id, b.resolution, me.id], db);
    await query(`INSERT INTO incident_notes (incident_id, author_id, kind, body) VALUES ($1,$2,'Resolution',$3)`, [id, me.id, b.resolution], db);
    await logActivity(db, { actorId: me.id, action: 'resolve', entityType: 'incident', entityId: id, entityRef: i.code,
      summary: `${i.code} resolved by ${me.fullName}` });
    const team = await usersWithRoles(db, ['PM', 'TECH', 'BASIS', 'PROC_CONS', 'OSCM', 'BU']);
    await notify(db, team, me.id, `Alert ${i.code} resolved: ${i.title}`, `/monitoring/incidents/${id}`);
  });
  res.json(await loadIncident(id));
});

monitoringRouter.post('/incidents/:id/reopen', async (req, res) => {
  assertCan(req, 'incident.manage');
  const id = paramId(req);
  const me = currentUser(req);
  await withTransaction(async (db) => {
    const i = await queryOne<{ code: string; status: string }>('SELECT code, status FROM monitoring_incidents WHERE id = $1 FOR UPDATE', [id], db);
    if (!i) throw notFound('Incident');
    if (i.status !== 'Resolved') throw ruleViolation('Only resolved incidents can be reopened.');
    await query(`UPDATE monitoring_incidents SET status = 'Investigating', resolved_by = NULL, resolved_at = NULL, updated_at = now()
                  WHERE id = $1`, [id], db);
    await logActivity(db, { actorId: me.id, action: 'reopen', entityType: 'incident', entityId: id, entityRef: i.code,
      summary: `${i.code} reopened by ${me.fullName}` });
  });
  res.json(await loadIncident(id));
});

monitoringRouter.post('/incidents/:id/defect', async (req, res) => {
  assertCan(req, 'defect.create');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(z.object({
    requirementId: z.number().int().positive().nullable().optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
  }), req.body ?? {});
  const defectId = await withTransaction(async (db) => {
    const i = await queryOne<{ code: string; title: string; description: string; severity: string }>(
      'SELECT code, title, description, severity FROM monitoring_incidents WHERE id = $1', [id], db);
    if (!i) throw notFound('Incident');
    if (b.requirementId && !(await queryOne('SELECT 1 FROM requirements WHERE id = $1', [b.requirementId], db))) throw notFound('Requirement');
    await assertUserExists(db, b.assigneeId);
    const projectId = await resolveProjectId(db);
    const code = await nextCode(db, 'DEF');
    const row = await queryOne<{ id: number }>(
      `INSERT INTO defects (code, project_id, requirement_id, incident_id, title, description, severity, priority, assignee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Very High',$8,$9) RETURNING id`,
      [code, projectId, b.requirementId ?? null, id, `${i.code}: ${i.title}`.slice(0, 200),
       `Raised from monitoring incident ${i.code}.\n\n${i.description}`, i.severity, b.assigneeId ?? null, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'defect', entityId: row!.id, entityRef: code,
      summary: `${code} raised from incident ${i.code} by ${me.fullName}` });
    await notify(db, [b.assigneeId, ...(await usersWithRoles(db, ['PM', 'TECH']))], me.id,
      `${code} raised from monitoring incident ${i.code}`, `/defects/${row!.id}`);
    return row!.id;
  });
  res.status(201).json({ defectId });
});
