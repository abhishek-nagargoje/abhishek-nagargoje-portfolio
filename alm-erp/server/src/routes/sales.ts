import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { query, queryOne } from '../db/pool.js';
import { notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { fromPaise, isMoney, lineAmount, taxAmount, totals } from '../lib/money.js';
import { logActivity, notify, usersWithRoles } from '../services/activity.js';
import { idempotentTransaction } from '../services/idempotency.js';
import { availability, postMovement } from '../services/inventory.js';
import { getSetting } from '../services/settings.js';

export const salesOrdersRouter = Router();
export const deliveriesRouter = Router();
export const invoicesRouter = Router();

const inr = (paise: bigint) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const qty = z.number().int().positive('Quantity must be greater than 0.').max(1_000_000);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ───────────── Sales orders ─────────────

salesOrdersRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    status: z.union([z.enum(['Open', 'Partially Delivered', 'Delivered', 'Cancelled']), z.literal('open')]).optional(),
    plantId: z.coerce.number().int().positive().optional(),
    customerId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().max(60).optional(),
  }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.status === 'open') w.add("so.status IN ('Open','Partially Delivered')");
  else if (f.status) w.add('so.status = ?', f.status);
  if (f.plantId) w.add('so.plant_id = ?', f.plantId);
  if (f.customerId) w.add('so.customer_id = ?', f.customerId);
  if (f.q) w.add('(so.number::text LIKE ? OR c.name ILIKE ?)', likePattern(f.q), likePattern(f.q));
  const rows = await query(
    `SELECT so.id, so.number, so.status, so.net_amount, so.tax_amount, so.total_amount, so.currency, so.requested_delivery_date, so.created_at,
            p.code AS plant_code, c.name AS customer_name, u.full_name AS created_by_name,
            (SELECT string_agg(m.code || ' × ' || i.quantity, ', ' ORDER BY i.line_no) FROM sales_order_items i
               JOIN materials m ON m.id = i.material_id WHERE i.sales_order_id = so.id) AS items_summary,
            (SELECT sum(quantity) FROM sales_order_items i WHERE i.sales_order_id = so.id)::int AS quantity,
            (SELECT sum(delivered_qty) FROM sales_order_items i WHERE i.sales_order_id = so.id)::int AS delivered_qty,
            count(*) OVER() AS total_count
       FROM sales_orders so JOIN plants p ON p.id = so.plant_id JOIN companies c ON c.id = so.customer_id JOIN users u ON u.id = so.created_by
       ${w.sql} ORDER BY so.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

async function loadSalesOrder(id: number) {
  const so = await queryOne(
    `SELECT so.*, p.code AS plant_code, p.name AS plant_name, c.code AS customer_code, c.name AS customer_name, c.city AS customer_city,
            c.industry AS customer_industry, u.full_name AS created_by_name
       FROM sales_orders so JOIN plants p ON p.id = so.plant_id JOIN companies c ON c.id = so.customer_id JOIN users u ON u.id = so.created_by
      WHERE so.id = $1`, [id]);
  if (!so) return null;
  const [items, deliveries, purchaseOrders] = await Promise.all([
    query(
      `SELECT i.id, i.line_no, i.quantity, i.unit_price, i.net_amount, i.delivered_qty, m.id AS material_id, m.code AS material_code,
              m.description AS material_description,
              COALESCE(b.on_hand, 0) AS on_hand, COALESCE(inc.qty, 0) AS incoming
         FROM sales_order_items i JOIN materials m ON m.id = i.material_id
         JOIN sales_orders so ON so.id = i.sales_order_id
         LEFT JOIN inventory_balances b ON b.material_id = i.material_id AND b.plant_id = so.plant_id
         LEFT JOIN v_incoming inc ON inc.material_id = i.material_id AND inc.plant_id = so.plant_id
        WHERE i.sales_order_id = $1 ORDER BY i.line_no`, [id]),
    query(
      `SELECT d.id, d.number, d.status, d.created_at, inv.id AS invoice_id, inv.number AS invoice_number,
              (SELECT sum(quantity) FROM delivery_items di WHERE di.delivery_id = d.id)::int AS quantity
         FROM deliveries d LEFT JOIN invoices inv ON inv.delivery_id = d.id WHERE d.sales_order_id = $1 ORDER BY d.id`, [id]),
    query('SELECT id, number, status, total_amount FROM purchase_orders WHERE sales_order_id = $1 ORDER BY id', [id]),
  ]);
  return { ...camel(so), items: camelAll(items), deliveries: camelAll(deliveries), purchaseOrders: camelAll(purchaseOrders) };
}

salesOrdersRouter.get('/:id', async (req, res) => {
  const so = await loadSalesOrder(paramId(req));
  if (!so) throw notFound('Sales order');
  res.json(so);
});

const soSchema = z.object({
  customerId: z.number().int().positive(),
  plantId: z.number().int().positive(),
  requestedDeliveryDate: dateStr.nullable().optional(),
  items: z.array(z.object({
    materialId: z.number().int().positive(),
    quantity: qty,
    unitPrice: z.string().trim().refine(isMoney, 'Enter an amount with up to two decimals.').optional(),
  })).min(1, 'Add at least one item.').max(50),
});

salesOrdersRouter.post('/', async (req, res) => {
  assertCan(req, 'so.create');
  const me = currentUser(req);
  const b = parse(soSchema, req.body);
  await idempotentTransaction(req, res, 'so.create', async (db) => {
    const c = await queryOne<{ name: string; status: string }>("SELECT name, status FROM companies WHERE id = $1 AND type = 'Customer'", [b.customerId], db);
    if (!c) throw notFound('Customer');
    if (c.status !== 'Active') throw ruleViolation(`Customer ${c.name} is blocked.`);
    const plant = await queryOne<{ code: string }>('SELECT code FROM plants WHERE id = $1', [b.plantId], db);
    if (!plant) throw notFound('Plant');
    const lines = [];
    for (const it of b.items) {
      const m = await queryOne<{ id: number; code: string; list_price: string }>(
        'SELECT id, code, list_price FROM materials WHERE id = $1 AND is_active', [it.materialId], db);
      if (!m) throw notFound('Material');
      lines.push({ materialId: m.id, code: m.code, quantity: it.quantity, unitPrice: it.unitPrice ?? m.list_price });
    }
    const t = totals(lines, await getSetting('gst_rate_bp', db));
    const so = (await queryOne<{ id: number; number: number }>(
      `INSERT INTO sales_orders (customer_id, plant_id, requested_delivery_date, net_amount, tax_amount, total_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, number`,
      [b.customerId, b.plantId, b.requestedDeliveryDate ?? null, fromPaise(t.net), fromPaise(t.tax), fromPaise(t.total), me.id], db))!;
    const shortages: string[] = [];
    for (const [i, l] of lines.entries()) {
      await query(
        `INSERT INTO sales_order_items (sales_order_id, line_no, material_id, quantity, unit_price, net_amount) VALUES ($1,$2,$3,$4,$5,$6)`,
        [so.id, i + 1, l.materialId, l.quantity, l.unitPrice, fromPaise(lineAmount(l.quantity, l.unitPrice))], db);
      const a = await availability(db, b.plantId, l.materialId);
      if (a.atp < 0) shortages.push(`${l.code}: short ${-a.atp}`);
    }
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'SO', entityId: so.id, entityRef: `SO ${so.number}`,
      summary: `Sales order ${so.number} for ${c.name} at ${plant.code}: ${lines.map((l) => `${l.quantity} × ${l.code}`).join(', ')} = ${inr(t.net)} net (by ${me.fullName})` });
    if (shortages.length) {
      await notify(db, await usersWithRoles(db, ['MRP', 'PROC_CONS']), me.id,
        `Sales order ${so.number} at ${plant.code} has uncovered demand (${shortages.join('; ')}) – run MRP`, `/sales/orders/${so.id}`);
    }
    return {
      status: 201,
      body: { id: so.id, number: so.number, shortages,
        message: `Sales order ${so.number} created: ${inr(t.net)} net.${shortages.length ? ` Shortage – ${shortages.join('; ')}. Run MRP or create a PO.` : ''}` },
    };
  });
});

salesOrdersRouter.post('/:id/cancel', async (req, res) => {
  assertCan(req, 'so.create');
  const id = paramId(req);
  const me = currentUser(req);
  await idempotentTransaction(req, res, `so.cancel.${id}`, async (db) => {
    const so = await queryOne<{ number: number; status: string }>('SELECT number, status FROM sales_orders WHERE id = $1 FOR UPDATE', [id], db);
    if (!so) throw notFound('Sales order');
    const dl = await queryOne('SELECT 1 FROM deliveries WHERE sales_order_id = $1', [id], db);
    if (so.status !== 'Open' || dl) throw ruleViolation(`Sales order ${so.number} has deliveries and cannot be cancelled.`);
    await query("UPDATE sales_orders SET status = 'Cancelled', updated_at = now() WHERE id = $1", [id], db);
    await logActivity(db, { actorId: me.id, action: 'cancel', entityType: 'SO', entityId: id, entityRef: `SO ${so.number}`,
      summary: `Sales order ${so.number} cancelled by ${me.fullName}` });
    return { status: 200, body: { message: `Sales order ${so.number} cancelled.` } };
  });
});

const deliverySchema = z.object({
  items: z.array(z.object({ salesOrderItemId: z.number().int().positive(), quantity: qty })).min(1).max(50).optional(),
});

salesOrdersRouter.post('/:id/deliveries', async (req, res) => {
  assertCan(req, 'delivery.create');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(deliverySchema, req.body ?? {});
  await idempotentTransaction(req, res, `dl.create.${id}`, async (db) => {
    const so = await queryOne<{ number: number; status: string; plant_id: number }>(
      'SELECT number, status, plant_id FROM sales_orders WHERE id = $1 FOR UPDATE', [id], db);
    if (!so) throw notFound('Sales order');
    if (!['Open', 'Partially Delivered'].includes(so.status)) throw ruleViolation(`Sales order ${so.number} is ${so.status}.`);
    const items = await query<{ id: number; material_id: number; quantity: number; delivered_qty: number; code: string }>(
      `SELECT i.id, i.material_id, i.quantity, i.delivered_qty, m.code FROM sales_order_items i JOIN materials m ON m.id = i.material_id
        WHERE i.sales_order_id = $1 ORDER BY i.line_no FOR UPDATE OF i`, [id], db);
    const wanted = b.items ?? items.filter((i) => i.quantity > i.delivered_qty).map((i) => ({ salesOrderItemId: i.id, quantity: i.quantity - i.delivered_qty }));
    if (!wanted.length) throw ruleViolation(`Sales order ${so.number} is fully delivered.`);
    const seen = new Set<number>();
    for (const w of wanted) {
      const it = items.find((i) => i.id === w.salesOrderItemId);
      if (!it) throw notFound('Sales order item');
      if (seen.has(it.id)) throw ruleViolation('Each item may appear only once per delivery.');
      seen.add(it.id);
      if (w.quantity > it.quantity - it.delivered_qty) {
        throw ruleViolation(`Delivery quantity for ${it.code} exceeds the open order quantity (${it.quantity - it.delivered_qty}).`);
      }
    }
    const dl = (await queryOne<{ id: number; number: number }>(
      'INSERT INTO deliveries (sales_order_id, plant_id, created_by) VALUES ($1,$2,$3) RETURNING id, number', [id, so.plant_id, me.id], db))!;
    for (const w of wanted) {
      const it = items.find((i) => i.id === w.salesOrderItemId)!;
      await query('INSERT INTO delivery_items (delivery_id, sales_order_item_id, material_id, quantity) VALUES ($1,$2,$3,$4)',
        [dl.id, it.id, it.material_id, w.quantity], db);
      await query('UPDATE sales_order_items SET delivered_qty = delivered_qty + $2 WHERE id = $1', [it.id, w.quantity], db);
    }
    const open = await queryOne<{ open: number }>(
      'SELECT COALESCE(sum(quantity - delivered_qty), 0)::int AS open FROM sales_order_items WHERE sales_order_id = $1', [id], db);
    await query('UPDATE sales_orders SET status = $2, updated_at = now() WHERE id = $1', [id, open!.open === 0 ? 'Delivered' : 'Partially Delivered'], db);
    const desc = wanted.map((w) => `${w.quantity} × ${items.find((i) => i.id === w.salesOrderItemId)!.code}`).join(', ');
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'DL', entityId: dl.id, entityRef: `DL ${dl.number}`,
      summary: `Outbound delivery ${dl.number} for SO ${so.number}: ${desc} (by ${me.fullName})` });
    await notify(db, await usersWithRoles(db, ['WH']), me.id, `Delivery ${dl.number} (${desc}) is ready for picking`, `/sales/deliveries/${dl.id}`);
    return { status: 201, body: { id: dl.id, number: dl.number, message: `Outbound delivery ${dl.number} created: ${desc}.` } };
  });
});

// ───────────── Deliveries ─────────────

deliveriesRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    status: z.union([z.enum(['Created', 'Picked', 'Goods Issued', 'Billed']), z.literal('open')]).optional(),
    plantId: z.coerce.number().int().positive().optional(),
  }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.status === 'open') w.add("d.status <> 'Billed'");
  else if (f.status) w.add('d.status = ?', f.status);
  if (f.plantId) w.add('d.plant_id = ?', f.plantId);
  const rows = await query(
    `SELECT d.id, d.number, d.status, d.created_at, p.code AS plant_code, so.id AS sales_order_id, so.number AS sales_order_number,
            c.name AS customer_name, inv.id AS invoice_id, inv.number AS invoice_number,
            (SELECT string_agg(m.code || ' × ' || di.quantity, ', ') FROM delivery_items di JOIN materials m ON m.id = di.material_id
              WHERE di.delivery_id = d.id) AS items_summary,
            count(*) OVER() AS total_count
       FROM deliveries d JOIN plants p ON p.id = d.plant_id JOIN sales_orders so ON so.id = d.sales_order_id
       JOIN companies c ON c.id = so.customer_id LEFT JOIN invoices inv ON inv.delivery_id = d.id
       ${w.sql} ORDER BY d.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

async function loadDelivery(id: number) {
  const d = await queryOne(
    `SELECT d.*, p.code AS plant_code, so.number AS sales_order_number, c.name AS customer_name, u.full_name AS created_by_name,
            pk.full_name AS picked_by_name, gi.full_name AS goods_issued_by_name, inv.id AS invoice_id, inv.number AS invoice_number
       FROM deliveries d JOIN plants p ON p.id = d.plant_id JOIN sales_orders so ON so.id = d.sales_order_id
       JOIN companies c ON c.id = so.customer_id JOIN users u ON u.id = d.created_by LEFT JOIN users pk ON pk.id = d.picked_by
       LEFT JOIN users gi ON gi.id = d.goods_issued_by LEFT JOIN invoices inv ON inv.delivery_id = d.id WHERE d.id = $1`, [id]);
  if (!d) return null;
  const items = await query(
    `SELECT di.id, di.quantity, m.id AS material_id, m.code AS material_code, m.description AS material_description, soi.unit_price,
            COALESCE(b.on_hand, 0) AS on_hand
       FROM delivery_items di JOIN materials m ON m.id = di.material_id JOIN sales_order_items soi ON soi.id = di.sales_order_item_id
       JOIN deliveries d ON d.id = di.delivery_id
       LEFT JOIN inventory_balances b ON b.material_id = di.material_id AND b.plant_id = d.plant_id
      WHERE di.delivery_id = $1 ORDER BY di.id`, [id]);
  return { ...camel(d), items: camelAll(items) };
}

deliveriesRouter.get('/:id', async (req, res) => {
  const d = await loadDelivery(paramId(req));
  if (!d) throw notFound('Delivery');
  res.json(d);
});

async function lockDelivery(db: pg.PoolClient, id: number) {
  const d = await queryOne<{ id: number; number: number; status: string; plant_id: number; sales_order_id: number; created_by: number }>(
    'SELECT id, number, status, plant_id, sales_order_id, created_by FROM deliveries WHERE id = $1 FOR UPDATE', [id], db);
  if (!d) throw notFound('Delivery');
  return d;
}

deliveriesRouter.post('/:id/pick', async (req, res) => {
  assertCan(req, 'delivery.pick');
  const id = paramId(req);
  const me = currentUser(req);
  await idempotentTransaction(req, res, `dl.pick.${id}`, async (db) => {
    const d = await lockDelivery(db, id);
    if (d.status !== 'Created') throw ruleViolation(`Delivery ${d.number} is ${d.status}; only new deliveries can be picked.`);
    await query("UPDATE deliveries SET status = 'Picked', picked_by = $2, picked_at = now(), updated_at = now() WHERE id = $1", [id, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'pick', entityType: 'DL', entityId: id, entityRef: `DL ${d.number}`,
      summary: `Delivery ${d.number} picked and packed by ${me.fullName}` });
    return { status: 200, body: { message: `Delivery ${d.number}: picked and packed.` } };
  });
});

deliveriesRouter.post('/:id/goods-issue', async (req, res) => {
  assertCan(req, 'delivery.goods_issue');
  const id = paramId(req);
  const me = currentUser(req);
  await idempotentTransaction(req, res, `dl.gi.${id}`, async (db) => {
    const d = await lockDelivery(db, id);
    if (d.status === 'Created') throw ruleViolation(`Delivery ${d.number} must be picked before goods issue.`);
    if (d.status !== 'Picked') throw ruleViolation(`Goods issue for delivery ${d.number} is already posted.`);
    const items = await query<{ material_id: number; quantity: number; code: string }>(
      `SELECT di.material_id, sum(di.quantity)::int AS quantity, m.code FROM delivery_items di JOIN materials m ON m.id = di.material_id
        WHERE di.delivery_id = $1 GROUP BY di.material_id, m.code ORDER BY di.material_id`, [id], db);
    const parts: string[] = [];
    // Any insufficient line aborts the whole transaction: no partial goods issue is ever committed.
    for (const it of items) {
      const left = await postMovement(db, { materialId: it.material_id, plantId: d.plant_id, quantity: -it.quantity, type: 'GOODS_ISSUE',
        referenceType: 'DL', referenceId: id, referenceNumber: String(d.number), reason: `Goods issue for delivery ${d.number}`, userId: me.id });
      parts.push(`−${it.quantity} ${it.code} (stock ${left})`);
    }
    await query("UPDATE deliveries SET status = 'Goods Issued', goods_issued_by = $2, goods_issued_at = now(), updated_at = now() WHERE id = $1",
      [id, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'goods_issue', entityType: 'DL', entityId: id, entityRef: `DL ${d.number}`,
      summary: `Goods issue for delivery ${d.number}: ${parts.join(', ')} (by ${me.fullName})` });
    await notify(db, [d.created_by, ...(await usersWithRoles(db, ['FIN']))], me.id,
      `Goods issue posted for delivery ${d.number} – ready for billing`, `/sales/deliveries/${id}`);
    return { status: 200, body: { message: `Goods issue posted for delivery ${d.number}: ${parts.join(', ')}.` } };
  });
});

deliveriesRouter.post('/:id/invoice', async (req, res) => {
  assertCan(req, 'invoice.create');
  const id = paramId(req);
  const me = currentUser(req);
  await idempotentTransaction(req, res, `inv.create.${id}`, async (db) => {
    const d = await lockDelivery(db, id);
    if (d.status === 'Billed') throw ruleViolation(`Delivery ${d.number} has already been billed.`);
    if (d.status !== 'Goods Issued') throw ruleViolation(`Delivery ${d.number} cannot be billed before goods issue.`);
    const lines = await query<{ quantity: number; unit_price: string }>(
      `SELECT di.quantity, soi.unit_price FROM delivery_items di JOIN sales_order_items soi ON soi.id = di.sales_order_item_id
        WHERE di.delivery_id = $1`, [id], db);
    const rate = await getSetting('gst_rate_bp', db);
    const net = lines.reduce((s, l) => s + lineAmount(l.quantity, l.unit_price), 0n);
    const tax = taxAmount(net, rate);
    const so = (await queryOne<{ customer_id: number; number: number }>('SELECT customer_id, number FROM sales_orders WHERE id = $1', [d.sales_order_id], db))!;
    const inv = (await queryOne<{ id: number; number: number }>(
      `INSERT INTO invoices (delivery_id, sales_order_id, customer_id, net_amount, tax_rate_bp, tax_amount, total_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, number`,
      [id, d.sales_order_id, so.customer_id, fromPaise(net), rate, fromPaise(tax), fromPaise(net + tax), me.id], db))!;
    await query("UPDATE deliveries SET status = 'Billed', updated_at = now() WHERE id = $1", [id], db);
    await logActivity(db, { actorId: me.id, action: 'invoice', entityType: 'INV', entityId: inv.id, entityRef: `INV ${inv.number}`,
      summary: `Invoice ${inv.number} for delivery ${d.number} (SO ${so.number}): ${inr(net)} + GST ${inr(tax)} = ${inr(net + tax)} (by ${me.fullName})` });
    await notify(db, [d.created_by], me.id, `Invoice ${inv.number} posted for delivery ${d.number}`, `/sales/invoices/${inv.id}`);
    return { status: 201, body: { id: inv.id, number: inv.number, message: `Invoice ${inv.number}: ${inr(net)} + ${rate / 100}% GST = ${inr(net + tax)}.` } };
  });
});

// ───────────── Invoices ─────────────

invoicesRouter.get('/', async (req, res) => {
  const f = parse(z.object({ customerId: z.coerce.number().int().positive().optional() }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.customerId) w.add('i.customer_id = ?', f.customerId);
  const rows = await query(
    `SELECT i.id, i.number, i.status, i.net_amount, i.tax_amount, i.total_amount, i.currency, i.created_at,
            c.name AS customer_name, d.id AS delivery_id, d.number AS delivery_number, so.number AS sales_order_number,
            count(*) OVER() AS total_count
       FROM invoices i JOIN companies c ON c.id = i.customer_id JOIN deliveries d ON d.id = i.delivery_id
       JOIN sales_orders so ON so.id = i.sales_order_id
       ${w.sql} ORDER BY i.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

invoicesRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const inv = await queryOne(
    `SELECT i.*, c.code AS customer_code, c.name AS customer_name, c.city AS customer_city, c.industry AS customer_industry,
            d.number AS delivery_number, so.id AS sales_order_id, so.number AS sales_order_number, p.code AS plant_code, p.name AS plant_name,
            u.full_name AS created_by_name
       FROM invoices i JOIN companies c ON c.id = i.customer_id JOIN deliveries d ON d.id = i.delivery_id
       JOIN sales_orders so ON so.id = i.sales_order_id JOIN plants p ON p.id = d.plant_id JOIN users u ON u.id = i.created_by
      WHERE i.id = $1`, [id]);
  if (!inv) throw notFound('Invoice');
  const items = await query(
    `SELECT di.quantity, soi.unit_price, (di.quantity * soi.unit_price)::numeric(15,2)::text AS net_amount,
            m.code AS material_code, m.description AS material_description
       FROM invoices i JOIN delivery_items di ON di.delivery_id = i.delivery_id JOIN sales_order_items soi ON soi.id = di.sales_order_item_id
       JOIN materials m ON m.id = di.material_id WHERE i.id = $1 ORDER BY di.id`, [id]);
  res.json({ ...camel(inv), items: camelAll(items) });
});
