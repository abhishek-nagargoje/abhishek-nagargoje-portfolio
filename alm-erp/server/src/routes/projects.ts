import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { conflict, notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, paramId, parse } from '../lib/http.js';
import { logActivity } from '../services/activity.js';
import { OPEN_DEFECT } from '../services/workflow.js';

export const projectsRouter = Router();

const PHASES = ['Prepare', 'Explore', 'Realize', 'Deploy', 'Run'] as const;
const STATUSES = ['On Track', 'At Risk', 'Off Track', 'Closed'] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const phaseSchema = z.object({ name: z.enum(PHASES), startDate: dateStr, endDate: dateStr });
type Phase = z.infer<typeof phaseSchema>;

/** Phases follow the fixed methodology order, must not overlap and must end on/after they start. */
function validatePhases(phases: Phase[]) {
  const sorted = [...phases].sort((a, b) => PHASES.indexOf(a.name) - PHASES.indexOf(b.name));
  const names = new Set(sorted.map((p) => p.name));
  if (names.size !== sorted.length) throw ruleViolation('Each phase may appear only once.');
  sorted.forEach((p, i) => {
    if (p.endDate < p.startDate) throw ruleViolation(`${p.name} ends before it starts.`);
    const prev = sorted[i - 1];
    if (prev && p.startDate <= prev.endDate) throw ruleViolation(`${p.name} must start after ${prev.name} ends (${prev.endDate}).`);
  });
  return sorted;
}

async function writePhases(db: pg.PoolClient, projectId: number, phases: Phase[]) {
  await db.query('DELETE FROM project_phases WHERE project_id = $1', [projectId]);
  for (const p of phases) {
    await db.query('INSERT INTO project_phases (project_id, name, seq, start_date, end_date) VALUES ($1,$2,$3,$4,$5)',
      [projectId, p.name, PHASES.indexOf(p.name) + 1, p.startDate, p.endDate]);
  }
}

const PROJECT_KPIS = `
  (SELECT name FROM project_phases ph WHERE ph.project_id = p.id AND current_date BETWEEN ph.start_date AND ph.end_date ORDER BY seq LIMIT 1) AS current_phase,
  (SELECT min(start_date) FROM project_phases ph WHERE ph.project_id = p.id) AS start_date,
  (SELECT max(end_date) FROM project_phases ph WHERE ph.project_id = p.id) AS end_date,
  (SELECT count(*) FROM requirements r WHERE r.project_id = p.id)::int AS requirements,
  (SELECT count(*) FROM requirements r WHERE r.project_id = p.id AND r.status = 'Approved')::int AS requirements_approved,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id)::int AS tasks,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'Done')::int AS tasks_done,
  (SELECT count(*) FROM test_cases tc WHERE tc.project_id = p.id)::int AS tests,
  (SELECT count(*) FROM test_cases tc WHERE tc.project_id = p.id AND tc.status = 'Passed')::int AS tests_passed,
  (SELECT count(*) FROM defects d WHERE d.project_id = p.id AND d.status = ANY($1::text[]))::int AS open_defects`;

