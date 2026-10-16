import { Router } from 'express';
import { z } from 'zod';
import { can, currentUser } from '../auth/middleware.js';
import { query, queryOne } from '../db/pool.js';
import { camel, camelAll, parse } from '../lib/http.js';
import { OPEN_DEFECT } from '../services/workflow.js';

export const dashboardRouter = Router();

const countsBy = (rows: { key: string; count: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.count]));

/** Overview cards. Every figure is computed from stored records; nothing is generated. */
dashboardRouter.get('/overview', async (req, res) => {
  const me = currentUser(req);
  const { projectId: requested } = parse(z.object({ projectId: z.coerce.number().int().positive().optional() }), req.query);
  const project = requested
    ? await queryOne('SELECT * FROM projects WHERE id = $1', [requested])
    : await queryOne('SELECT * FROM projects ORDER BY id LIMIT 1');
  if (!project) return void res.json({ project: null });
  const pid = project.id as number;

  const [phases, taskStatus, today, myOpen, upcoming, myUpcoming, reqStatus, testStatus, defectSeverity, proc, sales, inventory, activity, notifications] =
    await Promise.all([
      query('SELECT name, seq, start_date, end_date FROM project_phases WHERE project_id = $1 ORDER BY seq', [pid]),
      query<{ key: string; count: number }>('SELECT status AS key, count(*)::int AS count FROM tasks WHERE project_id = $1 GROUP BY status', [pid]),
      queryOne(
        `SELECT (SELECT count(*) FROM test_executions e JOIN test_cases tc ON tc.id = e.test_case_id
                  WHERE tc.project_id = $1 AND e.status = 'Failed' AND e.started_at >= current_date)::int AS failed_test_runs,
                (SELECT count(*) FROM tasks WHERE project_id = $1 AND status = 'Blocked')::int AS blocked_tasks,
                (SELECT count(*) FROM tasks WHERE project_id = $1 AND status <> 'Done' AND due_date < current_date)::int AS overdue_tasks,
                (SELECT count(*) FROM tasks WHERE project_id = $1 AND status <> 'Done' AND assignee_id IS NULL)::int AS unassigned_tasks`,
        [pid]),
      queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND assignee_id = $2 AND status <> 'Done'`, [pid, me.id]),
      query(
        `SELECT t.id, t.code, t.title, t.status, t.due_date, t.priority, u.full_name AS assignee_name
           FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.project_id = $1 AND t.status <> 'Done' AND ($2::int IS NULL OR t.assignee_id = $2)
          ORDER BY t.due_date NULLS LAST, array_position(ARRAY['Very High','High','Medium','Low'], t.priority), t.id LIMIT 5`,
        [pid, null]),
      query(
        `SELECT t.id, t.code, t.title, t.status, t.due_date, t.priority, u.full_name AS assignee_name
           FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.project_id = $1 AND t.status <> 'Done' AND t.assignee_id = $2
          ORDER BY t.due_date NULLS LAST, array_position(ARRAY['Very High','High','Medium','Low'], t.priority), t.id LIMIT 5`,
        [pid, me.id]),
      query<{ key: string; count: number }>('SELECT status AS key, count(*)::int AS count FROM requirements WHERE project_id = $1 GROUP BY status', [pid]),
      query<{ key: string; count: number }>('SELECT status AS key, count(*)::int AS count FROM test_cases WHERE project_id = $1 GROUP BY status', [pid]),
      query<{ key: string; count: number }>(
        'SELECT severity AS key, count(*)::int AS count FROM defects WHERE project_id = $1 AND status = ANY($2::text[]) GROUP BY severity', [pid, OPEN_DEFECT]),
      queryOne(
        `SELECT (SELECT count(*) FROM purchase_orders WHERE status IN ('Pending Approval','Approved','Partially Received'))::int AS open_pos,
                (SELECT count(*) FROM purchase_orders WHERE status = 'Pending Approval')::int AS pending_approval,
                (SELECT count(*) FROM purchase_orders WHERE status = 'Pending Approval' AND created_by <> $1)::int AS approvable_by_others,
                (SELECT COALESCE(sum(total_amount), 0) FROM purchase_orders
                  WHERE status IN ('Pending Approval','Approved','Partially Received'))::numeric(15,2)::text AS open_po_value,
                (SELECT count(*) FROM purchase_requisitions WHERE status = 'Open')::int AS open_prs`,
        [me.id]),
      queryOne(
        `SELECT (SELECT count(*) FROM sales_orders WHERE status IN ('Open','Partially Delivered'))::int AS open_sos,
                (SELECT count(*) FROM deliveries WHERE status <> 'Billed')::int AS open_deliveries,
                (SELECT COALESCE(sum(total_amount), 0) FROM invoices WHERE status = 'Posted')::numeric(15,2)::text AS billed_revenue`),
      queryOne(
        `SELECT (SELECT COALESCE(sum(on_hand), 0) FROM inventory_balances)::bigint AS units,
                (SELECT COALESCE(sum(b.on_hand * m.cost_price), 0) FROM inventory_balances b JOIN materials m ON m.id = b.material_id)::numeric(15,2)::text AS value,
                (SELECT COALESCE(sum(qty), 0) FROM v_incoming)::bigint AS incoming,
                (SELECT count(*) FROM v_demand d LEFT JOIN inventory_balances b ON b.plant_id = d.plant_id AND b.material_id = d.material_id
                  WHERE COALESCE(b.on_hand, 0) + COALESCE((SELECT qty FROM v_incoming i WHERE i.plant_id = d.plant_id AND i.material_id = d.material_id), 0) < d.qty)::int AS shortages,
                (SELECT count(*) FROM inventory_movements WHERE created_at >= current_date AND movement_type <> 'INITIAL')::int AS movements_today`),
      query(
        `SELECT al.id, al.summary, al.created_at, al.entity_type, al.entity_id, u.full_name AS actor_name
           FROM activity_log al LEFT JOIN users u ON u.id = al.actor_id WHERE al.category = 'business'
          ORDER BY al.created_at DESC, al.id DESC LIMIT 8`),
      query('SELECT id, message, link, created_at FROM notifications WHERE user_id = $1 AND NOT is_read ORDER BY created_at DESC LIMIT 5', [me.id]),
    ]);

  const ph = camelAll<{ name: string; startDate: string; endDate: string }>(phases);
  const todayStr = new Date().toISOString().slice(0, 10);
  const current = ph.find((p) => p.startDate <= todayStr && todayStr <= p.endDate) ?? (ph.length && todayStr > ph[ph.length - 1].endDate ? ph[ph.length - 1] : ph[0]);
  const remainingDays = current ? Math.round((Date.parse(current.endDate) - Date.parse(todayStr)) / 86_400_000) : null;

  res.json({
    project: { ...camel(project), phases: ph, currentPhase: current?.name ?? null, phaseEndsOn: current?.endDate ?? null, remainingDays },
    tasks: { byStatus: countsBy(taskStatus), assignedToMe: myOpen!.n, upcoming: camelAll(upcoming), myUpcoming: camelAll(myUpcoming) },
    today: camel(today!),
    requirements: { byStatus: countsBy(reqStatus) },
    tests: { byStatus: countsBy(testStatus) },
    defects: { openBySeverity: countsBy(defectSeverity) },
    procurement: { ...camel(proc!), canApprove: can(req, 'po.approve') },
    sales: camel(sales!),
    inventory: camel(inventory!),
    recentActivity: camelAll(activity),
    notifications: camelAll(notifications),
  });
});

/** Launchpad: personal to-dos and headline tiles. */
dashboardRouter.get('/home', async (req, res) => {
  const me = currentUser(req);
  const [mine, approvals, tiles] = await Promise.all([
    query(
      `(SELECT 'task' AS kind, id, code, title, priority, status, updated_at, '/tasks/' || id AS link FROM tasks
          WHERE assignee_id = $1 AND status <> 'Done')
       UNION ALL (SELECT 'requirement', id, code, title, priority, status, updated_at, '/requirements/' || id FROM requirements
          WHERE assignee_id = $1 AND status NOT IN ('Approved','Rejected'))
       UNION ALL (SELECT 'test', id, code, title, priority, status, updated_at, '/tests/' || id FROM test_cases
          WHERE assignee_id = $1 AND status <> 'Passed')
       UNION ALL (SELECT 'defect', id, code, title, priority, status, updated_at, '/defects/' || id FROM defects
          WHERE assignee_id = $1 AND status = ANY($2::text[]))
       ORDER BY updated_at DESC LIMIT 12`,
      [me.id, OPEN_DEFECT]),
    can(req, 'po.approve')
      ? query(
          `SELECT po.id, po.number, po.net_amount, po.created_at, u.full_name AS created_by_name, v.name AS vendor_name
             FROM purchase_orders po JOIN users u ON u.id = po.created_by JOIN companies v ON v.id = po.vendor_id
            WHERE po.status = 'Pending Approval' AND po.created_by <> $1 ORDER BY po.created_at LIMIT 6`, [me.id])
      : Promise.resolve([]),
    queryOne(
      `SELECT (SELECT count(*) FROM notifications WHERE user_id = $1 AND NOT is_read)::int AS unread_notifications,
              (SELECT count(*) FROM purchase_orders WHERE status IN ('Pending Approval','Approved','Partially Received'))::int AS open_pos,
              (SELECT count(*) FROM purchase_orders WHERE status = 'Pending Approval')::int AS pending_approval,
              (SELECT count(*) FROM sales_orders WHERE status IN ('Open','Partially Delivered'))::int AS open_sos,
              (SELECT COALESCE(sum(on_hand), 0) FROM inventory_balances)::bigint AS stock_units,
              (SELECT count(*) FROM defects WHERE status = ANY($2::text[]))::int AS open_defects,
              (SELECT count(*) FROM requirements WHERE status NOT IN ('Approved','Rejected'))::int AS open_requirements,
              (SELECT count(*) FROM monitoring_incidents WHERE status <> 'Resolved')::int AS open_incidents,
              (SELECT COALESCE(sum(total_amount), 0) FROM invoices WHERE status = 'Posted')::numeric(15,2)::text AS billed_revenue`,
      [me.id, OPEN_DEFECT]),
  ]);
  res.json({ todos: camelAll(mine), approvals: camelAll(approvals), tiles: camel(tiles!) });
});
