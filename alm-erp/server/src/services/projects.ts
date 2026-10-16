import { queryOne, type Db } from '../db/pool.js';
import { notFound } from '../lib/errors.js';

/** Resolve the project for a new record (defaults to the first project). */
export async function resolveProjectId(db: Db, projectId?: number): Promise<number> {
  const row = projectId
    ? await queryOne<{ id: number }>('SELECT id FROM projects WHERE id = $1', [projectId], db)
    : await queryOne<{ id: number }>('SELECT id FROM projects ORDER BY id LIMIT 1', [], db);
  if (!row) throw notFound('Project');
  return row.id;
}

export async function assertUserExists(db: Db, userId: number | null | undefined) {
  if (userId == null) return;
  const row = await queryOne('SELECT 1 FROM users WHERE id = $1 AND is_active', [userId], db);
  if (!row) throw notFound('Assignee');
}
