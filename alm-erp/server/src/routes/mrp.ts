import { Router } from 'express';
import { z } from 'zod';
import { assertCan, currentUser } from '../auth/middleware.js';
import { getPool, query, queryOne, type Db } from '../db/pool.js';
import { notFound, ruleViolation } from '../lib/errors.js';
import { camelAll, parse } from '../lib/http.js';
import { logActivity } from '../services/activity.js';
import { idempotentTransaction } from '../services/idempotency.js';

export const mrpRouter = Router();

/** Net requirements at a plant: open demand − stock on hand − incoming supply. */
async function planningRows(db: Db, plantId: number, materialId?: number) {
  return query(
    `SELECT m.id AS material_id, m.code AS material_code, m.description AS material_description,
            d.qty AS demand, COALESCE(b.on_hand, 0) AS on_hand, COALESCE(inc.qty, 0) AS incoming,
            GREATEST(d.qty - COALESCE(b.on_hand, 0) - COALESCE(inc.qty, 0), 0) AS shortage
       FROM v_demand d JOIN materials m ON m.id = d.material_id
       LEFT JOIN inventory_balances b ON b.material_id = d.material_id AND b.plant_id = d.plant_id
       LEFT JOIN v_incoming inc ON inc.material_id = d.material_id AND inc.plant_id = d.plant_id
      WHERE d.plant_id = $1 AND ($2::int IS NULL OR d.material_id = $2)
      ORDER BY shortage DESC, m.code`,
    [plantId, materialId ?? null],
    db,
  );
}

mrpRouter.get('/', async (req, res) => {
  const q = parse(z.object({ plantId: z.coerce.number().int().positive() }), req.query);
  const plant = await queryOne('SELECT id FROM plants WHERE id = $1', [q.plantId]);
  if (!plant) throw notFound('Plant');
  const rows = await planningRows(getPool(), q.plantId);
  res.json({ items: camelAll(rows), runAt: new Date().toISOString() });
});

mrpRouter.post('/requisitions', async (req, res) => {
  assertCan(req, 'mrp.run');
  const me = currentUser(req);
  const b = parse(z.object({ plantId: z.number().int().positive(), materialId: z.number().int().positive() }), req.body);
  await idempotentTransaction(req, res, 'mrp.convert', async (db) => {
    // Serialise conversions for the same plant/material so a shortage is never converted twice.
    await db.query('SELECT pg_advisory_xact_lock($1, $2)', [b.plantId, b.materialId]);
    const [row] = camelAll<{ shortage: number; materialCode: string }>(await planningRows(db, b.plantId, b.materialId));
    if (!row || row.shortage <= 0) throw ruleViolation('There is no uncovered shortage for this material at this plant.');
    const plant = (await queryOne<{ code: string }>('SELECT code FROM plants WHERE id = $1', [b.plantId], db))!;
    const pr = (await queryOne<{ id: number; number: number }>(
      `INSERT INTO purchase_requisitions (plant_id, material_id, quantity, source, created_by) VALUES ($1,$2,$3,'MRP',$4)
       RETURNING id, number`, [b.plantId, b.materialId, row.shortage, me.id], db))!;
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'PR', entityId: pr.id, entityRef: `PR ${pr.number}`,
      summary: `MRP proposal converted: PR ${pr.number} for ${row.shortage} × ${row.materialCode} at ${plant.code} (by ${me.fullName})` });
    return { status: 201, body: { id: pr.id, number: pr.number, quantity: row.shortage,
      message: `PR ${pr.number} created for ${row.shortage} × ${row.materialCode} at ${plant.code}.` } };
  });
});
