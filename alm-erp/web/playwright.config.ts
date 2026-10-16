import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('../server/.env')) process.loadEnvFile('../server/.env');
const db = process.env.E2E_DATABASE_URL;
if (!db) throw new Error('Set E2E_DATABASE_URL to a disposable database (it is wiped by the browser tests).');
const PORT = 4100;
// Use a pre-installed Chromium when provided (e.g. CI images); otherwise Playwright's own download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  webServer: {
    command: 'node --import tsx src/index.ts',
    cwd: '../server',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: db, PORT: String(PORT), SERVE_WEB: 'true', NODE_ENV: 'test', LOG_LEVEL: 'error' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1067 } }, testIgnore: /responsive/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
});
