import { Router } from 'express';
import { z } from 'zod';
import { assertCan, can, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { forbidden, notFound } from '../lib/errors.js';
import { camel, camelAll, likePattern, orderBy, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity, notify } from '../services/activity.js';
import { nextCode } from '../services/codes.js';
import { assertUserExists, resolveProjectId } from '../services/projects.js';
import { assertTransition, PRIORITIES, TASK_STATUSES, taskTransitions } from '../services/workflow.js';

export const tasksRouter = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.union([z.enum(TASK_STATUSES), z.literal('open')]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  requirementId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  assigneeId: z.union([z.literal('me'), z.literal('none'), z.coerce.number().int().positive()]).optional(),
  overdue: z.enum(['true']).optional(),
  sort: z.string().max(30).optional(),
});

tasksRouter.get('/', async (req, res) => {
  const f = parse(listQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.q) w.add('(t.code ILIKE ? OR t.title ILIKE ?)', likePattern(f.q), likePattern(f.q));
  if (f.status === 'open') w.add("t.status <> 'Done'");
  else if (f.status) w.add('t.status = ?', f.status);
  if (f.priority) w.add('t.priority = ?', f.priority);
  if (f.requirementId) w.add('t.requirement_id = ?', f.requirementId);
  if (f.projectId) w.add('t.project_id = ?', f.projectId);
  if (f.assigneeId === 'none') w.add('t.assignee_id IS NULL');
  else if (f.assigneeId) w.add('t.assignee_id = ?', f.assigneeId === 'me' ? currentUser(req).id : f.assigneeId);
  if (f.overdue) w.add("t.due_date < current_date AND t.status <> 'Done'");
  const order = orderBy(f.sort, { code: 't.id', title: 't.title', status: 't.status', due: 't.due_date', updated: 't.updated_at',
    priority: "array_position(ARRAY['Very High','High','Medium','Low'], t.priority)" }, 't.id DESC');
  const rows = await query(
    `SELECT t.id, t.code, t.title, t.priority, t.status, t.due_date, t.is_sample, t.updated_at,
            t.assignee_id, a.full_name AS assignee_name, t.requirement_id, r.code AS requirement_code,
            count(*) OVER() AS total_count
       FROM tasks t
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN requirements r ON r.id = t.requirement_id
       ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
    w.params,
  );
  res.json(toPage(rows, page, pageSize));
});

async function loadTask(id: number) {
  return queryOne(
    `SELECT t.*, a.full_name AS assignee_name, c.full_name AS created_by_name, r.code AS requirement_code, r.title AS requirement_title
       FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by
       LEFT JOIN requirements r ON r.id = t.requirement_id WHERE t.id = $1`,
    [id],
  );
}

tasksRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const t = await loadTask(id);
  if (!t) throw notFound('Task');
  const history = await query(
    `SELECT al.id, al.action, al.summary, al.created_at, u.full_name AS actor_name FROM activity_log al
       LEFT JOIN users u ON u.id = al.actor_id WHERE al.entity_type = 'task' AND al.entity_id = $1
      ORDER BY al.created_at DESC LIMIT 100`, [id]);
  res.json({ ...camel(t), history: camelAll(history) });
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().max(10000).default(''),
  priority: z.enum(PRIORITIES).default('High'),
  requirementId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  projectId: z.number().int().positive().optional(),
});

tasksRouter.post('/', async (req, res) => {
  assertCan(req, 'task.create');
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const id = await withTransaction(async (db) => {
    let projectId = await resolveProjectId(db, b.projectId);
    if (b.requirementId) {
      const r = await queryOne<{ project_id: number }>('SELECT project_id FROM requirements WHERE id = $1', [b.requirementId], db);
      if (!r) throw notFound('Linked requirement');
      projectId = r.project_id;
    }
    await assertUserExists(db, b.assigneeId);
    const code = await nextCode(db, 'TSK');
    const row = await queryOne<{ id: number }>(
      `INSERT INTO tasks (code, project_id, requirement_id, title, description, priority, assignee_id, created_by, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [code, projectId, b.requirementId ?? null, b.title, b.description, b.priority, b.assigneeId ?? null, me.id, b.dueDate ?? null], db);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'task', entityId: row!.id, entityRef: code,
      summary: `${me.fullName} created ${code} “${b.title}”` });
    await notify(db, [b.assigneeId], me.id, `${me.fullName} assigned task ${code} “${b.title}” to you`, `/tasks/${row!.id}`);
    return row!.id;
  });
  res.status(201).json(camel((await loadTask(id))!));
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  requirementId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

tasksRouter.patch('/:id', async (req, res) => {
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(updateSchema, req.body);
  await withTransaction(async (db) => {
    const cur = await queryOne<{ code: string; title: string; status: (typeof TASK_STATUSES)[number]; assignee_id: number | null; created_by: number }>(
      'SELECT code, title, status, assignee_id, created_by FROM tasks WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Task');
    // Users with task.edit may change anything; the assignee may update the status of their own task.
    const isAssignee = cur.assignee_id === me.id;
    const otherFields = (['title', 'description', 'priority', 'requirementId', 'assigneeId', 'dueDate'] as const).some((k) => b[k] !== undefined);
    if (!can(req, 'task.edit') && !(isAssignee && !otherFields)) throw forbidden('You are not allowed to edit this task.');

    const changes: string[] = [];
    if (b.status && b.status !== cur.status) {
      assertTransition('Task', taskTransitions, cur.status, b.status);
      changes.push(`status ${cur.status} → ${b.status}`);
    }
    if (b.assigneeId !== undefined && b.assigneeId !== cur.assignee_id) {
      await assertUserExists(db, b.assigneeId);
      changes.push(b.assigneeId ? 'reassigned' : 'unassigned');
    }
    if (b.requirementId) {
      const r = await queryOne('SELECT 1 FROM requirements WHERE id = $1', [b.requirementId], db);
      if (!r) throw notFound('Linked requirement');
    }
    const u = await queryOne<{ title: string; assignee_id: number | null }>(
      `UPDATE tasks SET title = COALESCE($2, title), description = COALESCE($3, description), priority = COALESCE($4, priority),
         requirement_id = CASE WHEN $5::boolean THEN $6::int ELSE requirement_id END,
         assignee_id = CASE WHEN $7::boolean THEN $8::int ELSE assignee_id END,
         due_date = CASE WHEN $9::boolean THEN $10::date ELSE due_date END,
         status = COALESCE($11, status),
         completed_at = CASE WHEN $11 = 'Done' THEN now() WHEN $11 IS NOT NULL THEN NULL ELSE completed_at END,
         updated_at = now()
       WHERE id = $1 RETURNING title, assignee_id`,
      [id, b.title ?? null, b.description ?? null, b.priority ?? null, b.requirementId !== undefined, b.requirementId ?? null,
       b.assigneeId !== undefined, b.assigneeId ?? null, b.dueDate !== undefined, b.dueDate ?? null, b.status ?? null], db);
    const summary = changes.length ? changes.join(', ') : 'details updated';
    await logActivity(db, { actorId: me.id, action: 'update', entityType: 'task', entityId: id, entityRef: cur.code,
      summary: `${cur.code}: ${summary} (by ${me.fullName})`, details: { changes } });
    if (changes.length) {
      await notify(db, [u!.assignee_id, cur.assignee_id, cur.created_by], me.id,
        `${cur.code} “${u!.title}”: ${summary} (by ${me.fullName})`, `/tasks/${id}`);
    }
  });
  res.json(camel((await loadTask(id))!));
});
