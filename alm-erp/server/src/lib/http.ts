import type { Request } from 'express';
import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    throw badRequest(first ? `${first.path ? first.path + ': ' : ''}${first.message}` : 'Invalid request.', issues);
  }
  return result.data;
}

export const idParam = z.coerce.number().int().positive();
export function paramId(req: Request, name = 'id'): number {
  return parse(idParam, req.params[name]);
}

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function paging(query: unknown) {
  const { page, pageSize } = parse(pagingSchema, query);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Small helper to build parameterised WHERE clauses safely. */
export class Where {
  private parts: string[] = [];
  constructor(public params: unknown[] = []) {}
  add(sqlWithPlaceholder: string, ...values: unknown[]) {
    // Replace each '?' with the next positional parameter.
    let sql = sqlWithPlaceholder;
    for (const v of values) {
      this.params.push(v);
      sql = sql.replace('?', `$${this.params.length}`);
    }
    this.parts.push(sql);
    return this;
  }
  param(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  get sql() {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

export const optStr = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((s) => (s ? s : undefined));

/** Escape LIKE wildcards in user search input. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Convert snake_case column names to camelCase API fields (shallow; JSON columns are kept as-is). */
export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

export function camelAll<T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => camel<T>(r));
}

/** Build a page response from rows carrying a `total_count` window column. */
export function toPage<T>(rows: Record<string, unknown>[], page: number, pageSize: number): Page<T> {
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count: _t, ...r }) => camel<T>(r)),
    total,
    page,
    pageSize,
  };
}

/** Map a client sort key (optionally prefixed with '-') to an allow-listed ORDER BY clause. */
export function orderBy(raw: unknown, allowed: Record<string, string>, fallback: string): string {
  if (typeof raw !== 'string' || !raw) return fallback;
  const desc = raw.startsWith('-');
  const col = allowed[desc ? raw.slice(1) : raw];
  return col ? `${col} ${desc ? 'DESC' : 'ASC'} NULLS LAST` : fallback;
}
