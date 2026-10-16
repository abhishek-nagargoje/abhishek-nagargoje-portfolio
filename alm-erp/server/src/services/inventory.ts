import { queryOne, type Db } from '../db/pool.js';
import { ruleViolation } from '../lib/errors.js';

export type MovementType = 'INITIAL' | 'GOODS_RECEIPT' | 'GOODS_ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';

export interface MovementInput {
  materialId: number;
  plantId: number;
  quantity: number; // signed; never zero
  type: MovementType;
  referenceType?: string;
  referenceId?: number;
  referenceNumber?: string;
  reason?: string;
  userId: number | null;
}

/**
 * Post one stock movement and update the balance atomically.
 * Must be called inside a transaction. The balance row is locked so concurrent
 * postings serialise, and negative stock is rejected with a business error.
 */
export async function postMovement(db: Db, m: MovementInput): Promise<number> {
  if (!Number.isInteger(m.quantity) || m.quantity === 0) throw new Error('Movement quantity must be a non-zero integer');
  // Ensure the row exists, then lock it.
  await db.query(
    `INSERT INTO inventory_balances (material_id, plant_id, on_hand) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`,
    [m.materialId, m.plantId],
  );
  const bal = await queryOne<{ on_hand: number; code: string; plant: string }>(
    `SELECT b.on_hand, mt.code, p.code AS plant FROM inventory_balances b
       JOIN materials mt ON mt.id = b.material_id JOIN plants p ON p.id = b.plant_id
      WHERE b.material_id = $1 AND b.plant_id = $2 FOR UPDATE OF b`,
    [m.materialId, m.plantId],
    db,
  );
  const available = bal!.on_hand;
  if (available + m.quantity < 0) {
    throw ruleViolation(
      `Insufficient stock: ${available} × ${bal!.code} available at ${bal!.plant}, ${-m.quantity} required.`,
      { material: bal!.code, plant: bal!.plant, available, required: -m.quantity },
    );
  }
  const updated = await queryOne<{ on_hand: number }>(
    `UPDATE inventory_balances SET on_hand = on_hand + $3, updated_at = now()
      WHERE material_id = $1 AND plant_id = $2 RETURNING on_hand`,
    [m.materialId, m.plantId, m.quantity],
    db,
  );
  await db.query(
    `INSERT INTO inventory_movements (material_id, plant_id, quantity, movement_type, reference_type, reference_id,
        reference_number, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [m.materialId, m.plantId, m.quantity, m.type, m.referenceType ?? null, m.referenceId ?? null,
     m.referenceNumber ?? null, m.reason ?? '', m.userId],
  );
  return updated!.on_hand;
}

export async function availability(db: Db, plantId: number, materialId: number) {
  const row = await queryOne<{ on_hand: number; incoming: number; demand: number }>(
    `SELECT COALESCE((SELECT on_hand FROM inventory_balances WHERE plant_id = $1 AND material_id = $2), 0) AS on_hand,
            COALESCE((SELECT qty FROM v_incoming WHERE plant_id = $1 AND material_id = $2), 0) AS incoming,
            COALESCE((SELECT qty FROM v_demand WHERE plant_id = $1 AND material_id = $2), 0) AS demand`,
    [plantId, materialId],
    db,
  );
  const r = row!;
  return { onHand: r.on_hand, incoming: r.incoming, demand: r.demand, atp: r.on_hand + r.incoming - r.demand };
}
