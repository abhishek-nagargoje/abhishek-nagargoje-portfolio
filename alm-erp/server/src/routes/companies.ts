import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { assertCan, can, currentUser } from '../auth/middleware.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { camel, camelAll, likePattern, paging, paramId, parse, toPage, Where } from '../lib/http.js';
import { isMoney } from '../lib/money.js';
import { logActivity } from '../services/activity.js';

export const companiesRouter = Router();

const SENSITIVE = ['contactName', 'email', 'phone', 'creditLimit', 'gstin'] as const;

/** Contact details, tax IDs and credit limits are only returned to roles with company.sensitive. */
function redact<T extends Record<string, unknown>>(req: Request, c: T): T & { restricted: boolean } {
  if (can(req, 'company.sensitive')) return { ...c, restricted: false };
  const out: Record<string, unknown> = { ...c };
  for (const k of SENSITIVE) if (k in out) out[k] = null;
  return { ...(out as T), restricted: true };
}

companiesRouter.get('/', async (req, res) => {
  const f = parse(z.object({
    q: z.string().trim().max(100).optional(),
    type: z.enum(['Customer', 'Vendor']).optional(),
    status: z.enum(['Active', 'Blocked']).optional(),
    city: z.string().trim().max(60).optional(),
  }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w = new Where();
  if (f.q) w.add('(c.code ILIKE ? OR c.name ILIKE ? OR c.city ILIKE ? OR c.industry ILIKE ?)', ...Array(4).fill(likePattern(f.q)));
  if (f.type) w.add('c.type = ?', f.type);
  if (f.status) w.add('c.status = ?', f.status);
  if (f.city) w.add('c.city = ?', f.city);
  const rows = await query(
    `SELECT c.id, c.code, c.name, c.type, c.industry, c.city, c.contact_name, c.payment_terms, c.status, c.is_sample,
            count(*) OVER() AS total_count
       FROM companies c ${w.sql} ORDER BY c.type, c.code LIMIT ${pageSize} OFFSET ${offset}`, w.params);
  const p = toPage<Record<string, unknown>>(rows, page, pageSize);
  res.json({ ...p, items: p.items.map((c) => redact(req, c)) });
});

companiesRouter.get('/:id', async (req, res) => {
  const id = paramId(req);
  const c = await queryOne('SELECT * FROM companies WHERE id = $1', [id]);
  if (!c) throw notFound('Company');
  const docs = await query(
    `SELECT d.doc_type, d.id, d.number, d.status, d.amount, d.created_at FROM document_index d
      WHERE d.partner_id = $1 AND d.doc_type IN ('PO','SO','INV') ORDER BY d.created_at DESC LIMIT 20`, [id]);
  res.json({ ...redact(req, camel(c)), documents: camelAll(docs) });
});

const gstin = z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN format is invalid.');
const base = {
  name: z.string().trim().min(1, 'Name is required.').max(160),
  industry: z.string().trim().max(80).default(''),
  addressLine: z.string().trim().max(200).default(''),
  city: z.string().trim().max(80).default(''),
  state: z.string().trim().max(80).default(''),
  postalCode: z.string().trim().regex(/^(\d{6})?$/, 'PIN code must be 6 digits.').default(''),
  gstin: gstin.nullable().optional(),
  contactName: z.string().trim().max(120).default(''),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]).default(''),
  phone: z.string().trim().regex(/^(\+?[0-9 ()-]{7,20})?$/, 'Enter a valid phone number.').default(''),
  paymentTerms: z.enum(['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60']).default('Net 30'),
  creditLimit: z.string().refine(isMoney, 'Enter a valid amount.').default('0'),
  vendorRating: z.number().int().min(0).max(5).default(0),
  status: z.enum(['Active', 'Blocked']).default('Active'),
};
const createSchema = z.object({ ...base, type: z.enum(['Customer', 'Vendor']) });
const updateSchema = z.object(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, (v as z.ZodType).optional()])) as {
  [K in keyof typeof base]: z.ZodOptional<(typeof base)[K]>;
});

companiesRouter.post('/', async (req, res) => {
  assertCan(req, 'company.manage');
  const me = currentUser(req);
  const b = parse(createSchema, req.body);
  const id = await withTransaction(async (db) => {
    const prefix = b.type === 'Customer' ? 'C' : 'V';
    // Serialise code allocation for concurrent creations.
    await db.query('LOCK TABLE companies IN SHARE ROW EXCLUSIVE MODE');
    const next = await queryOne<{ n: number }>(
      `SELECT COALESCE(max(substring(code from 2)::int), 0) + 1 AS n FROM companies WHERE code ~ $1`, [`^${prefix}[0-9]+$`], db);
    const code = `${prefix}${next!.n}`;
    const row = await queryOne<{ id: number }>(
      `INSERT INTO companies (code, name, type, industry, address_line, city, state, postal_code, gstin, contact_name, email, phone,
          payment_terms, credit_limit, vendor_rating, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [code, b.name, b.type, b.industry, b.addressLine, b.city, b.state, b.postalCode, b.gstin ?? null, b.contactName, b.email, b.phone,
       b.paymentTerms, b.type === 'Customer' ? b.creditLimit : '0', b.type === 'Vendor' ? b.vendorRating : 0, b.status, me.id], db);
    await logActivity(db, { actorId: me.id, action: 'create', entityType: 'company', entityId: row!.id, entityRef: code,
      summary: `${me.fullName} created ${b.type.toLowerCase()} ${code} ${b.name}` });
    return row!.id;
  });
  const c = await queryOne('SELECT * FROM companies WHERE id = $1', [id]);
  res.status(201).json(redact(req, camel(c!)));
});

companiesRouter.patch('/:id', async (req, res) => {
  assertCan(req, 'company.manage');
  const id = paramId(req);
  const me = currentUser(req);
  const b = parse(updateSchema, req.body);
  const cols: Record<string, string> = {
    name: 'name', industry: 'industry', addressLine: 'address_line', city: 'city', state: 'state', postalCode: 'postal_code',
    gstin: 'gstin', contactName: 'contact_name', email: 'email', phone: 'phone', paymentTerms: 'payment_terms',
    creditLimit: 'credit_limit', vendorRating: 'vendor_rating', status: 'status',
  };
  await withTransaction(async (db) => {
    const cur = await queryOne<{ code: string }>('SELECT code FROM companies WHERE id = $1 FOR UPDATE', [id], db);
    if (!cur) throw notFound('Company');
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [k, col] of Object.entries(cols)) {
      const v = (b as Record<string, unknown>)[k];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) return;
    await query(`UPDATE companies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params, db);
    await logActivity(db, { actorId: me.id, action: 'update', entityType: 'company', entityId: id, entityRef: cur.code,
      summary: `${me.fullName} updated company ${cur.code}`, details: { fields: Object.keys(b) } });
  });
  const c = await queryOne('SELECT * FROM companies WHERE id = $1', [id]);
  res.json(redact(req, camel(c!)));
});
