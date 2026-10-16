import { Router } from 'express';
import { z } from 'zod';
import { assertCan, can, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { forbidden, notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, orderBy, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity, notify, usersWithRoles } from '../services/activity.js';
import { nextCode } from '../services/codes.js';
import { assertUserExists, resolveProjectId } from '../services/projects.js';
import { assertTransition, DEFECT_STATUSES, defectTransitions, OPEN_DEFECT, PRIORITIES, SEVERITIES } from '../services/workflow.js';

export const defectsRouter = Router();

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.union([z.enum(DEFECT_STATUSES), z.literal('open')]).optional(),
  severity: z.enum(SEVERITIES).optional(),
  requirementId: z.coerce.number().int().positive().optional(),
  testCaseId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  assigneeId: z.union([z.literal('me'), z.coerce.number().int().positive()]).optional(),
  sort: z.string().max(30).optional(),
});

defectsRouter.get('/', async (req, res) => {
  const f = parse(listQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.q) w.add('(d.code ILIKE ? OR d.title ILIKE ?)', likePattern(f.q), likePattern(f.q));
  if (f.status === 'open') w.add('d.status = ANY(?::text[])', OPEN_DEFECT);
  else if (f.status) w.add('d.status = ?', f.status);
  if (f.severity) w.add('d.severity = ?', f.severity);
  if (f.requirementId) w.add('d.requirement_id = ?', f.requirementId);
  if (f.testCaseId) w.add('d.test_case_id = ?', f.testCaseId);
  if (f.projectId) w.add('d.project_id = ?', f.projectId);
  if (f.assigneeId) w.add('d.assignee_id = ?', f.assigneeId === 'me' ? currentUser(req).id : f.assigneeId);
  const order = orderBy(f.sort, { code: 'd.id', title: 'd.title', status: 'd.status', updated: 'd.updated_at',
    severity: "array_position(ARRAY['Critical','High','Medium','Low'], d.severity)" }, 'd.id DESC');
  const rows = await query(
    `SELECT d.id, d.code, d.title, d.severity, d.priority, d.status, d.is_sample, d.updated_at, d.assignee_id,
            a.full_name AS assignee_name, d.requirement_id, r.code AS requirement_code, d.test_case_id, tc.code AS test_case_code,
            count(*) OVER() AS total_count
       FROM defects d LEFT JOIN users a ON a.id = d.assignee_id LEFT JOIN requirements r ON r.id = d.requirement_id
       LEFT JOIN test_cases tc ON tc.id = d.test_case_id
       ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
    w.params,
  );
  res.json(toPage(rows, page, pageSize));
});

async function loadDefect(id: number) {
  return queryOne(
    `SELECT d.*, a.full_name AS assignee_name, c.full_name AS created_by_name, cl.full_name AS closed_by_name,
            r.code AS requirement_code, r.title AS requirement_title, tc.code AS test_case_code, tc.title AS test_case_title,
            tc.status AS test_case_status, i.code AS incident_code
       FROM defects d LEFT JOIN users a ON a.id = d.assignee_id LEFT JOIN users c ON c.id = d.created_by
       LEFT JOIN users cl ON cl.id = d.closed_by LEFT JOIN requirements r ON r.id = d.requirement_id
       LEFT JOIN test_cases tc ON tc.id = d.test_case_id LEFT JOIN monitoring_incidents i ON i.id = d.incident_id
      WHERE d.id = $1`, [id]);
}

defectsRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const d = await loadDefect(id);
  if (!d) throw notFound('Defect');
  const history = await query(
    `SELECT al.id, al.action, al.summary, al.created_at, u.full_name AS actor_name FROM activity_log al
       LEFT JOIN users u ON u.id = al.actor_id WHERE al.entity_type = 'defect' AND al.entity_id = $1
      ORDER BY al.created_at DESC LIMIT 100`, [id]);
  res.json({ ...camel(d), history: camelAll(history) });
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().max(10000).default(''),
  stepsToReproduce: z.string().max(10000).default(''),
  expectedResult: z.string().max(4000).default(''),
  actualResult: z.string().max(4000).default(''),
  severity: z.enum(SEVERITIES).default('Medium'),
  priority: z.enum(PRIORITIES).default('High'),
  requirementId: z.number().int().positive().nullable().optional(),
  testCaseId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  projectId: z.number().int().positive().optional(),
});

defectsRouter.post('/', async (req, res) => {
  assertCan(req, 'defect.create');
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const id = await withTransaction(async (db) => {
    const projectId = await resolveProjectId(db, b.projectId);
    let requirementId = b.requirementId ?? null;
    if (b.testCaseId) {
      const tc = await queryOne<{ requirement_id: number | null }>('SELECT requirement_id FROM test_cases WHERE id = $1', [b.testCaseId], db);
      if (!tc) throw notFound('Linked test case');
      requirementId ??= tc.requirement_id;
    }
    if (requirementId) {
      const r = await queryOne('SELECT 1 FROM requirements WHERE id = $1', [requirementId], db);
      if (!r) throw notFound('Linked requirement');
    }
    await assertUserExists(db, b.assigneeId);
    const code = await nextCode(db, 'DEF');
    const row = await queryOne<{ id: number }>(
      `INSERT INTO defects (code, project_id, requirement_id, test_case_id, title, description, steps_to_reproduce,
          expected_result, actual_result, severity, priority, assignee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [code, projectId, requirementId, b.testCaseId ?? null, b.title, b.description, b.stepsToReproduce, b.expectedResult,
       b.actualResult, b.severity, b.priority, b.assigneeId ?? null, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'defect', entityId: row!.id, entityRef: code,
      summary: `${me.fullName} reported defect ${code} “${b.title}”` });
    const pms = await usersWithRoles(db, ['PM']);
    await notify(db, [b.assigneeId, ...pms], me.id, `${me.fullName} reported defect ${code} “${b.title}”`, `/defects/${row!.id}`);
    return row!.id;
  });
  res.status(201).json(camel((await loadDefect(id))!));
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  stepsToReproduce: z.string().max(10000).optional(),
  expectedResult: z.string().max(4000).optional(),
  actualResult: z.string().max(4000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  requirementId: z.number().int().positive().nullable().optional(),
  testCaseId: z.number().int().positive().nullable().optional(),
  status: z.enum(DEFECT_STATUSES).optional(),
  resolution: z.string().max(4000).optional(),
});

