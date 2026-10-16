import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useApi, useDebounced } from '../../hooks/useApi';
import { api, qs } from '../../services/api';
import type { CompanyRow, Material, Page, Plant, RequirementRow, UserLite } from '../../types';
import { formatINR } from '../../utils/format';
import { Field, SelectField } from './Field';

/** Small in-memory cache for reference lists that rarely change during a session. */
const cache = new Map<string, Promise<unknown>>();
export function cached<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, api<T>(path).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path) as Promise<T>;
}
export const invalidateCache = (prefix: string) => {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
};

function useCached<T>(path: string) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cached<T>(path).then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [path]);
  return { data, error };
}

export const useUsers = () => useCached<{ items: UserLite[] }>('/users').data?.items;
export const usePlants = () => useCached<{ items: Plant[] }>('/plants').data?.items;

interface SelectProps {
  label: string; value: number | null; onChange: (v: number | null) => void; required?: boolean; error?: string | null;
  placeholder?: string; className?: string; disabled?: boolean;
}

export function UserSelect({ label, value, onChange, required, error, placeholder = '— Unassigned —', className, disabled }: SelectProps) {
  const users = useUsers();
  return (
    <SelectField label={label} required={required} error={error} className={className} disabled={disabled || !users}
      value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} placeholder={placeholder}
      options={(users ?? []).map((u) => ({ value: u.id, label: `${u.fullName}${u.roles.length ? ` (${u.roles.join(', ')})` : ''}` }))} />
  );
}

export function PlantSelect({ label, value, onChange, required, error, placeholder, className, disabled }: SelectProps) {
  const plants = usePlants();
  return (
    <SelectField label={label} required={required} error={error} className={className} disabled={disabled || !plants}
      value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} placeholder={placeholder}
      options={(plants ?? []).map((p) => ({ value: p.id, label: `${p.code} – ${p.name} (${p.plantNo})` }))} />
  );
}

export function CompanySelect({ type, ...p }: SelectProps & { type: 'Customer' | 'Vendor' }) {
  const { data } = useCached<Page<CompanyRow>>(`/companies${qs({ type, status: 'Active', pageSize: 200 })}`);
  return (
    <SelectField label={p.label} required={p.required} error={p.error} className={p.className} disabled={p.disabled || !data}
      value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value ? Number(e.target.value) : null)}
      placeholder={p.placeholder ?? `— Select ${type.toLowerCase()} —`}
      options={(data?.items ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
  );
}

export function RequirementSelect(p: SelectProps) {
  const { data } = useApi<Page<RequirementRow>>('/requirements?pageSize=200&sort=code');
  return (
    <SelectField label={p.label} required={p.required} error={p.error} className={p.className} disabled={p.disabled || !data}
      value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value ? Number(e.target.value) : null)} placeholder={p.placeholder ?? '— None —'}
      options={(data?.items ?? []).map((r) => ({ value: r.id, label: `${r.code} ${r.title}` }))} />
  );
}

/** Async material search combobox (ARIA 1.2 combobox pattern). */
export function MaterialPicker({ label, value, onChange, required, error, className }: {
  label: string; value: Material | null; onChange: (m: Material | null) => void; required?: boolean; error?: string | null; className?: string;
}) {
  const [text, setText] = useState(value ? value.code : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 250);
  const listId = useId();
  const { data, loading } = useApi<Page<Material>>(open && q.length >= 1 ? `/materials${qs({ q, pageSize: 12 })}` : null);
  const items = data?.items ?? [];
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(value ? value.code : ''); }, [value]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (m: Material) => { onChange(m); setText(m.code); setOpen(false); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <Field label={label} required={required} error={error} className={className}
      hint={value ? `${value.description} · cost ${formatINR(value.costPrice)} · list ${formatINR(value.listPrice)}` : 'Type a material code or name, e.g. ECHO01'}>
      {(p) => (
        <div className="combo" ref={wrap}>
          <input
            {...p} className="input" role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={open && items[active] ? `${listId}-${items[active].id}` : undefined} autoComplete="off"
            value={text} placeholder="Search materials…"
            onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); if (value) onChange(null); }}
            onFocus={() => setOpen(true)} onKeyDown={onKey}
          />
          {open && q.length >= 1 && (
            <ul className="combo-list" id={listId} role="listbox" aria-label={`${label} results`}>
              {loading && !items.length && <li aria-disabled="true" className="muted">Searching…</li>}
              {!loading && !items.length && <li aria-disabled="true" className="muted">No materials found</li>}
              {items.map((m, i) => (
                <li key={m.id} id={`${listId}-${m.id}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setActive(i)}>
                  <span className="code">{m.code}</span><span>{m.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
