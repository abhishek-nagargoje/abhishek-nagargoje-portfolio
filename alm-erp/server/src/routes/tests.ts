import { Router } from 'express';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction, type Db } from '../db/pool.js';
import { notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, orderBy, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity, notify, usersWithRoles } from '../services/activity.js';
import { nextCode } from '../services/codes.js';
import { assertUserExists, resolveProjectId } from '../services/projects.js';
import { OPEN_DEFECT, PRIORITIES } from '../services/workflow.js';

export const testCasesRouter = Router();
export const testExecutionsRouter = Router();

const TEST_STATUSES = ['Draft', 'Ready', 'In Execution', 'Passed', 'Failed'] as const;

const stepSchema = z.object({
  action: z.string().trim().min(1, 'Each step needs an action.').max(1000),
  expectedResult: z.string().trim().max(1000).default(''),
});

/**
 * Derive a test case's status from its active steps and latest execution.
 * Clients can never set it: a test only passes when every active step passed in one execution.
 */
export async function recomputeTestStatus(db: Db, testCaseId: number): Promise<string> {
  const row = await queryOne<{ status: string }>(
    `WITH steps AS (SELECT id FROM test_steps WHERE test_case_id = $1 AND retired_at IS NULL),
          ex AS (SELECT * FROM test_executions WHERE test_case_id = $1 ORDER BY started_at DESC, id DESC LIMIT 1),
          res AS (SELECT r.step_id, r.result FROM test_step_results r JOIN ex ON ex.id = r.execution_id)
     SELECT CASE
       WHEN (SELECT count(*) FROM steps) = 0 THEN 'Draft'
       WHEN NOT EXISTS (SELECT 1 FROM ex) THEN 'Ready'
       WHEN (SELECT completed_at FROM ex) IS NULL THEN
         CASE WHEN EXISTS (SELECT 1 FROM res JOIN steps s ON s.id = res.step_id WHERE res.result = 'Failed') THEN 'Failed' ELSE 'In Execution' END
       WHEN EXISTS (SELECT 1 FROM res JOIN steps s ON s.id = res.step_id WHERE res.result = 'Failed') THEN 'Failed'
       WHEN EXISTS (SELECT 1 FROM steps s WHERE NOT EXISTS (SELECT 1 FROM res WHERE res.step_id = s.id)) THEN 'Ready'
       ELSE (SELECT status FROM ex) END AS status`,
    [testCaseId],
    db,
  );
  const status = row!.status;
  await query('UPDATE test_cases SET status = $2, updated_at = now() WHERE id = $1 AND status <> $2', [testCaseId, status], db);
  return status;
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(TEST_STATUSES).optional(),
  requirementId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  assigneeId: z.union([z.literal('me'), z.coerce.number().int().positive()]).optional(),
  sort: z.string().max(30).optional(),
});

