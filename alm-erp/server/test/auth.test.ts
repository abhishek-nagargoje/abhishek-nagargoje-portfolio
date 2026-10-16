import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db/pool.js';
import { app, Client, createUser, PASSWORD } from './helpers.js';

describe('authentication', () => {
  it('rejects unauthenticated access to protected APIs', async () => {
    const res = await request(app).get('/api/requirements');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects incorrect credentials with a generic message', async () => {
    const u = await createUser(['PM']);
    const wrong = await request(app).post('/api/auth/login').send({ email: u.email, password: 'nope-nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@test.example', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('logs in with correct credentials and issues an HttpOnly, SameSite cookie', async () => {
    const u = await createUser(['PM']);
    const res = await request(app).post('/api/auth/login').send({ email: u.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(u.email);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it('restores the session and returns the CSRF token', async () => {
    const c = await Client.as(['PM']);
    const res = await c.get('/auth/session');
    expect(res.body.user.id).toBe(c.user.id);
    expect(res.body.csrfToken).toBe(c.csrf);
  });

  it('requires the CSRF token for state-changing requests', async () => {
    const c = await Client.as(['PM']);
    const res = await c.agent.post('/api/requirements').send({ title: 'No token' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects cross-origin state-changing requests', async () => {
    const c = await Client.as(['PM']);
    const res = await c.agent.post('/api/requirements').set('Origin', 'https://evil.example').set('X-CSRF-Token', c.csrf).send({ title: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_REJECTED');
  });

  it('invalidates the session on logout', async () => {
    const c = await Client.as(['PM']);
    expect((await c.get('/requirements')).status).toBe(200);
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect((await c.get('/requirements')).status).toBe(401);
  });

  it('treats expired sessions as unauthenticated', async () => {
    const c = await Client.as(['PM']);
    await query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [c.user.id]);
    expect((await c.get('/requirements')).status).toBe(401);
    expect((await c.get('/auth/session')).body.user).toBeNull();
  });

  it('locks the account after repeated failures', async () => {
    const u = await createUser(['PM']);
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: u.email, password: 'bad-password' });
    const res = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(429);
    const sec = await queryOne<{ n: number }>(
      "SELECT count(*)::int AS n FROM activity_log WHERE category = 'security' AND action = 'login_failed' AND entity_id = $1", [u.id]);
    expect(sec!.n).toBe(5);
  });

  it('accounts without a password cannot sign in', async () => {
    const row = await queryOne<{ email: string }>("SELECT email FROM users WHERE is_sample LIMIT 1");
    const res = await request(app).post('/api/auth/login').send({ email: row!.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('changes the password, revoking existing sessions', async () => {
    const u = await createUser(['PM']);
    const c = await Client.login(u.email);
    const other = await Client.login(u.email);
    expect((await c.post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'N3w-Password!' })).status).toBe(400);
    expect((await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    const ok = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'N3w-Password!' });
    expect(ok.status).toBe(200);
    expect((await other.get('/requirements')).status).toBe(401);
    expect((await Client.login(u.email, 'N3w-Password!')).user.id).toBe(u.id);
  });

  it('forces a password change before other access when required', async () => {
    const u = await createUser(['PM'], { mustChange: true });
    const c = await Client.login(u.email);
    const res = await c.get('/requirements');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Changed-Pass1' });
    const c2 = await Client.login(u.email, 'Changed-Pass1');
    expect((await c2.get('/requirements')).status).toBe(200);
  });
});

describe('authorization', () => {
  it('restricts administrative operations', async () => {
    const pm = await Client.as(['PM']);
    expect((await pm.get('/admin/users')).status).toBe(403);
    expect((await pm.put('/admin/settings/po_approval_threshold', { value: '1.00' })).status).toBe(403);
    expect((await pm.get('/activity?category=security')).status).toBe(403);
  });

  it('lets administrators create users who must change their temporary password', async () => {
    const admin = await Client.as(['ADMIN']);
    const email = `new-${Date.now()}@test.example`;
    const res = await admin.post('/admin/users', { email, fullName: 'New Tester', roles: ['TESTER'], temporaryPassword: 'Temp-Passw0rd' });
    expect(res.status).toBe(201);
    const c = await Client.login(email, 'Temp-Passw0rd');
    expect((await c.get('/tasks')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await admin.post('/admin/users', { email, fullName: 'Dup', roles: ['TESTER'], temporaryPassword: 'Temp-Passw0rd' })).status).toBe(409);
  });

  it('applies role changes immediately by revoking sessions', async () => {
    const admin = await Client.as(['ADMIN']);
    const u = await createUser(['TESTER']);
    const c = await Client.login(u.email);
    expect((await admin.patch(`/admin/users/${u.id}`, { roles: ['BU'] })).status).toBe(204);
    expect((await c.get('/tasks')).status).toBe(401);
    expect((await Client.login(u.email)).user.permissions).toContain('req.signoff');
  });

  it('keeps notifications private to their owner', async () => {
    const a = await Client.as(['PM']);
    const b = await Client.as(['PM']);
    const n = await queryOne<{ id: number }>(
      "INSERT INTO notifications (user_id, message) VALUES ($1, 'private') RETURNING id", [a.user.id]);
    expect((await b.get('/notifications')).body.items.some((x: { id: number }) => x.id === n!.id)).toBe(false);
    expect((await b.post(`/notifications/${n!.id}/read`)).status).toBe(404);
    expect((await a.post(`/notifications/${n!.id}/read`)).status).toBe(204);
  });

  it('hides sensitive company details from roles without access', async () => {
    const tester = await Client.as(['TESTER']);
    const sales = await Client.as(['SALES']);
    const t = await tester.get('/companies?q=C1000');
    const s = await sales.get('/companies?q=C1000');
    expect(t.body.items[0].contactName).toBeNull();
    expect(t.body.items[0].restricted).toBe(true);
    expect(s.body.items[0].contactName).toBeTruthy();
  });
});
