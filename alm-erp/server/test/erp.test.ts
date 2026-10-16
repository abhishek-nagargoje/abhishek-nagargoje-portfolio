import { describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db/pool.js';
import { fromPaise, lineAmount, taxAmount, toPaise, totals } from '../src/lib/money.js';
import { Client, companyId, key, newMaterial, plantId, stockOf } from './helpers.js';

describe('money', () => {
  it('computes amounts without floating-point error', () => {
    expect(fromPaise(lineAmount(3, '0.10'))).toBe('0.30');
    expect(fromPaise(taxAmount(toPaise('0.30'), 1800))).toBe('0.05'); // 0.054 → 0.05
    expect(fromPaise(taxAmount(toPaise('0.25'), 1800))).toBe('0.05'); // 0.045 → 0.05 (half-up)
    const t = totals([{ quantity: 7, unitPrice: '1234.57' }, { quantity: 1, unitPrice: '0.01' }], 1800);
    expect(fromPaise(t.net)).toBe('8642.00');
    expect(fromPaise(t.tax)).toBe('1555.56');
    expect(fromPaise(t.total)).toBe('10197.56');
    expect(() => toPaise('1.234')).toThrow();
  });
});

describe('procurement', () => {
  it('applies the approval threshold, approval authorisation and goods receipt', async () => {
    const cons = await Client.as(['PROC_CONS']);
    const head = await Client.as(['PROC_HEAD']);
    const wh = await Client.as(['WH']);
    const mat = await newMaterial('10000.00', '15000.00');
    const PUN = await plantId('PUN');
    const vendor = await companyId('V100');

    // ₹10,00,000 net exactly does not require approval (rule: strictly above the threshold).
    const small = await cons.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 100 }] });
    expect(small.status).toBe(201);
    expect(small.body.status).toBe('Approved');
    expect(small.body.net).toBe('1000000.00');
    expect(small.body.tax).toBe('180000.00');

    const big = await cons.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 150 }] });
    expect(big.body.status).toBe('Pending Approval');
    const note = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND link LIKE $2',
      [head.user.id, `%/${big.body.id}`]);
    expect(note!.n).toBe(1);

    // Goods cannot be received before approval; consultants cannot approve.
    expect((await wh.post(`/purchase-orders/${big.body.id}/goods-receipts`)).status).toBe(422);
    expect((await cons.post(`/purchase-orders/${big.body.id}/approve`)).status).toBe(403);
    expect((await head.post(`/purchase-orders/${big.body.id}/approve`)).status).toBe(200);
    expect((await head.post(`/purchase-orders/${big.body.id}/approve`)).status).toBe(409);

    // Self-approval is not allowed by default.
    const own = await head.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 200 }] });
    expect(own.body.status).toBe('Pending Approval');
    expect((await head.post(`/purchase-orders/${own.body.id}/approve`)).status).toBe(403);

    // Partial then full goods receipt; inventory updated once per posting, replay is idempotent.
    const po = (await wh.get(`/purchase-orders/${big.body.id}`)).body;
    const item = po.items[0].id;
    const k = key();
    const gr1 = await wh.post(`/purchase-orders/${big.body.id}/goods-receipts`, { items: [{ purchaseOrderItemId: item, quantity: 50 }] }, { 'Idempotency-Key': k });
    expect(gr1.status).toBe(201);
    expect(gr1.body.poStatus).toBe('Partially Received');
    const replay = await wh.post(`/purchase-orders/${big.body.id}/goods-receipts`, { items: [{ purchaseOrderItemId: item, quantity: 50 }] }, { 'Idempotency-Key': k });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.number).toBe(gr1.body.number);
    expect(await stockOf(mat.id, 'PUN')).toBe(50);

    expect((await wh.post(`/purchase-orders/${big.body.id}/goods-receipts`, { items: [{ purchaseOrderItemId: item, quantity: 101 }] })).status).toBe(422);
    const gr2 = await wh.post(`/purchase-orders/${big.body.id}/goods-receipts`, {});
    expect(gr2.body.poStatus).toBe('Received');
    expect(await stockOf(mat.id, 'PUN')).toBe(150);
    expect((await wh.post(`/purchase-orders/${big.body.id}/goods-receipts`, {})).status).toBe(422);

    const movements = await query('SELECT * FROM inventory_movements WHERE material_id = $1', [mat.id]);
    expect(movements).toHaveLength(2);
  });

  it('converts a requisition into exactly one purchase order', async () => {
    const cons = await Client.as(['PROC_CONS']);
    const mat = await newMaterial('100.00', '150.00');
    const pr = await cons.post('/purchase-requisitions', { plantId: await plantId('MUM'), materialId: mat.id, quantity: 10 });
    expect(pr.status).toBe(201);
    const vendor = await companyId('V200');
    const po = await cons.post('/purchase-orders', { vendorId: vendor, requisitionId: pr.body.id });
    expect(po.status).toBe(201);
    const prRow = await queryOne<{ status: string }>('SELECT status FROM purchase_requisitions WHERE id = $1', [pr.body.id]);
    expect(prRow!.status).toBe('Ordered');
    expect((await cons.post('/purchase-orders', { vendorId: vendor, requisitionId: pr.body.id })).status).toBe(422);
  });

  it('validates quantities, prices and partners on the server', async () => {
    const cons = await Client.as(['PROC_CONS']);
    const mat = await newMaterial();
    const PUN = await plantId('PUN');
    const vendor = await companyId('V100');
    const customer = await companyId('C1000');
    expect((await cons.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 0 }] })).status).toBe(400);
    expect((await cons.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 1, unitPrice: '-5' }] })).status).toBe(400);
    expect((await cons.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 1.5 }] })).status).toBe(400);
    expect((await cons.post('/purchase-orders', { vendorId: customer, plantId: PUN, items: [{ materialId: mat.id, quantity: 1 }] })).status).toBe(404);
    const tester = await Client.as(['TESTER']);
    expect((await tester.post('/purchase-orders', { vendorId: vendor, plantId: PUN, items: [{ materialId: mat.id, quantity: 1 }] })).status).toBe(403);
  });

  it('creates PR and PO together and prevents duplicate submissions', async () => {
    const head = await Client.as(['PROC_HEAD']);
    const mat = await newMaterial('100.00', '150.00');
    const body = { customerId: await companyId('C2000'), vendorId: await companyId('V100'), plantId: await plantId('PUN'), materialId: mat.id, quantity: 5 };
    const k = key();
    const a = await head.post('/procurement/quick-order', body, { 'Idempotency-Key': k });
    const b = await head.post('/procurement/quick-order', body, { 'Idempotency-Key': k });
    expect(a.status).toBe(201);
    expect(b.body.purchaseOrder.number).toBe(a.body.purchaseOrder.number);
    const n = await queryOne<{ n: number }>(
      'SELECT count(*)::int AS n FROM purchase_order_items WHERE material_id = $1', [mat.id]);
    expect(n!.n).toBe(1);
  });

  it('uses the configurable threshold', async () => {
    const admin = await Client.as(['ADMIN']);
    const cons = await Client.as(['PROC_CONS']);
    const mat = await newMaterial('10.00', '20.00');
    expect((await admin.put('/admin/settings/po_approval_threshold', { value: 'abc' })).status).toBe(400);
    expect((await admin.put('/admin/settings/po_approval_threshold', { value: '50.00' })).status).toBe(200);
    try {
      const po = await cons.post('/purchase-orders', { vendorId: await companyId('V100'), plantId: await plantId('PUN'), items: [{ materialId: mat.id, quantity: 6 }] });
      expect(po.body.status).toBe('Pending Approval');
    } finally {
      await admin.put('/admin/settings/po_approval_threshold', { value: '1000000.00' });
    }
  });
});

