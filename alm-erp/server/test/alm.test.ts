import { describe, expect, it } from 'vitest';
import { queryOne } from '../src/db/pool.js';
import { Client } from './helpers.js';

async function setup() {
  const pm = await Client.as(['PM']);
  const tester = await Client.as(['TESTER']);
  const bu = await Client.as(['BU']);
  const tech = await Client.as(['TECH']);
  const basis = await Client.as(['BASIS']);
  return { pm, tester, bu, tech, basis };
}

describe('requirements', () => {
  it('creates, edits, searches and filters', async () => {
    const { pm } = await setup();
    const created = await pm.post('/requirements', { title: 'Vendor evaluation report', priority: 'Medium', fitDecision: 'Yes' });
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^REQ-\d{3}$/);
    expect(created.body.status).toBe('New');
    const edited = await pm.patch(`/requirements/${created.body.id}`, { title: 'Vendor evaluation report v2', assigneeId: pm.user.id });
    expect(edited.body.title).toBe('Vendor evaluation report v2');
    expect(edited.body.assigneeId).toBe(pm.user.id);
    const search = await pm.get('/requirements?q=evaluation%20report%20v2');
    expect(search.body.items.map((r: { id: number }) => r.id)).toContain(created.body.id);
    const filtered = await pm.get('/requirements?priority=Low');
    expect(filtered.body.items.every((r: { priority: string }) => r.priority === 'Low')).toBe(true);
    const detail = await pm.get(`/requirements/${created.body.id}`);
    expect(detail.body.history.length).toBeGreaterThanOrEqual(2);
  });

  it('validates input and status transitions', async () => {
    const { pm } = await setup();
    expect((await pm.post('/requirements', { title: '' })).status).toBe(400);
    expect((await pm.post('/requirements', { title: 'x', priority: 'Urgent!!' })).status).toBe(400);
    const r = (await pm.post('/requirements', { title: 'Transition check' })).body;
    const bad = await pm.patch(`/requirements/${r.id}`, { status: 'Approved' });
    expect(bad.status).toBe(422);
    expect((await pm.patch(`/requirements/${r.id}`, { status: 'Fit-to-Standard' })).status).toBe(200);
  });

  it('enforces permissions', async () => {
    const { pm, tester, bu } = await setup();
    expect((await tester.post('/requirements', { title: 'Tester cannot create' })).status).toBe(403);
    const r = (await pm.post('/requirements', { title: 'Permission check' })).body;
    expect((await bu.patch(`/requirements/${r.id}`, { title: 'BU cannot edit fields' })).status).toBe(403);
  });

  it('generates the standard tasks once', async () => {
    const { pm } = await setup();
    const r = (await pm.post('/requirements', { title: 'Template tasks' })).body;
    const first = await pm.post(`/requirements/${r.id}/generate-tasks`);
    expect(first.body.created).toHaveLength(5);
    const again = await pm.post(`/requirements/${r.id}/generate-tasks`);
    expect(again.body.created).toHaveLength(0);
  });
});

describe('tasks', () => {
  it('creates, assigns, filters and enforces transitions', async () => {
    const { pm, tester } = await setup();
    const t = await pm.post('/tasks', { title: 'Prepare cut-over plan', assigneeId: tester.user.id, dueDate: '2020-01-01' });
    expect(t.status).toBe(201);
    const mine = await tester.get('/tasks?assigneeId=me');
    expect(mine.body.items.map((x: { id: number }) => x.id)).toContain(t.body.id);
    const overdue = await pm.get('/tasks?overdue=true');
    expect(overdue.body.items.map((x: { id: number }) => x.id)).toContain(t.body.id);
    expect((await tester.patch(`/tasks/${t.body.id}`, { status: 'In Progress' })).status).toBe(200);
    expect((await tester.patch(`/tasks/${t.body.id}`, { status: 'Done' })).status).toBe(200);
    const invalid = await tester.patch(`/tasks/${t.body.id}`, { status: 'Blocked' });
    expect(invalid.status).toBe(422);
    const n = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND message LIKE '%assigned task%'", [tester.user.id]);
    expect(n!.n).toBe(1);
  });
});

