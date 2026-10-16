import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { camelAll, paging, parse, toPage, Where } from '../lib/http.js';

export const documentsRouter = Router();

const DOC_TYPES = ['PR', 'PO', 'GR', 'SO', 'DL', 'INV', 'ST'] as const;

documentsRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    type: z.enum(DOC_TYPES).optional(),
    plantId: z.coerce.number().int().positive().optional(),
    number: z.string().regex(/^\d{1,12}$/).optional(),
  }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.type) w.add('d.doc_type = ?', f.type);
  if (f.plantId) w.add('d.plant_id = ?', f.plantId);
  if (f.number) w.add('d.number::text LIKE ?', `${f.number}%`);
  const rows = await query(
    `SELECT d.doc_type, d.id, d.number, d.status, d.created_at, d.amount, p.code AS plant_code, c.name AS partner_name,
            u.full_name AS created_by_name, count(*) OVER() AS total_count
       FROM document_index d JOIN plants p ON p.id = d.plant_id LEFT JOIN companies c ON c.id = d.partner_id
       LEFT JOIN users u ON u.id = d.created_by
       ${w.sql} ORDER BY d.created_at DESC, d.number DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  res.json(toPage(rows, page, pageSize));
});

/**
 * Document flow: every document connected to the given one through
 * PR → PO → GR and SO → (PO) / DL → INV relationships.
 */
documentsRouter.get('/flow', async (req, res) => {
  const f = parse(z.object({ type: z.enum(DOC_TYPES), id: z.coerce.number().int().positive() }), req.query);
  const ids = { so: new Set<number>(), po: new Set<number>(), pr: new Set<number>() };
  const one = async (sql: string, p: unknown[]) => (await query<{ id: number | null }>(sql, p)).map((r) => r.id).filter((x): x is number => !!x);

  switch (f.type) {
    case 'SO': ids.so.add(f.id); break;
    case 'PO': ids.po.add(f.id); break;
    case 'PR': ids.pr.add(f.id); (await one('SELECT id FROM purchase_orders WHERE requisition_id = $1', [f.id])).forEach((x) => ids.po.add(x)); break;
    case 'GR': (await one('SELECT purchase_order_id AS id FROM goods_receipts WHERE id = $1', [f.id])).forEach((x) => ids.po.add(x)); break;
    case 'DL': (await one('SELECT sales_order_id AS id FROM deliveries WHERE id = $1', [f.id])).forEach((x) => ids.so.add(x)); break;
    case 'INV': (await one('SELECT sales_order_id AS id FROM invoices WHERE id = $1', [f.id])).forEach((x) => ids.so.add(x)); break;
    case 'ST': break;
  }
  // POs point to their sales order; sales orders pull in their POs.
  if (ids.po.size) (await one('SELECT sales_order_id AS id FROM purchase_orders WHERE id = ANY($1::int[])', [[...ids.po]])).forEach((x) => ids.so.add(x));
  if (ids.so.size) (await one('SELECT id FROM purchase_orders WHERE sales_order_id = ANY($1::int[])', [[...ids.so]])).forEach((x) => ids.po.add(x));
  if (ids.po.size) (await one('SELECT requisition_id AS id FROM purchase_orders WHERE id = ANY($1::int[])', [[...ids.po]])).forEach((x) => ids.pr.add(x));

  const so = [...ids.so], po = [...ids.po], pr = [...ids.pr];
  const rows = await query(
    `SELECT d.doc_type, d.id, d.number, d.status, d.created_at, d.amount FROM document_index d
      WHERE (d.doc_type = 'SO' AND d.id = ANY($1::int[]))
         OR (d.doc_type = 'PO' AND d.id = ANY($2::int[]))
         OR (d.doc_type = 'PR' AND d.id = ANY($3::int[]))
         OR (d.doc_type = 'GR' AND d.id IN (SELECT id FROM goods_receipts WHERE purchase_order_id = ANY($2::int[])))
         OR (d.doc_type = 'DL' AND d.id IN (SELECT id FROM deliveries WHERE sales_order_id = ANY($1::int[])))
         OR (d.doc_type = 'INV' AND d.id IN (SELECT id FROM invoices WHERE sales_order_id = ANY($1::int[])))
         OR (d.doc_type = 'ST' AND $4::text = 'ST' AND d.id = $5)
      ORDER BY d.created_at, d.number`,
    [so, po, pr, f.type, f.id]);
  res.json({ items: camelAll(rows) });
});