testCasesRouter.get('/', async (req, res) => {
  const f = parse(listQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.q) w.add('(tc.code ILIKE ? OR tc.title ILIKE ?)', likePattern(f.q), likePattern(f.q));
  if (f.status) w.add('tc.status = ?', f.status);
  if (f.requirementId) w.add('tc.requirement_id = ?', f.requirementId);
  if (f.projectId) w.add('tc.project_id = ?', f.projectId);
  if (f.assigneeId) w.add('tc.assignee_id = ?', f.assigneeId === 'me' ? currentUser(req).id : f.assigneeId);
  const order = orderBy(f.sort, { code: 'tc.id', title: 'tc.title', status: 'tc.status', updated: 'tc.updated_at' }, 'tc.id DESC');
  const rows = await query(
    `SELECT tc.id, tc.code, tc.title, tc.priority, tc.status, tc.is_sample, tc.updated_at, tc.assignee_id,
            a.full_name AS assignee_name, tc.requirement_id, r.code AS requirement_code,
            (SELECT count(*) FROM test_steps s WHERE s.test_case_id = tc.id AND s.retired_at IS NULL)::int AS step_count,
            (SELECT max(e.started_at) FROM test_executions e WHERE e.test_case_id = tc.id) AS last_executed_at,
            count(*) OVER() AS total_count
       FROM test_cases tc LEFT JOIN users a ON a.id = tc.assignee_id LEFT JOIN requirements r ON r.id = tc.requirement_id
       ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
    w.params,
  );
  res.json(toPage(rows, page, pageSize));
});

async function loadTestCase(id: number) {
  const tc = await queryOne(
    `SELECT tc.*, a.full_name AS assignee_name, c.full_name AS created_by_name, r.code AS requirement_code, r.title AS requirement_title
       FROM test_cases tc LEFT JOIN users a ON a.id = tc.assignee_id LEFT JOIN users c ON c.id = tc.created_by
       LEFT JOIN requirements r ON r.id = tc.requirement_id WHERE tc.id = $1`, [id]);
  if (!tc) return null;
  const [steps, executions, results, defects] = await Promise.all([
    query('SELECT id, seq, action, expected_result FROM test_steps WHERE test_case_id = $1 AND retired_at IS NULL ORDER BY seq', [id]),
    query(`SELECT e.id, e.status, e.started_at, e.completed_at, u.full_name AS executed_by_name
             FROM test_executions e JOIN users u ON u.id = e.executed_by WHERE e.test_case_id = $1
            ORDER BY e.started_at DESC, e.id DESC LIMIT 50`, [id]),
    query(`SELECT r.execution_id, r.step_id, r.result, r.actual_result, r.executed_at, u.full_name AS executed_by_name
             FROM test_step_results r JOIN test_executions e ON e.id = r.execution_id JOIN users u ON u.id = r.executed_by
            WHERE e.test_case_id = $1`, [id]),
    query(`SELECT id, code, title, status, severity FROM defects WHERE test_case_id = $1 ORDER BY id`, [id]),
  ]);
  const byExec = new Map<number, unknown[]>();
  for (const r of camelAll<{ executionId: number }>(results)) {
    const list = byExec.get(r.executionId) ?? [];
    list.push(r);
    byExec.set(r.executionId, list);
  }
  return {
    ...camel(tc),
    steps: camelAll(steps),
    executions: camelAll<{ id: number }>(executions).map((e) => ({ ...e, results: byExec.get(e.id) ?? [] })),
    defects: camelAll(defects),
  };
}

testCasesRouter.get('/:id', async (req, res) => {
  const tc = await loadTestCase(paramId(req));
  if (!tc) throw notFound('Test case');
  res.json(tc);
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().max(10000).default(''),
  priority: z.enum(PRIORITIES).default('High'),
  requirementId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  steps: z.array(stepSchema).max(100).default([]),
  projectId: z.number().int().positive().optional(),
});

async function insertSteps(db: Db, testCaseId: number, steps: z.infer<typeof stepSchema>[]) {
  for (const [i, s] of steps.entries()) {
    await query('INSERT INTO test_steps (test_case_id, seq, action, expected_result) VALUES ($1,$2,$3,$4)',
      [testCaseId, i + 1, s.action, s.expectedResult], db);
  }
}

testCasesRouter.post('/', async (req, res) => {
  assertCan(req, 'test.manage');
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
    const code = await nextCode(db, 'TC');
    const row = await queryOne<{ id: number }>(
      `INSERT INTO test_cases (code, project_id, requirement_id, title, description, priority, assignee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [code, projectId, b.requirementId ?? null, b.title, b.description, b.priority, b.assigneeId ?? null, me.id], db);
    await insertSteps(db, row!.id, b.steps);
    await recomputeTestStatus(db, row!.id);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'test_case', entityId: row!.id, entityRef: code,
      summary: `${me.fullName} created test case ${code} “${b.title}” with ${b.steps.length} step(s)` });
    await notify(db, [b.assigneeId], me.id, `${me.fullName} assigned test case ${code} “${b.title}” to you`, `/tests/${row!.id}`);
    return row!.id;
  });
  res.status(201).json(await loadTestCase(id));
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  requirementId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  steps: z.array(stepSchema).max(100).optional(),
});

testCasesRouter.patch('/:id', async (req, res) => {
  assertCan(req, 'test.manage');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(updateSchema, req.body);
  await withTransaction(async (db) => {
    const cur = await queryOne<{ code: string; assignee_id: number | null }>(
      'SELECT code, assignee_id FROM test_cases WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Test case');
    if (b.requirementId) {
      const r = await queryOne('SELECT 1 FROM requirements WHERE id = $1', [b.requirementId], db);
      if (!r) throw notFound('Linked requirement');
    }
    await assertUserExists(db, b.assigneeId);
    await query(
      `UPDATE test_cases SET title = COALESCE($2, title), description = COALESCE($3, description), priority = COALESCE($4, priority),
         requirement_id = CASE WHEN $5::boolean THEN $6::int ELSE requirement_id END,
         assignee_id = CASE WHEN $7::boolean THEN $8::int ELSE assignee_id END, updated_at = now() WHERE id = $1`,
      [id, b.title ?? null, b.description ?? null, b.priority ?? null, b.requirementId !== undefined, b.requirementId ?? null,
       b.assigneeId !== undefined, b.assigneeId ?? null], db);
    if (b.steps) {
      const open = await queryOne('SELECT 1 FROM test_executions WHERE test_case_id = $1 AND completed_at IS NULL', [id], db);
      if (open) throw ruleViolation('Steps cannot be changed while an execution is in progress. Finish or cancel it first.');
      // Retire (never delete) old steps so past execution results stay traceable.
      await query('UPDATE test_steps SET retired_at = now() WHERE test_case_id = $1 AND retired_at IS NULL', [id], db);
      await insertSteps(db, id, b.steps);
    }
    const status = await recomputeTestStatus(db, id);
    await logActivity(db, { actorId: me.id, action: 'update', entityType: 'test_case', entityId: id, entityRef: cur.code,
      summary: `${cur.code} updated by ${me.fullName}${b.steps ? ` – steps replaced, status ${status}` : ''}` });
    if (b.assigneeId && b.assigneeId !== cur.assignee_id) {
      await notify(db, [b.assigneeId], me.id, `${me.fullName} assigned test case ${cur.code} to you`, `/tests/${id}`);
    }
  });
  res.json(await loadTestCase(id));
});

