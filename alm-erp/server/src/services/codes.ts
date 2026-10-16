import type { Db } from '../db/pool.js';
import { queryOne } from '../db/pool.js';

const SEQ = {
  REQ: 'requirement_code_seq',
  TSK: 'task_code_seq',
  TC: 'test_case_code_seq',
  DEF: 'defect_code_seq',
  INC: 'incident_code_seq',
} as const;

export async function nextCode(db: Db, prefix: keyof typeof SEQ): Promise<string> {
  const row = await queryOne<{ n: number }>(`SELECT nextval('${SEQ[prefix]}') AS n`, [], db);
  return `${prefix}-${String(row!.n).padStart(3, '0')}`;
}
