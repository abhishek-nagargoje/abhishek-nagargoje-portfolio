import { useRef, type KeyboardEvent } from 'react';

export interface TabDef { id: string; label: string; count?: number }

/** Accessible tab list (arrow-key navigation, roving tabindex). Panels are rendered by the caller. */
export function Tabs({ tabs, value, onChange, label, className = 'tabs', tabClass = 'tab' }: {
  tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; className?: string; tabClass?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n].id);
  };
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={t.id === value}
          aria-controls={`panel-${t.id}`} tabIndex={t.id === value ? 0 : -1} className={tabClass}
          onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}{t.count !== undefined && <span className="count">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