describe('inventory', () => {
  it('transfers stock consistently and rejects invalid transfers', async () => {
    const wh = await Client.as(['WH']);
    const mat = await newMaterial('100.00', '150.00', { MUM: 60, PUN: 20 });
    const MUM = await plantId('MUM'), PUN = await plantId('PUN');
    const ok = await wh.post('/inventory/transfers', { materialId: mat.id, fromPlantId: MUM, toPlantId: PUN, quantity: 25 });
    expect(ok.status).toBe(201);
    expect(await stockOf(mat.id, 'MUM')).toBe(35);
    expect(await stockOf(mat.id, 'PUN')).toBe(45);
    const short = await wh.post('/inventory/transfers', { materialId: mat.id, fromPlantId: MUM, toPlantId: PUN, quantity: 36 });
    expect(short.status).toBe(422);
    expect(short.body.error.message).toMatch(/Insufficient stock/);
    expect(await stockOf(mat.id, 'MUM')).toBe(35);
    expect(await stockOf(mat.id, 'PUN')).toBe(45);
    expect((await wh.post('/inventory/transfers', { materialId: mat.id, fromPlantId: MUM, toPlantId: MUM, quantity: 1 })).status).toBe(422);
    expect((await wh.post('/inventory/transfers', { materialId: mat.id, fromPlantId: MUM, toPlantId: PUN, quantity: -1 })).status).toBe(400);
    const sales = await Client.as(['SALES']);
    expect((await sales.post('/inventory/transfers', { materialId: mat.id, fromPlantId: MUM, toPlantId: PUN, quantity: 1 })).status).toBe(403);
  });

  it('never goes negative under concurrent transfers', async () => {
    const wh = await Client.as(['WH']);
    const mat = await newMaterial('100.00', '150.00', { DEL: 50 });
    const DEL = await plantId('DEL'), BLR = await plantId('BLR');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => wh.post('/inventory/transfers', { materialId: mat.id, fromPlantId: DEL, toPlantId: BLR, quantity: 20 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 422)).toHaveLength(4);
    expect(await stockOf(mat.id, 'DEL')).toBe(10);
    expect(await stockOf(mat.id, 'BLR')).toBe(40);
  });

  it('requires a reason and permission for adjustments', async () => {
    const wh = await Client.as(['WH']);
    const mat = await newMaterial('100.00', '150.00', { HYD: 5 });
    const HYD = await plantId('HYD');
    expect((await wh.post('/inventory/adjustments', { materialId: mat.id, plantId: HYD, quantity: -2, reason: '' })).status).toBe(400);
    expect((await wh.post('/inventory/adjustments', { materialId: mat.id, plantId: HYD, quantity: -6, reason: 'Damaged' })).status).toBe(422);
    const ok = await wh.post('/inventory/adjustments', { materialId: mat.id, plantId: HYD, quantity: -2, reason: 'Damaged in handling' });
    expect(ok.body.onHand).toBe(3);
    const oscm = await Client.as(['OSCM']);
    expect((await oscm.post('/inventory/adjustments', { materialId: mat.id, plantId: HYD, quantity: 1, reason: 'Found' })).status).toBe(403);
  });
});

