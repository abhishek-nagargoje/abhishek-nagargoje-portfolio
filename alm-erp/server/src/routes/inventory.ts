import { Router } from 'express';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { getPool, query, queryOne } from '../db/pool.js';
import { notFound, ruleViolation } from '../lib/errors.js';
import { camel, camelAll, likePattern, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { logActivity } from '../services/activity.js';
import { idempotentTransaction } from '../services/idempotency.js';
import { availability, postMovement } from '../services/inventory.js';

export const plantsRouter = Router();
export const materialsRouter = Router();
export const inventoryRouter = Router();

plantsRouter.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT p.id, p.code, p.plant_no, p.name, p.city,
            COALESCE(sum(b.on_hand), 0)::int AS units,
            COALESCE(sum(b.on_hand * m.cost_price), 0)::numeric(15,2)::text AS stock_value
       FROM plants p LEFT JOIN inventory_balances b ON b.plant_id = p.id LEFT JOIN materials m ON m.id = b.material_id
      GROUP BY p.id ORDER BY p.plant_no`);
  res.json({ items: camelAll(rows) });
});

materialsRouter.get('/categories', async (_req, res) => {
  const rows = await query<{ category: string }>('SELECT DISTINCT category FROM materials ORDER BY category');
  res.json({ items: rows.map((r) => r.category) });
});

const materialQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
});

materialsRouter.get('/', async (req, res) => {
  const f = parse(materialQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  w.add('m.is_active');
  if (f.q) w.add('(m.code ILIKE ? OR m.description ILIKE ?)', likePattern(f.q), likePattern(f.q));
  if (f.category) w.add('m.category = ?', f.category);
  const rows = await query(
    `SELECT m.id, m.code, m.description, m.category, m.uom, m.cost_price, m.list_price, m.is_sample,
            count(*) OVER() AS total_count
       FROM materials m ${w.sql} ORDER BY m.code LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

materialsRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const m = await queryOne('SELECT * FROM materials WHERE id = $1', [id]);
  if (!m) throw notFound('Material');
  const [plants, movements] = await Promise.all([
    query(
      `SELECT p.id AS plant_id, p.code AS plant_code, p.name AS plant_name,
              COALESCE(b.on_hand, 0) AS on_hand, COALESCE(inc.qty, 0) AS incoming, COALESCE(dem.qty, 0) AS demand
         FROM plants p
         LEFT JOIN inventory_balances b ON b.plant_id = p.id AND b.material_id = $1
         LEFT JOIN v_incoming inc ON inc.plant_id = p.id AND inc.material_id = $1
         LEFT JOIN v_demand dem ON dem.plant_id = p.id AND dem.material_id = $1
        ORDER BY p.plant_no`, [id]),
    query(
      `SELECT mv.id, mv.quantity, mv.movement_type, mv.reference_number, mv.reason, mv.created_at, p.code AS plant_code,
              u.full_name AS created_by_name
         FROM inventory_movements mv JOIN plants p ON p.id = mv.plant_id LEFT JOIN users u ON u.id = mv.created_by
        WHERE mv.material_id = $1 ORDER BY mv.created_at DESC, mv.id DESC LIMIT 50`, [id]),
  ]);
  res.json({
    ...camel(m),
    plants: camelAll<{ onHand: number; incoming: number; demand: number }>(plants).map((p) => ({ ...p, atp: p.onHand + p.incoming - p.demand })),
    movements: camelAll(movements),
  });
});

const stockQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  plantId: z.coerce.number().int().positive().optional(),
  onlyInStock: z.enum(['true']).optional(),
});

