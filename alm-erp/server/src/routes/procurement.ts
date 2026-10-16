import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import type { AuthUser } from '../auth/session.js';
import { query, queryOne } from '../db/pool.js';
import { conflict, forbidden, notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { fromPaise, isMoney, lineAmount, toPaise, totals } from '../lib/money.js';
import { logActivity, notify, usersWithPermission } from '../services/activity.js';
import { idempotentTransaction } from '../services/idempotency.js';
import { postMovement } from '../services/inventory.js';
import { getSetting } from '../services/settings.js';

export const requisitionsRouter = Router();
export const purchaseOrdersRouter = Router();
export const goodsReceiptsRouter = Router();
export const procurementRouter = Router();

const inr = (paise: bigint) => `₹${Number(paise / 100n).toLocaleString('en-IN')}`;
const money = z.string().trim().refine(isMoney, 'Enter an amount with up to two decimals.');
const qty = z.number().int().positive('Quantity must be greater than 0.').max(1_000_000);

async function assertCompany(db: pg.PoolClient, id: number, type: 'Customer' | 'Vendor') {
  const c = await queryOne<{ name: string; status: string }>('SELECT name, status FROM companies WHERE id = $1 AND type = $2', [id, type], db);
  if (!c) throw notFound(type);
  if (c.status !== 'Active') throw ruleViolation(`${type} ${c.name} is blocked.`);
  return c;
}

async function assertPlant(db: pg.PoolClient, id: number) {
  const p = await queryOne<{ code: string }>('SELECT code FROM plants WHERE id = $1', [id], db);
  if (!p) throw notFound('Plant');
  return p;
}

async function getMaterial(db: pg.PoolClient, id: number) {
  const m = await queryOne<{ id: number; code: string; cost_price: string; list_price: string }>(
    'SELECT id, code, cost_price, list_price FROM materials WHERE id = $1 AND is_active', [id], db);
  if (!m) throw notFound('Material');
  return m;
}

// ───────────── Purchase requisitions ─────────────

requisitionsRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    status: z.enum(['Open', 'Ordered', 'Cancelled']).optional(),
    plantId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().max(60).optional(),
  }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.status) w.add('pr.status = ?', f.status);
  if (f.plantId) w.add('pr.plant_id = ?', f.plantId);
  if (f.q) w.add('(pr.number::text LIKE ? OR m.code ILIKE ?)', likePattern(f.q), likePattern(f.q));
  const rows = await query(
    `SELECT pr.id, pr.number, pr.quantity, pr.status, pr.source, pr.created_at, p.code AS plant_code, m.id AS material_id,
            m.code AS material_code, m.description AS material_description, c.name AS customer_name, u.full_name AS created_by_name,
            po.id AS purchase_order_id, po.number AS purchase_order_number, count(*) OVER() AS total_count
       FROM purchase_requisitions pr JOIN plants p ON p.id = pr.plant_id JOIN materials m ON m.id = pr.material_id
       LEFT JOIN companies c ON c.id = pr.customer_id JOIN users u ON u.id = pr.created_by
       LEFT JOIN purchase_orders po ON po.requisition_id = pr.id
       ${w.sql} ORDER BY pr.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

const prSchema = z.object({
  plantId: z.number().int().positive(),
  materialId: z.number().int().positive(),
  quantity: qty,
  customerId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(1000).default(''),
});

async function insertRequisition(db: pg.PoolClient, me: AuthUser, b: z.infer<typeof prSchema>, source: 'Manual' | 'MRP', status = 'Open') {
  const plant = await assertPlant(db, b.plantId);
  const m = await getMaterial(db, b.materialId);
  if (b.customerId) await assertCompany(db, b.customerId, 'Customer');
  const pr = (await queryOne<{ id: number; number: number }>(
    `INSERT INTO purchase_requisitions (plant_id, material_id, quantity, customer_id, source, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, number`,
    [b.plantId, b.materialId, b.quantity, b.customerId ?? null, source, status, b.notes, me.id], db))!;
  await logActivity(db, { actorId: me.id, action: 'create', entityType: 'PR', entityId: pr.id, entityRef: `PR ${pr.number}`,
    summary: `PR ${pr.number} created at ${plant.code}: ${b.quantity} × ${m.code}${source === 'MRP' ? ' (from MRP)' : ''} by ${me.fullName}` });
  return { ...pr, materialCode: m.code, plantCode: plant.code };
}

requisitionsRouter.post('/', async (req, res) => {
  assertCan(req, 'pr.create');
  const me = currentUser(req);
  const b = parse(prSchema, req.body);
  await idempotentTransaction(req, res, 'pr.create', async (db) => {
    const pr = await insertRequisition(db, me, b, 'Manual');
    return { status: 201, body: { id: pr.id, number: pr.number, message: `PR ${pr.number} created at ${pr.plantCode}: ${b.quantity} × ${pr.materialCode}.` } };
  });
});

requisitionsRouter.post('/:id/cancel', async (req, res) => {
  assertCan(req, 'pr.create');
  const id = paramId(req);
  const me = currentUser(req);
  await idempotentTransaction(req, res, `pr.cancel.${id}`, async (db) => {
    const pr = await queryOne<{ number: number; status: string }>('SELECT number, status FROM purchase_requisitions WHERE id = $1 FOR UPDATE', [id], db);
    if (!pr) throw notFound('Purchase requisition');
    if (pr.status !== 'Open') throw ruleViolation(`PR ${pr.number} is ${pr.status} and cannot be cancelled.`);
    await query("UPDATE purchase_requisitions SET status = 'Cancelled', updated_at = now() WHERE id = $1", [id], db);
    await logActivity(db, { actorId: me.id, action: 'cancel', entityType: 'PR', entityId: id, entityRef: `PR ${pr.number}`,
      summary: `PR ${pr.number} cancelled by ${me.fullName}` });
    return { status: 200, body: { message: `PR ${pr.number} cancelled.` } };
  });
});

// ───────────── Purchase orders ─────────────

const poSchema = z.object({
  vendorId: z.number().int().positive(),
  plantId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  requisitionId: z.number().int().positive().nullable().optional(),
  salesOrderId: z.number().int().positive().nullable().optional(),
  items: z.array(z.object({
    materialId: z.number().int().positive(),
    quantity: qty,
    unitPrice: money.optional(),
  })).max(50).default([]),
});

/** Create a purchase order inside an open transaction, applying the configured approval policy. */
async function createPurchaseOrder(db: pg.PoolClient, me: AuthUser, b: z.infer<typeof poSchema>) {
  let plantId = b.plantId;
  let customerId = b.customerId ?? null;
  let items = b.items;

  if (b.requisitionId) {
    const pr = await queryOne<{ id: number; number: number; status: string; plant_id: number; material_id: number; quantity: number; customer_id: number | null }>(
      'SELECT * FROM purchase_requisitions WHERE id = $1 FOR UPDATE', [b.requisitionId], db);
    if (!pr) throw notFound('Purchase requisition');
    if (pr.status !== 'Open') throw ruleViolation(`PR ${pr.number} is already ${pr.status.toLowerCase()}.`);
    plantId = pr.plant_id;
    customerId ??= pr.customer_id;
    items = [{ materialId: pr.material_id, quantity: pr.quantity, unitPrice: b.items[0]?.unitPrice }];
    await query("UPDATE purchase_requisitions SET status = 'Ordered', updated_at = now() WHERE id = $1", [pr.id], db);
  }
  if (b.salesOrderId) {
    const so = await queryOne<{ plant_id: number; customer_id: number; status: string; number: number }>(
      'SELECT plant_id, customer_id, status, number FROM sales_orders WHERE id = $1', [b.salesOrderId], db);
    if (!so) throw notFound('Sales order');
    if (so.status === 'Cancelled') throw ruleViolation(`Sales order ${so.number} is cancelled.`);
    plantId ??= so.plant_id;
    customerId ??= so.customer_id;
  }
  if (!plantId) throw ruleViolation('Select a plant.');
  if (!items.length) throw ruleViolation('Add at least one item.');
  const plant = await assertPlant(db, plantId);
  const vendor = await assertCompany(db, b.vendorId, 'Vendor');
  if (customerId) await assertCompany(db, customerId, 'Customer');

  const lines = [];
  for (const it of items) {
    const m = await getMaterial(db, it.materialId);
    lines.push({ materialId: m.id, code: m.code, quantity: it.quantity, unitPrice: it.unitPrice ?? m.cost_price });
  }
  const rate = await getSetting('gst_rate_bp', db);
  const threshold = toPaise(await getSetting('po_approval_threshold', db));
  const t = totals(lines, rate);
  const needsApproval = t.net > threshold;
  const status = needsApproval ? 'Pending Approval' : 'Approved';

  const po = (await queryOne<{ id: number; number: number }>(
    `INSERT INTO purchase_orders (vendor_id, customer_id, plant_id, requisition_id, sales_order_id, status, net_amount, tax_amount,
        total_amount, approval_required, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, number`,
    [b.vendorId, customerId, plantId, b.requisitionId ?? null, b.salesOrderId ?? null, status, fromPaise(t.net), fromPaise(t.tax),
     fromPaise(t.total), needsApproval, me.id], db))!;
  for (const [i, l] of lines.entries()) {
    await query(
      `INSERT INTO purchase_order_items (purchase_order_id, line_no, material_id, quantity, unit_price, net_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [po.id, i + 1, l.materialId, l.quantity, l.unitPrice, fromPaise(lineAmount(l.quantity, l.unitPrice))], db);
  }
  const desc = lines.map((l) => `${l.quantity} × ${l.code}`).join(', ');
  await logActivity(db, { actorId: me.id, action: 'create', entityType: 'PO', entityId: po.id, entityRef: `PO ${po.number}`,
    summary: `PO ${po.number} created by ${me.fullName}: ${desc} from ${vendor.name} at ${plant.code}, net ${inr(t.net)} – ${status}`,
    details: { net: fromPaise(t.net), status } });
  if (needsApproval) {
    const approvers = await usersWithPermission(db, 'po.approve');
    await notify(db, approvers, me.id,
      `PO ${po.number} (${inr(t.net)} net) exceeds the ${inr(threshold)} threshold and needs your approval`, `/procurement/purchase-orders/${po.id}`);
  }
  if (b.salesOrderId) {
    const so = await queryOne<{ created_by: number; number: number }>('SELECT created_by, number FROM sales_orders WHERE id = $1', [b.salesOrderId], db);
    await notify(db, [so!.created_by], me.id, `PO ${po.number} raised for your sales order ${so!.number}`, `/procurement/purchase-orders/${po.id}`);
  }
  return {
    id: po.id, number: po.number, status, net: fromPaise(t.net), tax: fromPaise(t.tax), total: fromPaise(t.total),
    message: `PO ${po.number} created for ${inr(t.net)} net at ${plant.code} – status: ${status}.`,
  };
}

purchaseOrdersRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    status: z.union([z.enum(['Pending Approval', 'Approved', 'Partially Received', 'Received', 'Rejected', 'Cancelled']), z.literal('open')]).optional(),
    plantId: z.coerce.number().int().positive().optional(),
    vendorId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().max(60).optional(),
  }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.status === 'open') w.add("po.status IN ('Pending Approval','Approved','Partially Received')");
  else if (f.status) w.add('po.status = ?', f.status);
  if (f.plantId) w.add('po.plant_id = ?', f.plantId);
  if (f.vendorId) w.add('po.vendor_id = ?', f.vendorId);
  if (f.q) w.add('(po.number::text LIKE ? OR v.name ILIKE ?)', likePattern(f.q), likePattern(f.q));
  const rows = await query(
    `SELECT po.id, po.number, po.status, po.net_amount, po.tax_amount, po.total_amount, po.currency, po.approval_required, po.created_at,
            p.code AS plant_code, v.name AS vendor_name, c.name AS customer_name, u.full_name AS created_by_name,
            (SELECT string_agg(m.code || ' × ' || i.quantity, ', ' ORDER BY i.line_no) FROM purchase_order_items i
               JOIN materials m ON m.id = i.material_id WHERE i.purchase_order_id = po.id) AS items_summary,
            (SELECT sum(i.quantity) FROM purchase_order_items i WHERE i.purchase_order_id = po.id)::int AS quantity,
            (SELECT sum(i.received_qty) FROM purchase_order_items i WHERE i.purchase_order_id = po.id)::int AS received_qty,
            count(*) OVER() AS total_count
       FROM purchase_orders po JOIN plants p ON p.id = po.plant_id JOIN companies v ON v.id = po.vendor_id
       LEFT JOIN companies c ON c.id = po.customer_id JOIN users u ON u.id = po.created_by
       ${w.sql} ORDER BY po.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

export async function loadPurchaseOrder(id: number) {
  const po = await queryOne(
    `SELECT po.*, p.code AS plant_code, p.name AS plant_name, v.code AS vendor_code, v.name AS vendor_name, v.city AS vendor_city,
            v.industry AS vendor_industry, c.code AS customer_code, c.name AS customer_name, u.full_name AS created_by_name,
            ap.full_name AS approved_by_name, pr.number AS requisition_number, so.number AS sales_order_number
       FROM purchase_orders po JOIN plants p ON p.id = po.plant_id JOIN companies v ON v.id = po.vendor_id
       LEFT JOIN companies c ON c.id = po.customer_id JOIN users u ON u.id = po.created_by
       LEFT JOIN users ap ON ap.id = po.approved_by LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id
       LEFT JOIN sales_orders so ON so.id = po.sales_order_id WHERE po.id = $1`, [id]);
  if (!po) return null;
  const [items, receipts, history] = await Promise.all([
    query(`SELECT i.id, i.line_no, i.quantity, i.unit_price, i.net_amount, i.received_qty, m.id AS material_id, m.code AS material_code,
                  m.description AS material_description
             FROM purchase_order_items i JOIN materials m ON m.id = i.material_id WHERE i.purchase_order_id = $1 ORDER BY i.line_no`, [id]),
    query(`SELECT gr.id, gr.number, gr.posted_at, u.full_name AS posted_by_name,
                  (SELECT sum(quantity) FROM goods_receipt_items gi WHERE gi.goods_receipt_id = gr.id)::int AS quantity
             FROM goods_receipts gr JOIN users u ON u.id = gr.posted_by WHERE gr.purchase_order_id = $1 ORDER BY gr.id`, [id]),
    query(`SELECT al.id, al.action, al.summary, al.created_at, u.full_name AS actor_name FROM activity_log al
             LEFT JOIN users u ON u.id = al.actor_id WHERE al.entity_type = 'PO' AND al.entity_id = $1 ORDER BY al.created_at DESC`, [id]),
  ]);
  return { ...camel(po), items: camelAll(items), receipts: camelAll(receipts), history: camelAll(history) };
}

purchaseOrdersRouter.get('/:id', async (req, res) => {
  const po = await loadPurchaseOrder(paramId(req));
  if (!po) throw notFound('Purchase order');
  res.json(po);
});

purchaseOrdersRouter.post('/', async (req, res) => {
  assertCan(req, 'po.create');
  const me = currentUser(req);
  const b = parse(poSchema, req.body);
  await idempotentTransaction(req, res, 'po.create', async (db) => ({ status: 201, body: await createPurchaseOrder(db, me, b) }));
});

async function lockPendingPO(db: pg.PoolClient, id: number) {
  const po = await queryOne<{ number: number; status: string; created_by: number; net_amount: string; requisition_id: number | null }>(
    'SELECT number, status, created_by, net_amount, requisition_id FROM purchase_orders WHERE id = $1 FOR UPDATE', [id], db);
  if (!po) throw notFound('Purchase order');
  if (po.status !== 'Pending Approval') throw conflict(`PO ${po.number} is ${po.status} – it is not awaiting approval.`);
  return po;
}

purchaseOrdersRouter.post('/:id/approve', async (req, res) => {
  assertCan(req, 'po.approve');
  const id = paramId(req);
  const me = currentUser(req);
  await idempotentTransaction(req, res, `po.approve.${id}`, async (db) => {
    const po = await lockPendingPO(db, id);
    if (po.created_by === me.id && !(await getSetting('allow_self_approval', db))) {
      throw forbidden('You cannot approve a purchase order you created. Another approver must release it.');
    }
    await query("UPDATE purchase_orders SET status = 'Approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1",
      [id, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'approve', entityType: 'PO', entityId: id, entityRef: `PO ${po.number}`,
      summary: `PO ${po.number} (${inr(toPaise(po.net_amount))} net) approved by ${me.fullName}` });
    await notify(db, [po.created_by], me.id, `PO ${po.number} was approved by ${me.fullName}`, `/procurement/purchase-orders/${id}`);
    return { status: 200, body: { message: `PO ${po.number} approved.` } };
  });
});

purchaseOrdersRouter.post('/:id/reject', async (req, res) => {
  assertCan(req, 'po.approve');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(z.object({ reason: z.string().trim().min(3, 'Enter a rejection reason.').max(1000) }), req.body);
  await idempotentTransaction(req, res, `po.reject.${id}`, async (db) => {
    const po = await lockPendingPO(db, id);
    await query("UPDATE purchase_orders SET status = 'Rejected', rejection_reason = $2, updated_at = now() WHERE id = $1", [id, b.reason], db);
    // The requisition becomes available again for a new order.
    if (po.requisition_id) {
      await query("UPDATE purchase_requisitions SET status = 'Open', updated_at = now() WHERE id = $1", [po.requisition_id], db);
      await query('UPDATE purchase_orders SET requisition_id = NULL WHERE id = $1', [id], db);
    }
    await logActivity(db, { actorId: me.id, action: 'reject', entityType: 'PO', entityId: id, entityRef: `PO ${po.number}`,
      summary: `PO ${po.number} rejected by ${me.fullName}: ${b.reason}` });
    await notify(db, [po.created_by], me.id, `PO ${po.number} was rejected by ${me.fullName}: ${b.reason}`, `/procurement/purchase-orders/${id}`);
    return { status: 200, body: { message: `PO ${po.number} rejected.` } };
  });
});

const grSchema = z.object({
  items: z.array(z.object({ purchaseOrderItemId: z.number().int().positive(), quantity: qty })).min(1).max(50).optional(),
  notes: z.string().max(1000).default(''),
});

purchaseOrdersRouter.post('/:id/goods-receipts', async (req, res) => {
  assertCan(req, 'gr.post');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(grSchema, req.body ?? {});
  await idempotentTransaction(req, res, `gr.post.${id}`, async (db) => {
    const po = await queryOne<{ number: number; status: string; plant_id: number; created_by: number; sales_order_id: number | null }>(
      'SELECT number, status, plant_id, created_by, sales_order_id FROM purchase_orders WHERE id = $1 FOR UPDATE', [id], db);
    if (!po) throw notFound('Purchase order');
    if (po.status === 'Pending Approval') throw ruleViolation(`PO ${po.number} is pending approval; goods cannot be received yet.`);
    if (!['Approved', 'Partially Received'].includes(po.status)) throw ruleViolation(`PO ${po.number} is ${po.status}; no goods can be received.`);
    const poItems = await query<{ id: number; material_id: number; quantity: number; received_qty: number; code: string }>(
      `SELECT i.id, i.material_id, i.quantity, i.received_qty, m.code FROM purchase_order_items i JOIN materials m ON m.id = i.material_id
        WHERE i.purchase_order_id = $1 ORDER BY i.line_no FOR UPDATE OF i`, [id], db);
    const wanted = b.items ?? poItems.filter((i) => i.quantity > i.received_qty).map((i) => ({ purchaseOrderItemId: i.id, quantity: i.quantity - i.received_qty }));
    if (!wanted.length) throw ruleViolation(`PO ${po.number} has nothing left to receive.`);
    const seen = new Set<number>();
    for (const w of wanted) {
      const it = poItems.find((i) => i.id === w.purchaseOrderItemId);
      if (!it) throw notFound('Purchase order item');
      if (seen.has(it.id)) throw ruleViolation('Each item may appear only once per goods receipt.');
      seen.add(it.id);
      const open = it.quantity - it.received_qty;
      if (w.quantity > open) throw ruleViolation(`Over-delivery: only ${open} × ${it.code} still open on PO ${po.number}.`);
    }
    const gr = (await queryOne<{ id: number; number: number }>(
      'INSERT INTO goods_receipts (purchase_order_id, plant_id, notes, posted_by) VALUES ($1,$2,$3,$4) RETURNING id, number',
      [id, po.plant_id, b.notes, me.id], db))!;
    const parts: string[] = [];
    for (const w of wanted) {
      const it = poItems.find((i) => i.id === w.purchaseOrderItemId)!;
      await query('INSERT INTO goods_receipt_items (goods_receipt_id, purchase_order_item_id, material_id, quantity) VALUES ($1,$2,$3,$4)',
        [gr.id, it.id, it.material_id, w.quantity], db);
      await query('UPDATE purchase_order_items SET received_qty = received_qty + $2 WHERE id = $1', [it.id, w.quantity], db);
      const onHand = await postMovement(db, { materialId: it.material_id, plantId: po.plant_id, quantity: w.quantity, type: 'GOODS_RECEIPT',
        referenceType: 'GR', referenceId: gr.id, referenceNumber: String(gr.number), reason: `GR for PO ${po.number}`, userId: me.id });
      parts.push(`+${w.quantity} ${it.code} (stock ${onHand})`);
    }
    const remaining = await queryOne<{ open: number }>(
      'SELECT COALESCE(sum(quantity - received_qty), 0)::int AS open FROM purchase_order_items WHERE purchase_order_id = $1', [id], db);
    const status = remaining!.open === 0 ? 'Received' : 'Partially Received';
    await query('UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1', [id, status], db);
    await logActivity(db, { actorId: me.id, action: 'goods_receipt', entityType: 'PO', entityId: id, entityRef: `PO ${po.number}`,
      summary: `Goods receipt ${gr.number} for PO ${po.number}: ${parts.join(', ')} (by ${me.fullName})` });
    const soOwner = po.sales_order_id
      ? (await queryOne<{ created_by: number }>('SELECT created_by FROM sales_orders WHERE id = $1', [po.sales_order_id], db))?.created_by
      : null;
    await notify(db, [po.created_by, soOwner], me.id, `Goods receipt ${gr.number} posted for PO ${po.number}`, `/procurement/purchase-orders/${id}`);
    return { status: 201, body: { id: gr.id, number: gr.number, poStatus: status, message: `Goods receipt ${gr.number}: ${parts.join(', ')}.` } };
  });
});

// ───────────── Goods receipts ─────────────

goodsReceiptsRouter.get('/', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const rows = await query(
    `SELECT gr.id, gr.number, gr.posted_at, p.code AS plant_code, po.id AS purchase_order_id, po.number AS purchase_order_number,
            v.name AS vendor_name, u.full_name AS posted_by_name,
            (SELECT string_agg(m.code || ' × ' || gi.quantity, ', ') FROM goods_receipt_items gi JOIN materials m ON m.id = gi.material_id
              WHERE gi.goods_receipt_id = gr.id) AS items_summary,
            count(*) OVER() AS total_count
       FROM goods_receipts gr JOIN plants p ON p.id = gr.plant_id JOIN purchase_orders po ON po.id = gr.purchase_order_id
       JOIN companies v ON v.id = po.vendor_id JOIN users u ON u.id = gr.posted_by
      ORDER BY gr.id DESC LIMIT ${pageSize} OFFSET ${offset}`);
  res.json(toPage(rows, page, pageSize));
});

// ───────────── Combined PR + PO for a client (single transaction) ─────────────

const quickSchema = z.object({
  customerId: z.number().int().positive(),
  vendorId: z.number().int().positive(),
  plantId: z.number().int().positive(),
  materialId: z.number().int().positive(),
  quantity: qty,
});

procurementRouter.post('/quick-order', async (req, res) => {
  assertCan(req, 'pr.create');
  assertCan(req, 'po.create');
  const me = currentUser(req);
  const b = parse(quickSchema, req.body);
  await idempotentTransaction(req, res, 'procurement.quick', async (db) => {
    const pr = await insertRequisition(db, me, { plantId: b.plantId, materialId: b.materialId, quantity: b.quantity, customerId: b.customerId, notes: '' }, 'Manual');
    const po = await createPurchaseOrder(db, me, { vendorId: b.vendorId, requisitionId: pr.id, customerId: b.customerId, items: [] });
    return {
      status: 201,
      body: { requisition: { id: pr.id, number: pr.number }, purchaseOrder: po,
        message: `PR ${pr.number} and PO ${po.number} created – PO status: ${po.status}.` },
    };
  });
});