testCasesRouter.post('/:id/executions', async (req, res) => {
  assertCan(req, 'test.execute');
  const id = paramId(req);
  const me = currentUser(req);
  const execId = await withTransaction(async (db) => {
    const tc = await queryOne<{ code: string }>('SELECT code FROM test_cases WHERE id = $1 FOR UPDATE', [id], db);
    if (!tc) throw notFound('Test case');
    const steps = await queryOne<{ n: number }>(
      'SELECT count(*)::int AS n FROM test_steps WHERE test_case_id = $1 AND retired_at IS NULL', [id], db);
    if (!steps!.n) throw ruleViolation('This test case has no steps to execute.');
    const open = await queryOne('SELECT 1 FROM test_executions WHERE test_case_id = $1 AND completed_at IS NULL', [id], db);
    if (open) throw ruleViolation('An execution is already in progress for this test case.');
    const row = await queryOne<{ id: number }>(
      'INSERT INTO test_executions (test_case_id, executed_by) VALUES ($1,$2) RETURNING id', [id, me.id], db);
    await recomputeTestStatus(db, id);
    await logActivity(db, { actorId: me.id, action: 'execution_started', entityType: 'test_case', entityId: id, entityRef: tc.code,
      summary: `${me.fullName} started execution of ${tc.code}` });
    return row!.id;
  });
  res.status(201).json({ executionId: execId, testCase: await loadTestCase(id) });
});

const stepResultSchema = z.object({
  result: z.enum(['Passed', 'Failed']),
  actualResult: z.string().max(4000).default(''),
});

