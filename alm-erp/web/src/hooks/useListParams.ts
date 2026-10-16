import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs } from '../services/api';

/**
 * List state (filters, page, sort) kept in the URL so views are shareable,
 * survive refresh and can be linked from dashboards.
 */
export function useListParams<K extends string>(keys: readonly K[], defaults: Partial<Record<K | 'page' | 'sort', string>> = {}) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const v = {} as Record<K | 'page' | 'sort', string>;
    for (const k of [...keys, 'page', 'sort'] as (K | 'page' | 'sort')[]) v[k] = params.get(k) ?? defaults[k] ?? '';
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback((patch: Partial<Record<K | 'page' | 'sort', string>>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
        if (v) next.set(k, v); else next.delete(k);
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const page = Number(values.page) || 1;
  const query = (extra: Record<string, string | number | undefined> = {}) =>
    qs({ ...Object.fromEntries(keys.map((k) => [k, values[k]])), page, sort: values.sort, pageSize: 25, ...extra });
  return { values, set, page, setPage: (p: number) => set({ page: String(p) } as Partial<Record<K | 'page' | 'sort', string>>), query };
}