defectsRouter.patch('/:id', async (req, res) => {
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(updateSchema, req.body);
  await withTransaction(async (db) => {
    const cur = await queryOne<{
      code: string; title: string; status: (typeof DEFECT_STATUSES)[number]; assignee_id: number | null; created_by: number;
      test_case_id: number | null; resolution: string;
    }>('SELECT code, title, status, assignee_id, created_by, test_case_id, resolution FROM defects WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Defect');
    const isAssignee = cur.assignee_id === me.id;
    const otherFields = (['title', 'description', 'stepsToReproduce', 'expectedResult', 'actualResult', 'severity', 'priority', 'assigneeId', 'requirementId', 'testCaseId'] as const)
      .some((k) => b[k] !== undefined);
    if (!can(req, 'defect.edit') && !(isAssignee && !otherFields)) throw forbidden('You are not allowed to edit this defect.');

    const changes: string[] = [];
    if (b.status && b.status !== cur.status) {
      assertTransition('Defect', defectTransitions, cur.status, b.status);
      const resolution = (b.resolution ?? cur.resolution).trim();
      if ((b.status === 'Fixed' || b.status === 'Rejected') && !resolution) {
        throw ruleViolation(`Enter resolution details before setting the defect to ${b.status}.`);
      }
      if (b.status === 'Closed' || cur.status === 'Closed') {
        if (!can(req, 'defect.close')) throw forbidden('Only a Tester or Project Manager can close or reopen defects.');
      }
      if (b.status === 'Closed' && cur.test_case_id) {
        const tc = await queryOne<{ code: string; status: string }>('SELECT code, status FROM test_cases WHERE id = $1', [cur.test_case_id], db);
        if (tc && tc.status !== 'Passed') {
          throw ruleViolation(`Closure blocked: retest ${tc.code} must pass first (current status: ${tc.status}).`);
        }
      }
      changes.push(`status ${cur.status} → ${b.status}`);
    }
    if (b.assigneeId !== undefined && b.assigneeId !== cur.assignee_id) {
      await assertUserExists(db, b.assigneeId);
      changes.push(b.assigneeId ? 'reassigned' : 'unassigned');
    }
    // Traceability links: a linked test case brings its requirement unless one is given explicitly.
    let requirementId = b.requirementId;
    if (b.testCaseId) {
      const tc = await queryOne<{ code: string; requirement_id: number | null }>('SELECT code, requirement_id FROM test_cases WHERE id = $1', [b.testCaseId], db);
      if (!tc) throw notFound('Linked test case');
      if (requirementId === undefined && tc.requirement_id) requirementId = tc.requirement_id;
      changes.push(`linked to ${tc.code}`);
    }
    if (requirementId) {
      const r = await queryOne<{ code: string }>('SELECT code FROM requirements WHERE id = $1', [requirementId], db);
      if (!r) throw notFound('Linked requirement');
      changes.push(`linked to ${r.code}`);
    }
    if (b.testCaseId === null) changes.push('test case unlinked');
    if (requirementId === null) changes.push('requirement unlinked');
    await query(
      `UPDATE defects SET requirement_id = CASE WHEN $2::boolean THEN $3::int ELSE requirement_id END,
              test_case_id = CASE WHEN $4::boolean THEN $5::int ELSE test_case_id END WHERE id = $1`,
      [id, requirementId !== undefined, requirementId ?? null, b.testCaseId !== undefined, b.testCaseId ?? null], db);
    const u = await queryOne<{ title: string; assignee_id: number | null }>(
      `UPDATE defects SET title = COALESCE($2, title), description = COALESCE($3, description),
         steps_to_reproduce = COALESCE($4, steps_to_reproduce), expected_result = COALESCE($5, expected_result),
         actual_result = COALESCE($6, actual_result), severity = COALESCE($7, severity), priority = COALESCE($8, priority),
         assignee_id = CASE WHEN $9::boolean THEN $10::int ELSE assignee_id END,
         status = COALESCE($11, status), resolution = COALESCE($12, resolution),
         closed_by = CASE WHEN $11 = 'Closed' THEN $13 WHEN $11 IS NOT NULL THEN NULL ELSE closed_by END,
         closed_at = CASE WHEN $11 = 'Closed' THEN now() WHEN $11 IS NOT NULL THEN NULL ELSE closed_at END,
         updated_at = now()
       WHERE id = $1 RETURNING title, assignee_id`,
      [id, b.title ?? null, b.description ?? null, b.stepsToReproduce ?? null, b.expectedResult ?? null, b.actualResult ?? null,
       b.severity ?? null, b.priority ?? null, b.assigneeId !== undefined, b.assigneeId ?? null, b.status ?? null,
       b.resolution ?? null, me.id], db);
    const summary = changes.length ? changes.join(', ') : 'details updated';
    await logActivity(db, { actorId: me.id, action: b.status === 'Closed' ? 'close' : 'update', entityType: 'defect', entityId: id,
      entityRef: cur.code, summary: `${cur.code}: ${summary} (by ${me.fullName})`, details: { changes } });
    if (changes.length) {
      const extra = b.status === 'Fixed' ? await usersWithRoles(db, ['TESTER']) : [];
      await notify(db, [u!.assignee_id, cur.assignee_id, cur.created_by, ...extra], me.id,
        `${cur.code} “${u!.title}”: ${summary} (by ${me.fullName})`, `/defects/${id}`);
    }
  });
  res.json(camel((await loadDefect(id))!));
});
