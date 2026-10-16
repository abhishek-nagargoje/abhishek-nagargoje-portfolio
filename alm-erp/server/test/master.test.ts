import { describe, expect, it } from 'vitest';
import { Client, companyId, newMaterial, plantId } from './helpers.js';

const phases = [
  { name: 'Prepare', startDate: '2027-01-01', endDate: '2027-01-31' },
  { name: 'Explore', startDate: '2027-02-01', endDate: '2027-03-15' },
  { name: 'Realize', startDate: '2027-03-16', endDate: '2027-06-30' },
];

describe('projects', () => {
  it('creates a project with a validated phase plan and reports its KPIs, team and activity', async () => {
    const pm = await Client.as(['PM']);
    const code = `P${Date.now().toString().slice(-8)}`;
    const created = await pm.post('/projects', { code, name: 'Warehouse roll-out', customer: 'ABC Manufacturing', phases });
    expect(created.status).toBe(201);
    expect((await pm.post('/projects', { code, name: 'Duplicate', phases })).status).toBe(409);
    const overlap = await pm.post('/projects', {
      code: `${code}X`, name: 'Bad plan',
      phases: [{ name: 'Prepare', startDate: '2027-01-01', endDate: '2027-02-10' }, { name: 'Explore', startDate: '2027-02-01', endDate: '2027-03-01' }],
    });
    expect(overlap.status).toBe(422);

    const id = created.body.id;
    const req = await pm.post('/requirements', { title: 'Scanner integration', projectId: id, assigneeId: pm.user.id });
    expect(req.body.projectId).toBe(id);
    await pm.post('/tasks', { title: 'Order handheld scanners', requirementId: req.body.id, assigneeId: pm.user.id, dueDate: '2020-01-01' });

    const detail = (await pm.get(`/projects/${id}`)).body;
    expect(detail.phases.map((p: { name: string }) => p.name)).toEqual(['Prepare', 'Explore', 'Realize']);
    expect(detail.requirements).toBe(1);
    expect(detail.tasks).toBe(1);
    const me = detail.team.find((t: { id: number }) => t.id === pm.user.id);
    expect(me).toMatchObject({ requirements: 1, tasks: 1, overdue: 1 });
    expect(detail.activity.length).toBeGreaterThanOrEqual(3);
    expect((await pm.get(`/requirements?projectId=${id}`)).body.total).toBe(1);

    expect((await pm.patch(`/projects/${id}`, { status: 'At Risk' })).status).toBe(200);
    expect((await pm.get('/projects')).body.items.find((p: { id: number }) => p.id === id).status).toBe('At Risk');
  });

  it('restricts project maintenance', async () => {
    const tester = await Client.as(['TESTER']);
    expect((await tester.post('/projects', { code: 'NOPE-1', name: 'x', phases })).status).toBe(403);
    expect((await tester.patch('/projects/1', { status: 'Closed' })).status).toBe(403);
  });
});

describe('material master', () => {
  it('creates and maintains materials with validation, permissions and history', async () => {
    const wh = await Client.as(['WH']);
    const code = `M${Date.now().toString().slice(-8)}`;
    const bad = await wh.post('/materials', { code, description: 'Bad', category: 'Test', costPrice: '1.234', listPrice: '2' });
    expect(bad.status).toBe(400);
    const ok = await wh.post('/materials', { code: code.toLowerCase(), description: 'Barcode scanner', category: 'Devices', costPrice: '4200.00', listPrice: '5999.00' });
    expect(ok.status).toBe(201);
    expect((await wh.post('/materials', { code, description: 'Again', category: 'Devices', costPrice: '1', listPrice: '1' })).status).toBe(409);
    const tester = await Client.as(['TESTER']);
    expect((await tester.post('/materials', { code: `${code}Z`, description: 'x', category: 'x', costPrice: '1', listPrice: '1' })).status).toBe(403);

    expect((await wh.patch(`/materials/${ok.body.id}`, { listPrice: '5499.00' })).status).toBe(200);
    const m = (await wh.get(`/materials/${ok.body.id}`)).body;
    expect(m.code).toBe(code);
    expect(m.listPrice).toBe('5499.00');
    expect(m.history.map((h: { summary: string }) => h.summary).join(' ')).toMatch(/list price 5999.00 → 5499.00/);
  });

  it('refuses to deactivate a material with open demand', async () => {
    const admin = await Client.as(['ADMIN']);
    const mat = await newMaterial('10.00', '20.00');
    await admin.post('/sales-orders', { customerId: await companyId('C4000'), plantId: await plantId('PUN'), items: [{ materialId: mat.id, quantity: 3 }] });
    expect((await admin.patch(`/materials/${mat.id}`, { isActive: false })).status).toBe(422);
  });
});