/** Stock overview: one row per material with quantities per plant and ATP at the selected plant. */
inventoryRouter.get('/stock', async (req, res) => {
  const f = parse(stockQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  w.add('m.is_active');
  if (f.q) w.add('(m.code ILIKE ? OR m.description ILIKE ?)', likePattern(f.q), likePattern(f.q));
  if (f.category) w.add('m.category = ?', f.category);
  if (f.onlyInStock) w.add('EXISTS (SELECT 1 FROM inventory_balances b WHERE b.material_id = m.id AND b.on_hand > 0)');
  const plantParam = w.param(f.plantId ?? null);
  const rows = await query(
    `WITH page AS (
       SELECT m.id, m.code, m.description, m.category, m.cost_price, m.list_price, count(*) OVER() AS total_count
         FROM materials m ${w.sql} ORDER BY m.code LIMIT ${pageSize} OFFSET ${offset})
     SELECT page.*,
            COALESCE((SELECT json_object_agg(p.code, COALESCE(b.on_hand, 0))
                        FROM plants p LEFT JOIN inventory_balances b ON b.plant_id = p.id AND b.material_id = page.id), '{}') AS by_plant,
            COALESCE((SELECT sum(on_hand) FROM inventory_balances b WHERE b.material_id = page.id), 0)::int AS total,
            COALESCE((SELECT on_hand FROM inventory_balances b WHERE b.material_id = page.id AND b.plant_id = ${plantParam}::int), 0) AS on_hand,
            COALESCE((SELECT qty FROM v_incoming v WHERE v.material_id = page.id AND v.plant_id = ${plantParam}::int), 0) AS incoming,
            COALESCE((SELECT qty FROM v_demand v WHERE v.material_id = page.id AND v.plant_id = ${plantParam}::int), 0) AS demand
       FROM page ORDER BY page.code`,
    w.params,
  );
  const result = toPage<{ onHand: number; incoming: number; demand: number }>(rows, page, pageSize);
  res.json({ ...result, items: result.items.map((r) => ({ ...r, atp: r.onHand + r.incoming - r.demand })) });
});

inventoryRouter.get('/summary', async (_req, res) => {
  const [byCategory, byPlant] = await Promise.all([
    query(`SELECT m.category, COALESCE(sum(b.on_hand), 0)::int AS units,
                  COALESCE(sum(b.on_hand * m.cost_price), 0)::numeric(15,2)::text AS value
             FROM materials m LEFT JOIN inventory_balances b ON b.material_id = m.id
            GROUP BY m.category ORDER BY m.category`),
    query(`SELECT p.code, p.name, COALESCE(sum(b.on_hand), 0)::int AS units,
                  COALESCE(sum(b.on_hand * m.cost_price), 0)::numeric(15,2)::text AS value
             FROM plants p LEFT JOIN inventory_balances b ON b.plant_id = p.id LEFT JOIN materials m ON m.id = b.material_id
            GROUP BY p.id ORDER BY p.plant_no`),
  ]);
  res.json({ byCategory: camelAll(byCategory), byPlant: camelAll(byPlant) });
});

const movementQuery = z.object({
  materialId: z.coerce.number().int().positive().optional(),
  plantId: z.coerce.number().int().positive().optional(),
  type: z.enum(['INITIAL', 'GOODS_RECEIPT', 'GOODS_ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT']).optional(),
  excludeInitial: z.enum(['true']).optional(),
});

inventoryRouter.get('/movements', async (req, res) => {
  const f = parse(movementQuery, req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.materialId) w.add('mv.material_id = ?', f.materialId);
  if (f.plantId) w.add('mv.plant_id = ?', f.plantId);
  if (f.type) w.add('mv.movement_type = ?', f.type);
  if (f.excludeInitial) w.add("mv.movement_type <> 'INITIAL'");
  const rows = await query(
    `SELECT mv.id, mv.quantity, mv.movement_type, mv.reference_type, mv.reference_id, mv.reference_number, mv.reason, mv.created_at,
            m.id AS material_id, m.code AS material_code, p.code AS plant_code, u.full_name AS created_by_name,
            count(*) OVER() AS total_count
       FROM inventory_movements mv JOIN materials m ON m.id = mv.material_id JOIN plants p ON p.id = mv.plant_id
       LEFT JOIN users u ON u.id = mv.created_by
       ${w.sql} ORDER BY mv.created_at DESC, mv.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

inventoryRouter.get('/availability', async (req, res) => {
  const q = parse(z.object({ plantId: z.coerce.number().int().positive(), materialId: z.coerce.number().int().positive() }), req.query);
  res.json(await availability(getPool(), q.plantId, q.materialId));
});

const transferSchema = z.object({
  materialId: z.number().int().positive(),
  fromPlantId: z.number().int().positive(),
  toPlantId: z.number().int().positive(),
  quantity: z.number().int().positive('Quantity must be greater than 0.').max(1_000_000),
  notes: z.string().max(1000).default(''),
});

inventoryRouter.post('/transfers', async (req, res) => {
  assertCan(req, 'inventory.transfer');
  const me = currentUser(req);
  const b = parse(transferSchema, req.body);
  if (b.fromPlantId === b.toPlantId) throw ruleViolation('Source and target plant must be different.');
  await idempotentTransaction(req, res, 'inventory.transfer', async (db) => {
    const m = await queryOne<{ code: string }>('SELECT code FROM materials WHERE id = $1 AND is_active', [b.materialId], db);
    if (!m) throw notFound('Material');
    const plants = await query<{ id: number; code: string }>('SELECT id, code FROM plants WHERE id = ANY($1::int[])', [[b.fromPlantId, b.toPlantId]], db);
    if (plants.length !== 2) throw notFound('Plant');
    const code = (id: number) => plants.find((p) => p.id === id)!.code;
    const st = (await queryOne<{ id: number; number: number }>(
      `INSERT INTO stock_transfers (material_id, from_plant_id, to_plant_id, quantity, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, number`,
      [b.materialId, b.fromPlantId, b.toPlantId, b.quantity, b.notes, me.id], db))!;
    // Lock order by plant id avoids deadlocks between opposite transfers.
    const legs = [
      { plantId: b.fromPlantId, quantity: -b.quantity, type: 'TRANSFER_OUT' as const, reason: `Transfer to ${code(b.toPlantId)}` },
      { plantId: b.toPlantId, quantity: b.quantity, type: 'TRANSFER_IN' as const, reason: `Transfer from ${code(b.fromPlantId)}` },
    ].sort((x, y) => x.plantId - y.plantId);
    for (const leg of legs) {
      await postMovement(db, { materialId: b.materialId, ...leg, referenceType: 'ST', referenceId: st.id,
        referenceNumber: String(st.number), userId: me.id });
    }
    await logActivity(db, { actorId: me.id, action: 'stock_transfer', entityType: 'ST', entityId: st.id, entityRef: `ST ${st.number}`,
      summary: `Stock transfer ${st.number}: ${b.quantity} × ${m.code} ${code(b.fromPlantId)} → ${code(b.toPlantId)} (by ${me.fullName})` });
    return { status: 201, body: { id: st.id, number: st.number, message: `Stock transfer ${st.number} posted: ${b.quantity} × ${m.code} moved ${code(b.fromPlantId)} → ${code(b.toPlantId)}.` } };
  });
});

const adjustSchema = z.object({
  materialId: z.number().int().positive(),
  plantId: z.number().int().positive(),
  quantity: z.number().int().min(-1_000_000).max(1_000_000).refine((q) => q !== 0, 'Quantity cannot be zero.'),
  reason: z.string().trim().min(3, 'A reason is required for stock adjustments.').max(500),
});

inventoryRouter.post('/adjustments', async (req, res) => {
  assertCan(req, 'inventory.adjust');
  const me = currentUser(req);
  const b = parse(adjustSchema, req.body);
  await idempotentTransaction(req, res, 'inventory.adjust', async (db) => {
    const m = await queryOne<{ code: string }>('SELECT code FROM materials WHERE id = $1 AND is_active', [b.materialId], db);
    if (!m) throw notFound('Material');
    const p = await queryOne<{ code: string }>('SELECT code FROM plants WHERE id = $1', [b.plantId], db);
    if (!p) throw notFound('Plant');
    const onHand = await postMovement(db, { materialId: b.materialId, plantId: b.plantId, quantity: b.quantity, type: 'ADJUSTMENT',
      reason: b.reason, userId: me.id });
    await logActivity(db, { actorId: me.id, action: 'stock_adjustment', entityType: 'material', entityId: b.materialId, entityRef: m.code,
      summary: `Stock adjustment ${b.quantity > 0 ? '+' : ''}${b.quantity} × ${m.code} at ${p.code} (${b.reason}) by ${me.fullName}` });
    return { status: 201, body: { onHand, message: `Adjustment posted. ${m.code} stock at ${p.code} is now ${onHand}.` } };
  });
});
