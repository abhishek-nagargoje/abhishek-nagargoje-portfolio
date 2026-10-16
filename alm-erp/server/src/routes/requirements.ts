import { Router } from 'express';
import { z } from 'zod';
import { assertCan, can, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { forbidden, notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, orderBy, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity, notify, usersWithRoles } from '../services/activity.js';
import { nextCode } from '../services/codes.js';
import { assertUserExists, resolveProjectId } from '../services/projects.js';
import {
  assertTransition, FIT, PRIORITIES, REQUIREMENT_STATUSES, requirementTransitions,
} from '../services/workflow.js';

export const requirementsRouter = Router();

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  processId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  assigneeId: z.union([z.literal('me'), z.coerce.number().int().positive()]).optional(),
  stage: z.enum(['DEV', 'QA', 'PROD']).optional(),
  sort: z.string().max(30).optional(),
});

requirementsRouter.get('/', async (req, res) => {
  const f = parse(listQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.q) w.add('(r.code ILIKE ? OR r.title ILIKE ? OR r.description ILIKE ?)', ...Array(3).fill(likePattern(f.q)));
  if (f.status) w.add('r.status = ?', f.status);
  if (f.priority) w.add('r.priority = ?', f.priority);
  if (f.processId) w.add('r.process_id = ?', f.processId);
  if (f.projectId) w.add('r.project_id = ?', f.projectId);
  if (f.stage) w.add('r.deployment_stage = ?', f.stage);
  if (f.assigneeId) w.add('r.assignee_id = ?', f.assigneeId === 'me' ? currentUser(req).id : f.assigneeId);
  const order = orderBy(f.sort, { code: 'r.id', title: 'r.title', priority: "array_position(ARRAY['Very High','High','Medium','Low'], r.priority)", status: 'r.status', updated: 'r.updated_at' }, 'r.id DESC');
  const rows = await query(
    `SELECT r.id, r.code, r.title, r.priority, r.status, r.fit_decision, r.deployment_stage, r.is_sample,
            r.created_at, r.updated_at, r.assignee_id, a.full_name AS assignee_name, r.process_id, bp.name AS process_name,
            (SELECT count(*) FROM tasks t WHERE t.requirement_id = r.id)::int AS task_count,
            (SELECT count(*) FROM test_cases tc WHERE tc.requirement_id = r.id)::int AS test_count,
            count(*) OVER() AS total_count
       FROM requirements r
       LEFT JOIN users a ON a.id = r.assignee_id
       LEFT JOIN business_processes bp ON bp.id = r.process_id
       ${w.sql}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${offset}`,
    w.params,
  );
  res.json(toPage(rows, page, pageSize));
});

export async function loadRequirement(id: number) {
  return queryOne(
    `SELECT r.*, a.full_name AS assignee_name, c.full_name AS created_by_name, ap.full_name AS approved_by_name,
            bp.name AS process_name, p.name AS project_name
       FROM requirements r
       LEFT JOIN users a ON a.id = r.assignee_id
       LEFT JOIN users c ON c.id = r.created_by
       LEFT JOIN users ap ON ap.id = r.approved_by
       LEFT JOIN business_processes bp ON bp.id = r.process_id
       JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1`,
    [id],
  );
}

requirementsRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const r = await loadRequirement(id);
  if (!r) throw notFound('Requirement');
  const [tasks, tests, defects, deployments, history] = await Promise.all([
    query(`SELECT t.id, t.code, t.title, t.status, t.priority, t.due_date, u.full_name AS assignee_name
             FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.requirement_id = $1 ORDER BY t.id`, [id]),
    query(`SELECT tc.id, tc.code, tc.title, tc.status, tc.priority, u.full_name AS assignee_name
             FROM test_cases tc LEFT JOIN users u ON u.id = tc.assignee_id WHERE tc.requirement_id = $1 ORDER BY tc.id`, [id]),
    query(`SELECT d.id, d.code, d.title, d.status, d.severity, u.full_name AS assignee_name
             FROM defects d LEFT JOIN users u ON u.id = d.assignee_id WHERE d.requirement_id = $1 ORDER BY d.id`, [id]),
    query(`SELECT dr.id, dr.from_stage, dr.to_stage, dr.notes, dr.created_at, u.full_name AS performed_by_name
             FROM deployment_records dr JOIN users u ON u.id = dr.performed_by WHERE dr.requirement_id = $1
            ORDER BY dr.created_at DESC`, [id]),
    query(`SELECT al.id, al.action, al.summary, al.created_at, u.full_name AS actor_name
             FROM activity_log al LEFT JOIN users u ON u.id = al.actor_id
            WHERE al.entity_type = 'requirement' AND al.entity_id = $1 ORDER BY al.created_at DESC LIMIT 100`, [id]),
  ]);
  res.json({
    ...camel(r),
    tasks: camelAll(tasks),
    tests: camelAll(tests),
    defects: camelAll(defects),
    deployments: camelAll(deployments),
    history: camelAll(history),
  });
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().max(10000).default(''),
  priority: z.enum(PRIORITIES).default('High'),
  processId: z.number().int().positive().nullable().optional(),
  projectId: z.number().int().positive().optional(),
  fitDecision: z.enum(FIT).default('Partly'),
  fitNotes: z.string().max(4000).default(''),
  assigneeId: z.number().int().positive().nullable().optional(),
});

