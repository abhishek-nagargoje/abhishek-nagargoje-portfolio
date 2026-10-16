import type { Request, Response } from 'express';
import type pg from 'pg';
import { withTransaction, queryOne } from '../db/pool.js';
import { badRequest, conflict } from '../lib/errors.js';

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Run a state-changing transaction with optional Idempotency-Key support.
 * The key is claimed inside the same transaction as the business change, so a
 * replay either sees the committed response or blocks until the first attempt finishes.
 */
export async function idempotentTransaction(
  req: Request,
  res: Response,
  endpoint: string,
  fn: (client: pg.PoolClient) => Promise<{ status: number; body: unknown }>,
) {
  const key = req.header('Idempotency-Key');
  const userId = req.auth!.user.id;
  if (key !== undefined && !KEY_RE.test(key)) throw badRequest('Idempotency-Key header is malformed.');

  const result = await withTransaction(async (client) => {
    if (key) {
      // Serialises concurrent requests with the same key for this user.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${userId}:${key}`]);
      const prior = await queryOne<{ endpoint: string; status_code: number; response: unknown }>(
        'SELECT endpoint, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2',
        [userId, key],
        client,
      );
      if (prior) {
        if (prior.endpoint !== endpoint) throw conflict('Idempotency-Key was already used for a different operation.');
        return { status: prior.status_code, body: prior.response, replayed: true };
      }
    }
    const out = await fn(client);
    if (key) {
      await client.query(
        'INSERT INTO idempotency_keys (user_id, key, endpoint, status_code, response) VALUES ($1,$2,$3,$4,$5)',
        [userId, key, endpoint, out.status, JSON.stringify(out.body)],
      );
    }
    return { ...out, replayed: false };
  });
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(result.status).json(result.body);
}
