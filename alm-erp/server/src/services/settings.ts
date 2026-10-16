import { z } from 'zod';
import { queryOne, type Db, getPool } from '../db/pool.js';
import { isMoney } from '../lib/money.js';

export const settingSchemas = {
  po_approval_threshold: z.string().refine(isMoney, 'Must be an amount with up to two decimals'),
  gst_rate_bp: z.number().int().min(0).max(5000),
  allow_self_approval: z.boolean(),
  po_stuck_after_hours: z.number().int().min(1).max(24 * 90),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export async function getSetting<K extends SettingKey>(key: K, db: Db = getPool()): Promise<SettingValue<K>> {
  const row = await queryOne<{ value: unknown }>('SELECT value FROM app_settings WHERE key = $1', [key], db);
  if (!row) throw new Error(`Missing configuration setting ${key}`);
  return settingSchemas[key].parse(row.value) as SettingValue<K>;
}
