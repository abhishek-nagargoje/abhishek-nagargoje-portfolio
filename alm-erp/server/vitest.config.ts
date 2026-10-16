import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error('TEST_DATABASE_URL must be set to a dedicated, disposable test database.');
if (testDb === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL – the tests wipe it.');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: { DATABASE_URL: testDb, NODE_ENV: 'test', LOG_LEVEL: 'error' },
    // All test files share one database; run them sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