testExecutionsRouter.post('/:executionId/steps/:stepId', async (req, res) => {
  assertCan(req, 'test.execute');
  const executionId = paramId(req, 'executionId');
  const stepId = paramId(req, 'stepId');
  const me = currentUser(req);
  const b = parse(stepResultSchema, req.body);
  if (b.result === 'Failed' && !b.actualResult.trim()) {
    throw ruleViolation('Describe the actual result when a step fails.');
  }
  const out = await withTransaction(async (db) => {
    const ex = await queryOne<{ id: number; test_case_id: number; completed_at: string | null }>(
      'SELECT id, test_case_id, completed_at FROM test_executions WHERE id = $1 FOR UPDATE', [executionId], db);
    if (!ex) throw notFound('Execution');
    if (ex.completed_at) throw ruleViolation('This execution is already completed. Start a new execution to retest.');
    const step = await queryOne<{ id: number; seq: number; action: string; expected_result: string }>(
      'SELECT id, seq, action, expected_result FROM test_steps WHERE id = $1 AND test_case_id = $2 AND retired_at IS NULL',
      [stepId, ex.test_case_id], db);
    if (!step) throw notFound('Test step');
    const tc = (await queryOne<{ id: number; code: string; title: string; requirement_id: number | null; project_id: number; created_by: number; assignee_id: number | null }>(
      'SELECT id, code, title, requirement_id, project_id, created_by, assignee_id FROM test_cases WHERE id = $1', [ex.test_case_id], db))!;

    await query(
      `INSERT INTO test_step_results (execution_id, step_id, result, actual_result, executed_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (execution_id, step_id) DO UPDATE SET result = EXCLUDED.result, actual_result = EXCLUDED.actual_result,
         executed_by = EXCLUDED.executed_by, executed_at = now()`,
      [executionId, stepId, b.result, b.actualResult, me.id], db);

    let defect: { id: number; code: string } | null = null;
    if (b.result === 'Failed') {
      const existing = await queryOne<{ id: number; code: string }>(
        `SELECT id, code FROM defects WHERE test_step_id = $1 AND status = ANY($2::text[]) ORDER BY id DESC LIMIT 1`,
        [stepId, OPEN_DEFECT], db);
      if (existing) {
        await query(`INSERT INTO comments (entity_type, entity_id, author_id, body) VALUES ('defect', $1, $2, $3)`,
          [existing.id, me.id, `Step ${step.seq} failed again in execution #${executionId}. Actual: ${b.actualResult}`], db);
        defect = existing;
      } else {
        const req = tc.requirement_id
          ? await queryOne<{ assignee_id: number | null }>('SELECT assignee_id FROM requirements WHERE id = $1', [tc.requirement_id], db)
          : null;
        const assignee = req?.assignee_id ?? tc.created_by;
        const code = await nextCode(db, 'DEF');
        const row = await queryOne<{ id: number }>(
          `INSERT INTO defects (code, project_id, requirement_id, test_case_id, test_execution_id, test_step_id, title, description,
              steps_to_reproduce, expected_result, actual_result, severity, priority, assignee_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'High','Very High',$12,$13)
           ON CONFLICT (test_execution_id, test_step_id) DO NOTHING RETURNING id`,
          [code, tc.project_id, tc.requirement_id, tc.id, executionId, stepId, `${tc.code} step ${step.seq} failed: ${step.action}`.slice(0, 200),
           `Raised automatically from test execution #${executionId} of ${tc.code}.`, step.action, step.expected_result,
           b.actualResult, assignee, me.id], db);
        if (row) {
          defect = { id: row.id, code };
          await logActivity(db, { actorId: me.id, action: 'create', entityType: 'defect', entityId: row.id, entityRef: code,
            summary: `Test ${tc.code} failed – defect ${code} raised automatically` });
          const pms = await usersWithRoles(db, ['PM', 'TECH']);
          await notify(db, [assignee, tc.assignee_id, ...pms], me.id,
            `Test ${tc.code} failed at step ${step.seq} – defect ${code} raised`, `/defects/${row.id}`);
        }
      }
    }

    // Complete the execution once every active step has a result.
    const progress = await queryOne<{ total: number; done: number; failed: number }>(
      `SELECT count(s.id)::int AS total, count(r.step_id)::int AS done,
              count(*) FILTER (WHERE r.result = 'Failed')::int AS failed
         FROM test_steps s LEFT JOIN test_step_results r ON r.step_id = s.id AND r.execution_id = $2
        WHERE s.test_case_id = $1 AND s.retired_at IS NULL`, [tc.id, executionId], db);
    const p = progress!;
    if (p.done === p.total) {
      const st = p.failed ? 'Failed' : 'Passed';
      await query('UPDATE test_executions SET status = $2, completed_at = now() WHERE id = $1', [executionId, st], db);
    } else if (p.failed) {
      await query("UPDATE test_executions SET status = 'Failed' WHERE id = $1", [executionId], db);
    }
    const status = await recomputeTestStatus(db, tc.id);
    await logActivity(db, { actorId: me.id, action: 'step_executed', entityType: 'test_case', entityId: tc.id, entityRef: tc.code,
      summary: `${tc.code} step ${step.seq} ${b.result.toLowerCase()} (by ${me.fullName})` });
    if (status === 'Passed') {
      const reqAssignee = tc.requirement_id
        ? (await queryOne<{ assignee_id: number | null }>('SELECT assignee_id FROM requirements WHERE id = $1', [tc.requirement_id], db))?.assignee_id
        : null;
      const signers = await usersWithRoles(db, ['PM', 'BU']);
      await notify(db, [reqAssignee, ...signers], me.id, `Test ${tc.code} passed – ready for business sign-off`, `/tests/${tc.id}`);
      await logActivity(db, { actorId: me.id, action: 'test_passed', entityType: 'test_case', entityId: tc.id, entityRef: tc.code,
        summary: `Test ${tc.code} passed` });
    }
    return { testCaseId: tc.id, defect };
  });
  res.json({ defect: out.defect, testCase: await loadTestCase(out.testCaseId) });
});

testExecutionsRouter.post('/:executionId/cancel', async (req, res) => {
  assertCan(req, 'test.execute');
  const executionId = paramId(req, 'executionId');
  const me = currentUser(req);
  const tcId = await withTransaction(async (db) => {
    const ex = await queryOne<{ test_case_id: number; completed_at: string | null }>(
      'SELECT test_case_id, completed_at FROM test_executions WHERE id = $1 FOR UPDATE', [executionId], db);
    if (!ex) throw notFound('Execution');
    if (ex.completed_at) throw ruleViolation('This execution is already completed.');
    const n = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM test_step_results WHERE execution_id = $1', [executionId], db);
    if (n!.n === 0) await query('DELETE FROM test_executions WHERE id = $1', [executionId], db);
    // An abandoned run with results is closed as Failed: an incomplete run never counts as passed.
    else await query("UPDATE test_executions SET status = 'Failed', completed_at = now() WHERE id = $1", [executionId], db);
    await recomputeTestStatus(db, ex.test_case_id);
    await logActivity(db, { actorId: me.id, action: 'execution_cancelled', entityType: 'test_case', entityId: ex.test_case_id,
      summary: `Execution #${executionId} cancelled by ${me.fullName}` });
    return ex.test_case_id;
  });
  res.json({ testCase: await loadTestCase(tcId) });
});