projectsRouter.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT p.id, p.code, p.name, p.customer, p.status, p.is_sample, p.updated_at, ${PROJECT_KPIS}
       FROM projects p ORDER BY (p.status = 'Closed'), p.id`, [OPEN_DEFECT]);
  res.json({ items: camelAll(rows) });
});

projectsRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const p = await queryOne(`SELECT p.*, ${PROJECT_KPIS} FROM projects p WHERE p.id = $2`, [OPEN_DEFECT, id]);
  if (!p) throw notFound('Project');
  const [phases, team, activity] = await Promise.all([
    query('SELECT id, name, seq, start_date, end_date FROM project_phases WHERE project_id = $1 ORDER BY seq', [id]),
    // Assignments: everyone with open work in this project, by item type.
    query(
      `SELECT u.id, u.full_name, u.is_sample,
              COALESCE((SELECT json_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles,
              (SELECT count(*) FROM requirements x WHERE x.project_id = $1 AND x.assignee_id = u.id AND x.status NOT IN ('Approved','Rejected'))::int AS requirements,
              (SELECT count(*) FROM tasks x WHERE x.project_id = $1 AND x.assignee_id = u.id AND x.status <> 'Done')::int AS tasks,
              (SELECT count(*) FROM tasks x WHERE x.project_id = $1 AND x.assignee_id = u.id AND x.status <> 'Done' AND x.due_date < current_date)::int AS overdue,
              (SELECT count(*) FROM test_cases x WHERE x.project_id = $1 AND x.assignee_id = u.id AND x.status <> 'Passed')::int AS tests,
              (SELECT count(*) FROM defects x WHERE x.project_id = $1 AND x.assignee_id = u.id AND x.status = ANY($2::text[]))::int AS defects
         FROM users u
        WHERE u.is_active AND (
              EXISTS (SELECT 1 FROM requirements x WHERE x.project_id = $1 AND x.assignee_id = u.id)
           OR EXISTS (SELECT 1 FROM tasks x WHERE x.project_id = $1 AND x.assignee_id = u.id)
           OR EXISTS (SELECT 1 FROM test_cases x WHERE x.project_id = $1 AND x.assignee_id = u.id)
           OR EXISTS (SELECT 1 FROM defects x WHERE x.project_id = $1 AND x.assignee_id = u.id))
        ORDER BY u.full_name`, [id, OPEN_DEFECT]),
    query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.summary, al.created_at, u.full_name AS actor_name
         FROM activity_log al LEFT JOIN users u ON u.id = al.actor_id
        WHERE al.category = 'business' AND (
              (al.entity_type = 'project' AND al.entity_id = $1)
           OR (al.entity_type = 'requirement' AND al.entity_id IN (SELECT id FROM requirements WHERE project_id = $1))
           OR (al.entity_type = 'task' AND al.entity_id IN (SELECT id FROM tasks WHERE project_id = $1))
           OR (al.entity_type = 'test_case' AND al.entity_id IN (SELECT id FROM test_cases WHERE project_id = $1))
           OR (al.entity_type = 'defect' AND al.entity_id IN (SELECT id FROM defects WHERE project_id = $1)))
        ORDER BY al.created_at DESC, al.id DESC LIMIT 40`, [id]),
  ]);
  res.json({ ...camel(p), phases: camelAll(phases), team: camelAll(team), activity: camelAll(activity) });
});

const createSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2–20 letters, digits or hyphens.'),
  name: z.string().trim().min(1, 'Name is required.').max(160),
  customer: z.string().trim().max(160).default(''),
  description: z.string().max(4000).default(''),
  status: z.enum(STATUSES).default('On Track'),
  phases: z.array(phaseSchema).min(1, 'Plan at least one phase.').max(5),
});

projectsRouter.post('/', async (req, res) => {
  assertCan(req, 'project.manage');
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const phases = validatePhases(b.phases);
  const id = await withTransaction(async (db) => {
    if (await queryOne('SELECT 1 FROM projects WHERE code = $1', [b.code], db)) throw conflict(`Project code ${b.code} is already used.`);
    const row = await queryOne<{ id: number }>(
      `INSERT INTO projects (code, name, customer, description, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [b.code, b.name, b.customer, b.description, b.status], db);
    await writePhases(db, row!.id, phases);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'project', entityId: row!.id, entityRef: b.code,
      summary: `${me.fullName} created project ${b.code} “${b.name}” with ${phases.length} phase(s)` });
    return row!.id;
  });
  res.status(201).json({ id });
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  customer: z.string().trim().max(160).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(STATUSES).optional(),
  phases: z.array(phaseSchema).min(1).max(5).optional(),
});

projectsRouter.patch('/:id', async (req, res) => {
  assertCan(req, 'project.manage');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(updateSchema, req.body);
  const phases = b.phases ? validatePhases(b.phases) : null;
  await withTransaction(async (db) => {
    const cur = await queryOne<{ code: string; status: string }>('SELECT code, status FROM projects WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Project');
    await query(
      `UPDATE projects SET name = COALESCE($2, name), customer = COALESCE($3, customer), description = COALESCE($4, description),
              status = COALESCE($5, status), updated_at = now() WHERE id = $1`,
      [id, b.name ?? null, b.customer ?? null, b.description ?? null, b.status ?? null], db);
    if (phases) await writePhases(db, id, phases);
    const changes = [
      b.status && b.status !== cur.status ? `status ${cur.status} → ${b.status}` : '',
      phases ? 'phase plan updated' : '',
      b.name || b.customer !== undefined || b.description !== undefined ? 'details updated' : '',
    ].filter(Boolean);
    await logActivity(db, { actorId: me.id, action: 'update', entityType: 'project', entityId: id, entityRef: cur.code,
      summary: `Project ${cur.code}: ${changes.join(', ') || 'no changes'} (by ${me.fullName})`, details: { changes } });
  });
  res.json({ ok: true });
});
