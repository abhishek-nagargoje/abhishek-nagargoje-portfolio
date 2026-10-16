import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { hashPassword } from '../src/lib/password.js';
import { loginAccountLimiter, loginIpLimiter } from '../src/routes/auth.js';

export const app = createApp();
export const PASSWORD = 'Test-Passw0rd!';
let hash: Promise<string> | null = null;

beforeEach(() => {
  loginIpLimiter.clear();
  loginAccountLimiter.clear();
});
afterAll(async () => {
  await closePool();
});

export interface TestUser { id: number; email: string }

export async function createUser(roles: string[], opts: { mustChange?: boolean; name?: string } = {}): Promise<TestUser> {
  hash ??= hashPassword(PASSWORD);
  const email = `t-${randomUUID().slice(0, 8)}@test.example`;
  const u = await queryOne<{ id: number }>(
    'INSERT INTO users (email, full_name, password_hash, must_change_password) VALUES ($1,$2,$3,$4) RETURNING id',
    [email, opts.name ?? `Test ${roles.join('/')}`, await hash, !!opts.mustChange]);
  for (const r of roles) await query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [u!.id, r]);
  return { id: u!.id, email };
}

/** A logged-in client that sends the CSRF token on every state-changing call. */
export class Client {
  agent = request.agent(app);
  csrf = '';
  user!: { id: number; permissions: string[] };

  static async login(email: string, password = PASSWORD) {
    const c = new Client();
    const res = await c.agent.post('/api/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    c.csrf = res.body.csrfToken;
    c.user = res.body.user;
    return c;
  }

  static async as(roles: string[]) {
    const u = await createUser(roles);
    return Client.login(u.email);
  }

  get(url: string) {
    return this.agent.get(`/api${url}`);
  }
  post(url: string, body: object = {}, headers: Record<string, string> = {}) {
    return this.agent.post(`/api${url}`).set('X-CSRF-Token', this.csrf).set(headers).send(body);
  }
  patch(url: string, body: object) {
    return this.agent.patch(`/api${url}`).set('X-CSRF-Token', this.csrf).send(body);
  }
  put(url: string, body: object) {
    return this.agent.put(`/api${url}`).set('X-CSRF-Token', this.csrf).send(body);
  }
}

export const id = async (sql: string, params: unknown[] = []) => (await queryOne<{ id: number }>(sql, params))!.id;
export const plantId = (code: string) => id('SELECT id FROM plants WHERE code = $1', [code]);
export const companyId = (code: string) => id('SELECT id FROM companies WHERE code = $1', [code]);

/** A fresh material with controlled stock, isolated from other tests. */
export async function newMaterial(cost = '1000.00', list = '1500.00', stock: Record<string, number> = {}) {
  const code = `T${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  const m = await id(
    `INSERT INTO materials (code, description, category, cost_price, list_price) VALUES ($1,'Test material','Test',$2,$3) RETURNING id`,
    [code, cost, list]);
  for (const [plant, qty] of Object.entries(stock)) {
    await query('INSERT INTO inventory_balances (material_id, plant_id, on_hand) VALUES ($1,$2,$3)', [m, await plantId(plant), qty]);
  }
  return { id: m, code };
}

export async function stockOf(materialId: number, plant: string) {
  const r = await queryOne<{ on_hand: number }>('SELECT on_hand FROM inventory_balances WHERE material_id = $1 AND plant_id = $2',
    [materialId, await plantId(plant)]);
  return r?.on_hand ?? 0;
}

export const key = () => randomUUID();