describe('test management, defects, sign-off and deployment', () => {
  it('runs the full quality workflow with server-side rules', async () => {
    const { pm, tester, bu, tech, basis } = await setup();
    const req = (await pm.post('/requirements', { title: 'Credit check on sales orders', assigneeId: tech.user.id })).body;
    for (const s of ['Fit-to-Standard', 'In Realization', 'In Test']) {
      expect((await pm.patch(`/requirements/${req.id}`, { status: s })).status).toBe(200);
    }
    // Sign-off is blocked while no tests exist.
    expect((await bu.patch(`/requirements/${req.id}`, { status: 'Approved' })).status).toBe(422);

    const tc = await tester.post('/test-cases', {
      title: 'Credit block', requirementId: req.id,
      steps: [{ action: 'Create SO above credit limit', expectedResult: 'Order blocked' }, { action: 'Release block', expectedResult: 'Order released' }],
    });
    expect(tc.status).toBe(201);
    expect(tc.body.status).toBe('Ready');
    // Clients cannot set the status directly.
    await tester.patch(`/test-cases/${tc.body.id}`, { status: 'Passed' });
    expect((await tester.get(`/test-cases/${tc.body.id}`)).body.status).toBe('Ready');

    const [s1, s2] = tc.body.steps;
    const ex1 = (await tester.post(`/test-cases/${tc.body.id}/executions`)).body.executionId;
    expect((await tester.post(`/test-cases/${tc.body.id}/executions`)).status).toBe(422); // one open execution at a time
    expect((await tester.post(`/test-executions/${ex1}/steps/${s1.id}`, { result: 'Failed' })).status).toBe(422); // actual result required
    const fail = await tester.post(`/test-executions/${ex1}/steps/${s1.id}`, { result: 'Failed', actualResult: 'Order saved without block' });
    expect(fail.body.defect.code).toMatch(/^DEF-/);
    expect(fail.body.testCase.status).toBe('Failed');
    const defectId = fail.body.defect.id;
    const defect = (await pm.get(`/defects/${defectId}`)).body;
    expect(defect.testCaseId).toBe(tc.body.id);
    expect(defect.requirementId).toBe(req.id);
    expect(defect.assigneeId).toBe(tech.user.id);
    await tester.post(`/test-executions/${ex1}/steps/${s2.id}`, { result: 'Passed' });
    expect((await tester.get(`/test-cases/${tc.body.id}`)).body.status).toBe('Failed');
    expect((await bu.patch(`/requirements/${req.id}`, { status: 'Approved' })).status).toBe(422);

    // DEV → QA is allowed (In Test); QA → PROD is blocked.
    expect((await tech.post(`/deployments/${req.id}/promote`)).status).toBe(200);
    expect((await basis.post(`/deployments/${req.id}/promote`)).status).toBe(422);

    // Fix the defect; closure needs a passing retest.
    expect((await tech.patch(`/defects/${defectId}`, { status: 'In Process' })).status).toBe(200);
    expect((await tech.patch(`/defects/${defectId}`, { status: 'Fixed' })).status).toBe(422); // resolution required
    expect((await tech.patch(`/defects/${defectId}`, { status: 'Fixed', resolution: 'Credit check activated' })).status).toBe(200);
    expect((await tester.patch(`/defects/${defectId}`, { status: 'Retest' })).status).toBe(200);
    expect((await tester.patch(`/defects/${defectId}`, { status: 'Closed' })).status).toBe(422); // retest not passed yet

    const ex2 = (await tester.post(`/test-cases/${tc.body.id}/executions`)).body.executionId;
    const p1 = await tester.post(`/test-executions/${ex2}/steps/${s1.id}`, { result: 'Passed' });
    expect(p1.body.testCase.status).toBe('In Execution');
    const p2 = await tester.post(`/test-executions/${ex2}/steps/${s2.id}`, { result: 'Passed' });
    expect(p2.body.testCase.status).toBe('Passed');
    expect((await tech.patch(`/defects/${defectId}`, { status: 'Closed' })).status).toBe(403); // tech lacks defect.close
    expect((await tester.patch(`/defects/${defectId}`, { status: 'Closed' })).status).toBe(200);

    // Sign-off: only signing roles.
    expect((await tester.patch(`/requirements/${req.id}`, { status: 'Approved' })).status).toBe(403);
    const signed = await bu.patch(`/requirements/${req.id}`, { status: 'Approved' });
    expect(signed.status).toBe(200);
    expect(signed.body.approvedBy).toBe(bu.user.id);

    // QA → PROD: tech lacks deploy.prod, basis succeeds; history is recorded.
    expect((await tech.post(`/deployments/${req.id}/promote`)).status).toBe(403);
    expect((await basis.post(`/deployments/${req.id}/promote`, { notes: 'CAB approved' })).status).toBe(200);
    const detail = (await pm.get(`/requirements/${req.id}`)).body;
    expect(detail.deploymentStage).toBe('PROD');
    expect(detail.deployments).toHaveLength(2);
    expect((await basis.post(`/deployments/${req.id}/promote`)).status).toBe(422);
  });

  it('does not duplicate defects for a step that keeps failing', async () => {
    const { tester } = await setup();
    const tc = (await tester.post('/test-cases', { title: 'Repeat failure', steps: [{ action: 'Do it', expectedResult: 'Works' }] })).body;
    const step = tc.steps[0].id;
    const ex1 = (await tester.post(`/test-cases/${tc.id}/executions`)).body.executionId;
    const d1 = (await tester.post(`/test-executions/${ex1}/steps/${step}`, { result: 'Failed', actualResult: 'Broken' })).body.defect;
    const ex2 = (await tester.post(`/test-cases/${tc.id}/executions`)).body.executionId;
    const d2 = (await tester.post(`/test-executions/${ex2}/steps/${step}`, { result: 'Failed', actualResult: 'Still broken' })).body.defect;
    expect(d2.id).toBe(d1.id);
  });

  it('records incidents and raises defects from them', async () => {
    const { pm, tech } = await setup();
    const inc = await tech.post('/monitoring/incidents', { title: 'POs stuck in approval', severity: 'Critical', isSample: true });
    expect(inc.status).toBe(201);
    expect(inc.body.isSample).toBe(true);
    const tester = await Client.as(['TESTER']);
    expect((await tester.post('/monitoring/incidents', { title: 'no permission' })).status).toBe(403);
    await tech.post(`/monitoring/incidents/${inc.body.id}/notes`, { kind: 'Investigation', body: 'Workflow agent missing' });
    expect((await tech.get(`/monitoring/incidents/${inc.body.id}`)).body.status).toBe('Investigating');
    const def = await pm.post(`/monitoring/incidents/${inc.body.id}/defect`, {});
    expect(def.status).toBe(201);
    expect((await tech.post(`/monitoring/incidents/${inc.body.id}/resolve`, { resolution: '' })).status).toBe(400);
    const res = await tech.post(`/monitoring/incidents/${inc.body.id}/resolve`, { resolution: 'Agent assigned' });
    expect(res.body.status).toBe('Resolved');
    expect(res.body.defects).toHaveLength(1);
  });
});