requirementsRouter.post('/', async (req, res) => {
  assertCan(req, 'req.create');
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const created = await withTransaction(async (db) => {
    const projectId = await resolveProjectId(db, b.projectId);
    await assertUserExists(db, b.assigneeId);
    const code = await nextCode(db, 'REQ');
    const row = await queryOne<{ id: number; code: string; title: string }>(
      `INSERT INTO requirements (code, project_id, process_id, title, description, priority, fit_decision, fit_notes, assignee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, code, title`,
      [code, projectId, b.processId ?? null, b.title, b.description, b.priority, b.fitDecision, b.fitNotes, b.assigneeId ?? null, me.id],
      db,
    );
    const r = row!;
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'requirement', entityId: r.id, entityRef: r.code,
      summary: `${me.fullName} created ${r.code} “${r.title}”` });
    const pms = await usersWithRoles(db, ['PM']);
    await notify(db, [b.assigneeId, ...pms], me.id,
      `${me.fullName} created requirement ${r.code} “${r.title}”${b.assigneeId ? ' and assigned it to you' : ''}`,
      `/requirements/${r.id}`);
    return r;
  });
  res.status(201).json(camel((await loadRequirement(created.id))!));
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  processId: z.number().int().positive().nullable().optional(),
  fitDecision: z.enum(FIT).optional(),
  fitNotes: z.string().max(4000).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
});

