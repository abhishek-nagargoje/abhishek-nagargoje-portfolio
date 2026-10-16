import { Plus, Trash2 } from 'lucide-react';
import type { Material } from '../../types';
import { formatINR } from '../../utils/format';
import { Button } from './Button';
import { TextField } from './Field';
import { MaterialPicker } from './Pickers';

export interface Line { material: Material | null; quantity: string; unitPrice: string }
export const emptyLine = (): Line => ({ material: null, quantity: '', unitPrice: '' });

/** Line-item editor. Amounts shown here are previews; the server computes the authoritative totals. */
export function LineItems({ lines, onChange, priceField, priceHint, errors }: {
  lines: Line[]; onChange: (l: Line[]) => void; priceField: 'costPrice' | 'listPrice'; priceHint: string; errors?: (string | null)[];
}) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {lines.map((l, i) => {
        const price = l.unitPrice || l.material?.[priceField] || '';
        const preview = l.material && Number(l.quantity) > 0 && price ? Number(l.quantity) * Number(price) : null;
        return (
          <fieldset key={i} className="form-grid" style={{ border: '1px solid var(--c-divider)', borderRadius: 4, padding: 12, margin: 0 }}>
            <legend className="muted small">Item {i + 1}</legend>
            <MaterialPicker label="Material" required value={l.material} onChange={(m) => set(i, { material: m })} className="full" error={errors?.[i]} />
            <TextField label="Quantity" required type="number" min={1} step={1} inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            <TextField label="Unit price (₹)" type="number" min={0} step="0.01" inputMode="decimal" value={l.unitPrice}
              placeholder={l.material ? l.material[priceField] : ''} hint={priceHint} onChange={(e) => set(i, { unitPrice: e.target.value })} />
            <div className="field"><span className="field-label">Net (preview)</span><span style={{ lineHeight: '36px' }}>{preview === null ? '—' : formatINR(preview)}</span></div>
            {lines.length > 1 && (
              <div style={{ alignSelf: 'end' }}><Button size="sm" variant="transparent" icon={<Trash2 size={14} />} onClick={() => onChange(lines.filter((_, j) => j !== i))}>Remove</Button></div>
            )}
          </fieldset>
        );
      })}
      <div><Button size="sm" variant="transparent" icon={<Plus size={14} />} onClick={() => onChange([...lines, emptyLine()])}>Add item</Button></div>
    </div>
  );
}

/** Validate line input and convert to the API shape; returns per-line errors. */
export function toApiLines(lines: Line[]) {
  const errors = lines.map((l) => {
    if (!l.material) return 'Select a material.';
    if (!/^\d+$/.test(l.quantity) || Number(l.quantity) <= 0) return 'Enter a whole quantity greater than 0.';
    if (l.unitPrice && !/^\d{1,13}(\.\d{1,2})?$/.test(l.unitPrice)) return 'Unit price must be an amount with up to two decimals.';
    return null;
  });
  return {
    errors,
    valid: errors.every((e) => !e),
    items: lines.map((l) => ({ materialId: l.material?.id, quantity: Number(l.quantity), ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}) })),
  };
}
