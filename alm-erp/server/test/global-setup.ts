import pg from 'pg';

/** Recreate the test database schema from migrations and load sample data. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  const { migrate } = await import('../src/db/migrate.js');
  const { seedSampleData } = await import('../src/db/sample-data.js');
  const { closePool } = await import('../src/db/pool.js');
  await migrate();
  await seedSampleData();
  await closePool();
}