requirementsRouter.patch('/:id', async (req, res) => {
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(updateSchema, req.body);

  await withTransaction(async (db) => {
    const cur = await queryOne<{
      id: number; code: string; title: string; status: (typeof REQUIREMENT_STATUSES)[number];
      assignee_id: number | null; created_by: number; priority: string; fit_decision: string; process_id: number | null;
    }>('SELECT * FROM requirements WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Requirement');

    const fieldChanges = (['title', 'description', 'priority', 'processId', 'fitDecision', 'fitNotes', 'assigneeId'] as const)
      .filter((k) => b[k] !== undefined);
    if (fieldChanges.length && !can(req, 'req.edit')) throw forbidden('You are not allowed to edit requirements.');

    const changes: string[] = [];
    if (b.status && b.status !== cur.status) {
      assertTransition('Requirement', requirementTransitions, cur.status, b.status);
      const signoffMove = b.status === 'Approved' || cur.status === 'Approved';
      if (signoffMove) {
        if (!can(req, 'req.signoff')) throw forbidden('Only a Business User, Project Manager or Procurement Head can sign off requirements.');
      } else if (!can(req, 'req.edit')) {
        throw forbidden('You are not allowed to change the requirement status.');
      }
      if (b.status === 'Approved') {
        const t = await queryOne<{ total: number; passed: number }>(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'Passed')::int AS passed
             FROM test_cases WHERE requirement_id = $1`, [id], db);
        if (!t || t.total === 0) throw ruleViolation('Sign-off blocked: no test cases are linked to this requirement.');
        if (t.passed < t.total) throw ruleViolation(`Sign-off blocked: ${t.total - t.passed} of ${t.total} linked test cases have not passed.`);
      }
      changes.push(`status ${cur.status} → ${b.status}`);
    }
    if (b.assigneeId !== undefined && b.assigneeId !== cur.assignee_id) {
      await assertUserExists(db, b.assigneeId);
      changes.push(b.assigneeId ? 'reassigned' : 'unassigned');
    }
    if (b.priority && b.priority !== cur.priority) changes.push(`priority → ${b.priority}`);
    if (b.fitDecision && b.fitDecision !== cur.fit_decision) changes.push(`fit-to-standard → ${b.fitDecision}`);

    const updated = await queryOne<{ title: string; assignee_id: number | null }>(
      `UPDATE requirements SET
         title = COALESCE($2, title), description = COALESCE($3, description), priority = COALESCE($4, priority),
         process_id = CASE WHEN $5::boolean THEN $6::int ELSE process_id END,
         fit_decision = COALESCE($7, fit_decision), fit_notes = COALESCE($8, fit_notes),
         assignee_id = CASE WHEN $9::boolean THEN $10::int ELSE assignee_id END,
         status = COALESCE($11, status),
         approved_by = CASE WHEN $11 = 'Approved' AND status <> 'Approved' THEN $12
                            WHEN $11 IS NOT NULL AND $11 <> 'Approved' THEN NULL ELSE approved_by END,
         approved_at = CASE WHEN $11 = 'Approved' AND status <> 'Approved' THEN now()
                            WHEN $11 IS NOT NULL AND $11 <> 'Approved' THEN NULL ELSE approved_at END,
         updated_at = now()
       WHERE id = $1 RETURNING title, assignee_id`,
      [id, b.title ?? null, b.description ?? null, b.priority ?? null, b.processId !== undefined, b.processId ?? null,
       b.fitDecision ?? null, b.fitNotes ?? null, b.assigneeId !== undefined, b.assigneeId ?? null, b.status ?? null, me.id],
      db,
    );
    const summary = changes.length ? changes.join(', ') : 'details updated';
    await logActivity(db, { actorId: me.id, action: b.status === 'Approved' ? 'signoff' : 'update', entityType: 'requirement',
      entityId: id, entityRef: cur.code, summary: `${cur.code}: ${summary} (by ${me.fullName})`, details: { changes } });
    if (changes.length) {
      const pms = await usersWithRoles(db, ['PM']);
      await notify(db, [updated!.assignee_id, cur.assignee_id, cur.created_by, ...pms], me.id,
        `${cur.code} “${updated!.title}”: ${summary} (by ${me.fullName})`, `/requirements/${id}`);
    }
  });
  res.json(camel((await loadRequirement(id))!));
});

/** Standard implementation task template (preserved from the original workflow). */
const TASK_TEMPLATE: { title: string; role: string }[] = [
  { title: 'Analyze approval workflow', role: 'OSCM' },
  { title: 'Configure approval threshold', role: 'PROC_CONS' },
  { title: 'Configure Procurement Head role', role: 'TECH' },
  { title: 'Test approval', role: 'TESTER' },
  { title: 'Business-user acceptance', role: 'BU' },
];

requirementsRouter.post('/:id/generate-tasks', async (req, res) => {
  assertCan(req, 'task.create');
  const id = paramId(req);
  const me = currentUser(req);
  const created = await withTransaction(async (db) => {
    const r = await queryOne<{ id: number; code: string; priority: string; project_id: number }>(
      'SELECT id, code, priority, project_id FROM requirements WHERE id = $1 FOR UPDATE', [id], db);
    if (!r) throw notFound('Requirement');
    const out: { id: number; code: string }[] = [];
    for (const t of TASK_TEMPLATE) {
      const title = `${t.title} (${r.code})`;
      const exists = await queryOne('SELECT 1 FROM tasks WHERE requirement_id = $1 AND title = $2', [id, title], db);
      if (exists) continue; // idempotent: never duplicate template tasks
      const assignee = await queryOne<{ id: number }>(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles ro ON ro.id = ur.role_id
          WHERE ro.code = $1 AND u.is_active ORDER BY u.id LIMIT 1`, [t.role], db);
      const code = await nextCode(db, 'TSK');
      const row = await queryOne<{ id: number; code: string }>(
        `INSERT INTO tasks (code, project_id, requirement_id, title, priority, assignee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code`,
        [code, r.project_id, id, title, r.priority, assignee?.id ?? null, me.id], db);
      out.push(row!);
      await notify(db, [assignee?.id], me.id, `New task ${row!.code} assigned to you: ${t.title}`, `/tasks/${row!.id}`);
    }
    await logActivity(db, { actorId: me.id, action: 'generate_tasks', entityType: 'requirement', entityId: id, entityRef: r.code,
      summary: `${me.fullName} generated ${out.length} standard task(s) for ${r.code}` });
    return out;
  });
  res.status(201).json({ created });
});
