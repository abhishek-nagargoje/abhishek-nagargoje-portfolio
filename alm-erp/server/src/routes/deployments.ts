import { Router } from 'express';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { getPool, query, queryOne, withTransaction, type Db } from '../db/pool.js';
import { notFound, ruleViolation } from '../lib/errors.js';
import { camelAll, paramId, parse } from '../lib/http.js';
import { logActivity, notify, usersWithRoles } from '../services/activity.js';
import { OPEN_DEFECT } from '../services/workflow.js';

export const deploymentsRouter = Router();

interface Check { key: string; label: string; ok: boolean; detail: string }

/** Evaluate the promotion gates for the next stage of a requirement. */
export async function promotionChecks(db: Db, requirementId: number) {
  const r = await queryOne<{ id: number; code: string; title: string; status: string; deployment_stage: string }>(
    'SELECT id, code, title, status, deployment_stage FROM requirements WHERE id = $1', [requirementId], db);
  if (!r) throw notFound('Requirement');
  const t = (await queryOne<{ total: number; passed: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'Passed')::int AS passed FROM test_cases WHERE requirement_id = $1`,
    [requirementId], db))!;
  const defects = await query<{ code: string }>(
    'SELECT code FROM defects WHERE requirement_id = $1 AND status = ANY($2::text[]) ORDER BY id', [requirementId, OPEN_DEFECT], db);
  const checks: Check[] = [];
  let target: 'QA' | 'PROD' | null = null;
  if (r.deployment_stage === 'DEV') {
    target = 'QA';
    checks.push({ key: 'status', label: 'Requirement is In Test or Approved', ok: ['In Test', 'Approved'].includes(r.status), detail: `Status: ${r.status}` });
  } else if (r.deployment_stage === 'QA') {
    target = 'PROD';
    checks.push({ key: 'signoff', label: 'Business sign-off (Approved)', ok: r.status === 'Approved', detail: `Status: ${r.status}` });
    checks.push({ key: 'tests', label: 'All linked tests passed', ok: t.total > 0 && t.passed === t.total, detail: `${t.passed}/${t.total} passed` });
    checks.push({ key: 'defects', label: 'No open defects', ok: defects.length === 0, detail: defects.length ? defects.map((d) => d.code).join(', ') : 'None' });
  }
  return { requirement: r, target, checks, ready: target !== null && checks.every((c) => c.ok) };
}

deploymentsRouter.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT r.id, r.code, r.title, r.status, r.deployment_stage, r.updated_at, bp.name AS process_name,
            (SELECT max(created_at) FROM deployment_records d WHERE d.requirement_id = r.id) AS last_promoted_at
       FROM requirements r LEFT JOIN business_processes bp ON bp.id = r.process_id
      WHERE r.status <> 'Rejected' ORDER BY r.id`);
  const history = await query(
    `SELECT d.id, d.from_stage, d.to_stage, d.notes, d.created_at, r.id AS requirement_id, r.code AS requirement_code,
            u.full_name AS performed_by_name
       FROM deployment_records d JOIN requirements r ON r.id = d.requirement_id JOIN users u ON u.id = d.performed_by
      ORDER BY d.created_at DESC LIMIT 50`);
  res.json({ items: camelAll(rows), history: camelAll(history) });
});

deploymentsRouter.get('/:id/checks', async (req, res) => {
  const out = await promotionChecks(getPool(), paramId(req));
  res.json({ target: out.target, checks: out.checks, ready: out.ready, stage: out.requirement.deployment_stage });
});

deploymentsRouter.post('/:id/promote', async (req, res) => {
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(z.object({ notes: z.string().max(2000).default('') }), req.body ?? {});
  const result = await withTransaction(async (db) => {
    await query('SELECT 1 FROM requirements WHERE id = $1 FOR UPDATE', [id], db);
    const { requirement: r, target, checks, ready } = await promotionChecks(db, id);
    if (!target) throw ruleViolation(`${r.code} is already in PROD.`);
    assertCan(req, target === 'QA' ? 'deploy.qa' : 'deploy.prod');
    if (!ready) {
      const failed = checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
      throw ruleViolation(`Promotion to ${target} blocked: ${failed.join('; ')}.`, { checks });
    }
    await query('UPDATE requirements SET deployment_stage = $2, updated_at = now() WHERE id = $1', [id, target], db);
    await query(
      `INSERT INTO deployment_records (requirement_id, from_stage, to_stage, performed_by, notes, checks)
       VALUES ($1,$2,$3,$4,$5,$6)`, [id, r.deployment_stage, target, me.id, b.notes, JSON.stringify(checks)], db);
    await logActivity(db, { actorId: me.id, action: 'promote', entityType: 'requirement', entityId: id, entityRef: r.code,
      summary: `${r.code} “${r.title}” promotion ${r.deployment_stage} → ${target} recorded by ${me.fullName}` });
    const recipients = await usersWithRoles(db, target === 'QA' ? ['PM', 'TESTER', 'BU'] : ['PM', 'BU', 'TESTER', 'TECH', 'BASIS', 'PROC_CONS', 'PROC_HEAD']);
    await notify(db, recipients, me.id, `${r.code} “${r.title}” promoted to ${target} by ${me.fullName}`, `/requirements/${id}`);
    return { stage: target };
  });
  res.json(result);
});
