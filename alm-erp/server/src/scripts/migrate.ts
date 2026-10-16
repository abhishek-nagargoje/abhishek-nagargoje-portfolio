import { closePool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

const applied = await migrate((m) => console.log(m));
console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database schema is up to date.');
await closePool();
