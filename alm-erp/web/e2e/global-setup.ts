import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USERS } from './users';

/** Wipe and seed the disposable E2E database; the password is random per run and never stored. */
export default function globalSetup() {
  process.env.E2E_PASSWORD = `E2e-${randomBytes(12).toString('base64url')}!`;
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server');
  execFileSync('node', ['--import', 'tsx', 'src/scripts/e2e-reset.ts'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, NODE_ENV: 'test', E2E_USERS: JSON.stringify(Object.values(USERS)) },
  });
}
