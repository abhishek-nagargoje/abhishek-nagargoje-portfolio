import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// When compiled, this file lives in dist/src; step back out of dist.
export const packageRoot = path.basename(serverRoot) === 'dist' ? path.resolve(serverRoot, '..') : serverRoot;

const envFile = path.join(packageRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Environment variable ${name} must be a positive integer`);
  return n;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: int('PORT', 4000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  serveWeb: process.env.SERVE_WEB === 'true',
  sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 480),
  sessionAbsoluteMinutes: int('SESSION_ABSOLUTE_MINUTES', 10080),
  // Trust X-Forwarded-For only when explicitly configured behind a proxy.
  trustProxy: process.env.TRUST_PROXY === 'true',
  webDist: path.resolve(packageRoot, '..', 'web', 'dist'),
  migrationsDir: path.join(packageRoot, 'migrations'),
};

export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to server/.env and configure it.');
  return config.databaseUrl;
}