describe('sales and delivery', () => {
  it('runs order to cash with stock checks, single billing and MRP', async () => {
    const sales = await Client.as(['SALES']);
    const wh = await Client.as(['WH']);
    const fin = await Client.as(['FIN']);
    const mrp = await Client.as(['MRP']);
    const mat = await newMaterial('3200.00', '4999.00', { PUN: 20 });
    const PUN = await plantId('PUN');
    const so = await sales.post('/sales-orders', { customerId: await companyId('C3000'), plantId: PUN, items: [{ materialId: mat.id, quantity: 100 }] });
    expect(so.status).toBe(201);
    expect(so.body.shortages[0]).toMatch(/short 80/);
    const soDetail = (await sales.get(`/sales-orders/${so.body.id}`)).body;
    expect(soDetail.netAmount).toBe('499900.00');
    expect(soDetail.taxAmount).toBe('89982.00');

    // MRP shows the 80-unit shortage and converts it into one requisition.
    const plan = await mrp.get(`/mrp?plantId=${PUN}`);
    expect(plan.body.items.find((r: { materialId: number }) => r.materialId === mat.id).shortage).toBe(80);
    const pr = await mrp.post('/mrp/requisitions', { plantId: PUN, materialId: mat.id });
    expect(pr.body.quantity).toBe(80);
    expect((await mrp.post('/mrp/requisitions', { plantId: PUN, materialId: mat.id })).status).toBe(422);

    // Delivery: quantity checks; goods issue requires picking and sufficient stock.
    const item = soDetail.items[0].id;
    expect((await wh.post(`/sales-orders/${so.body.id}/deliveries`, { items: [{ salesOrderItemId: item, quantity: 101 }] })).status).toBe(422);
    const dl = await wh.post(`/sales-orders/${so.body.id}/deliveries`, {});
    expect(dl.status).toBe(201);
    expect((await sales.get(`/sales-orders/${so.body.id}`)).body.status).toBe('Delivered');
    expect((await wh.post(`/deliveries/${dl.body.id}/goods-issue`)).status).toBe(422); // not picked
    expect((await fin.post(`/deliveries/${dl.body.id}/invoice`)).status).toBe(422); // no goods issue
    expect((await wh.post(`/deliveries/${dl.body.id}/pick`)).status).toBe(200);
    const gi = await wh.post(`/deliveries/${dl.body.id}/goods-issue`);
    expect(gi.status).toBe(422);
    expect(await stockOf(mat.id, 'PUN')).toBe(20); // nothing posted
    expect((await queryOne<{ status: string }>('SELECT status FROM deliveries WHERE id = $1', [dl.body.id]))!.status).toBe('Picked');

    await query('UPDATE inventory_balances SET on_hand = 100 WHERE material_id = $1 AND plant_id = $2', [mat.id, PUN]);
    const k = key();
    expect((await wh.post(`/deliveries/${dl.body.id}/goods-issue`, {}, { 'Idempotency-Key': k })).status).toBe(200);
    expect((await wh.post(`/deliveries/${dl.body.id}/goods-issue`, {}, { 'Idempotency-Key': k })).status).toBe(200);
    expect(await stockOf(mat.id, 'PUN')).toBe(0);
    expect((await wh.post(`/deliveries/${dl.body.id}/goods-issue`)).status).toBe(422);

    // Billing exactly once.
    expect((await wh.post(`/deliveries/${dl.body.id}/invoice`)).status).toBe(403);
    const inv = await fin.post(`/deliveries/${dl.body.id}/invoice`);
    expect(inv.status).toBe(201);
    expect((await fin.post(`/deliveries/${dl.body.id}/invoice`)).status).toBe(422);
    const invDetail = (await fin.get(`/invoices/${inv.body.id}`)).body;
    expect(invDetail.netAmount).toBe('499900.00');
    expect(invDetail.totalAmount).toBe('589882.00');

    // Document flow links SO, PR-free chain, delivery and invoice.
    const flow = await sales.get(`/documents/flow?type=INV&id=${inv.body.id}`);
    expect(flow.body.items.map((d: { docType: string }) => d.docType).sort()).toEqual(['DL', 'INV', 'SO']);
  });

  it('rejects invalid sales orders', async () => {
    const sales = await Client.as(['SALES']);
    const PUN = await plantId('PUN');
    expect((await sales.post('/sales-orders', { customerId: await companyId('V100'), plantId: PUN, items: [{ materialId: 1, quantity: 1 }] })).status).toBe(404);
    expect((await sales.post('/sales-orders', { customerId: await companyId('C1000'), plantId: PUN, items: [] })).status).toBe(400);
    const tester = await Client.as(['TESTER']);
    expect((await tester.post('/sales-orders', { customerId: await companyId('C1000'), plantId: PUN, items: [{ materialId: 1, quantity: 1 }] })).status).toBe(403);
  });
});
