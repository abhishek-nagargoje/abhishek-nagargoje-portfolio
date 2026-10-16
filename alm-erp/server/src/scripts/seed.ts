/** Development seed: pnpm db:seed (idempotent; loads sample data only). */
import { migrate } from '../db/migrate.js';
import { closePool } from '../db/pool.js';
import { seedSampleData } from '../db/sample-data.js';

await migrate((m) => console.log(m));
const { stockPosted } = await seedSampleData();
console.log(`Sample data ready (${stockPosted ? 'opening stock posted' : 'opening stock already present'}).`);
await closePool();