describe('traceability and history', () => {
  it('links an existing defect to a test case and its requirement; only editors may do so', async () => {
    const pm = await Client.as(['PM']);
    const req = (await pm.post('/requirements', { title: 'Batch tracking' })).body;
    const tc = (await pm.post('/test-cases', { title: 'Batch on GR', requirementId: req.id, steps: [{ action: 'Post GR', expectedResult: 'Batch set' }] })).body;
    const def = (await pm.post('/defects', { title: 'Batch missing on GR' })).body;
    expect(def.requirementId).toBeNull();
    const bu = await Client.as(['BU']);
    expect((await bu.patch(`/defects/${def.id}`, { testCaseId: tc.id })).status).toBe(403);
    const linked = await pm.patch(`/defects/${def.id}`, { testCaseId: tc.id });
    expect(linked.body.testCaseId).toBe(tc.id);
    expect(linked.body.requirementId).toBe(req.id);
    expect((await pm.get(`/requirements/${req.id}`)).body.defects.map((d: { id: number }) => d.id)).toContain(def.id);
  });

  it('records company history', async () => {
    const sales = await Client.as(['SALES']);
    const c = await sales.post('/companies', { type: 'Customer', name: `History Test ${Date.now()}`, city: 'Pune' });
    await sales.patch(`/companies/${c.body.id}`, { paymentTerms: 'Net 45' });
    const detail = (await sales.get(`/companies/${c.body.id}`)).body;
    expect(detail.history).toHaveLength(2);
  });
});

describe('privilege escalation', () => {
  it('prevents users from granting themselves roles through the API', async () => {
    const pm = await Client.as(['PM']);
    expect((await pm.patch(`/admin/users/${pm.user.id}`, { roles: ['ADMIN'] })).status).toBe(403);
    expect((await pm.post(`/admin/users/${pm.user.id}/reset-password`, { temporaryPassword: 'Another-Pass1' })).status).toBe(403);
    const me = (await pm.get('/auth/session')).body.user;
    expect(me.roles.map((r: { code: string }) => r.code)).toEqual(['PM']);
    const admin = await Client.as(['ADMIN']);
    expect((await admin.patch(`/admin/users/${admin.user.id}`, { roles: ['PM'] })).status).toBe(422);
    expect((await admin.patch(`/admin/users/${admin.user.id}`, { isActive: false })).status).toBe(422);
  });
});

describe('dashboard', () => {
  it('lists only the signed-in user\'s tasks under "my tasks" and reports inventory from stock data', async () => {
    const pm = await Client.as(['PM']);
    const other = await Client.as(['TESTER']);
    await pm.post('/tasks', { title: 'Mine', assigneeId: pm.user.id });
    await pm.post('/tasks', { title: 'Not mine', assigneeId: other.user.id });
    const o = (await pm.get('/dashboard/overview')).body;
    expect(o.tasks.myUpcoming.length).toBeGreaterThan(0);
    expect(o.tasks.myUpcoming.every((t: { title: string }) => t.title !== 'Not mine')).toBe(true);
    expect(Number(o.inventory.units)).toBeGreaterThan(0);
    expect(Number(o.inventory.value)).toBeGreaterThan(0);
  });
});
