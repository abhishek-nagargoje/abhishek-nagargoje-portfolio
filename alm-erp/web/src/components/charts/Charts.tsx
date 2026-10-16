import { formatNumber } from '../../utils/format';

export interface Datum { label: string; value: number; color?: string }

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'];
export const STATUS_COLORS: Record<string, string> = {
  Open: 'var(--chart-neutral)', New: 'var(--chart-neutral)', Draft: 'var(--chart-neutral)', Initial: 'var(--chart-neutral)',
  Ready: 'var(--chart-1)', 'Fit-to-Standard': 'var(--chart-1)', 'In Realization': 'var(--chart-warn)', 'In Test': 'var(--chart-6)',
  'In Progress': 'var(--chart-warn)', 'In Execution': 'var(--chart-warn)', 'In Process': 'var(--chart-warn)', Fixed: 'var(--chart-6)',
  Retest: 'var(--chart-5)', Blocked: 'var(--chart-bad)', Failed: 'var(--chart-bad)', Rejected: 'var(--chart-bad)', Critical: 'var(--chart-bad)',
  High: 'var(--chart-warn)', Medium: 'var(--chart-1)', Low: 'var(--chart-neutral)',
  Done: 'var(--chart-good)', Passed: 'var(--chart-good)', Approved: 'var(--chart-good)', Closed: 'var(--chart-good)',
};
export const colorFor = (label: string, i: number) => STATUS_COLORS[label] ?? PALETTE[i % PALETTE.length];

const describe = (title: string, data: Datum[]) => `${title}: ${data.map((d) => `${d.label} ${formatNumber(d.value)}`).join(', ')}`;

/** Vertical column chart with value labels above each column (as in the "Tasks" overview card). */
export function ColumnChart({ title, data, height = 180 }: { title: string; data: Datum[]; height?: number }) {
  const w = Math.max(240, data.length * 80);
  const max = Math.max(1, ...data.map((d) => d.value));
  const plotH = height - 40;
  const colW = Math.min(52, (w / data.length) * 0.6);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={describe(title, data)}>
        <line x1="0" x2={w} y1={plotH + 16} y2={plotH + 16} stroke="var(--chart-grid)" />
        {data.map((d, i) => {
          const cx = (w / data.length) * (i + 0.5);
          const h = (d.value / max) * plotH;
          const y = plotH + 16 - h;
          return (
            <g key={d.label}>
              <rect x={cx - colW / 2} y={y} width={colW} height={Math.max(h, d.value ? 2 : 0)} fill={d.color ?? colorFor(d.label, i)} />
              <text className="value-label" x={cx} y={y - 4} textAnchor="middle">{formatNumber(d.value)}</text>
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="12">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Horizontal bars with category labels (as in "Requirements per Workstream" / "Requirement Statuses"). */
export function BarList({ title, data, format = formatNumber, max: fixedMax }: { title: string; data: Datum[]; format?: (n: number) => string; max?: number }) {
  const max = fixedMax ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={describe(title, data)}>
      {data.map((d, i) => (
        <div className="hbar" key={d.label} aria-hidden>
          <span className="label" title={d.label}>{d.label}</span>
          <span className="track"><span className="fill" style={{ display: 'block', width: `${(d.value / max) * 100}%`, background: d.color ?? colorFor(d.label, i) }} /></span>
          <span className="val">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Single stacked bar with in-segment values (as in "Overall Task Progress"). */
export function StackedBar({ title, data }: { title: string; data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div className="stacked-bar" role="img" aria-label={describe(title, data)}>
        {total === 0 ? null : data.filter((d) => d.value > 0).map((d, i) => (
          <span key={d.label} style={{ width: `${(d.value / total) * 100}%`, background: d.color ?? colorFor(d.label, i) }} title={`${d.label}: ${d.value}`}>
            {(d.value / total) > 0.06 ? formatNumber(d.value) : ''}
          </span>
        ))}
      </div>
      <Legend data={data} />
    </div>
  );
}

export function Legend({ data }: { data: Datum[] }) {
  return (
    <div className="legend" aria-hidden>
      {data.map((d, i) => <span key={d.label}><i style={{ background: d.color ?? colorFor(d.label, i) }} />{d.label}</span>)}
    </div>
  );
}

/** Donut with legend (as in "Requirements and Notes"). */
export function Donut({ title, data, size = 140, showValues = true }: { title: string; data: Datum[]; size?: number; showValues?: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = 36, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={describe(title, data)} style={{ flex: 'none' }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--chart-grid)" strokeWidth="18" />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = <circle key={d.label} cx="50" cy="50" r={r} fill="none" stroke={d.color ?? colorFor(d.label, i)} strokeWidth="18"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
          offset += len;
          return el;
        })}
        <text x="50" y="54" textAnchor="middle" fontSize="12" style={{ fill: 'var(--c-text)' }}>{formatNumber(total)}</text>
      </svg>
      <div className="legend" aria-hidden>
        {data.map((d, i) => (
          <span key={d.label}><i style={{ background: d.color ?? colorFor(d.label, i) }} />{d.label}{showValues ? `: ${formatNumber(d.value)}` : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Stacked column time series (as in the monitoring dashboard reference). */
export function StackedColumns({ title, categories, series, height = 220 }: {
  title: string; categories: string[]; series: { label: string; values: number[]; color: string }[]; height?: number;
}) {
  const w = Math.max(320, categories.length * 46);
  const totals = categories.map((_, i) => series.reduce((s, x) => s + x.values[i], 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const left = 32, bottom = 24, plotH = height - bottom - 8, plotW = w - left - 4;
  const colW = (plotW / categories.length) * 0.62;
  const summary = `${title}: ${categories.map((c, i) => `${c} ${totals[i]}`).join(', ')}`;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={summary}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / top) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={w} y1={y} y2={y} stroke="var(--chart-grid)" />
              <text x={left - 6} y={y + 4} textAnchor="end" fontSize="11">{t}</text>
            </g>
          );
        })}
        {categories.map((cat, i) => {
          const cx = left + (plotW / categories.length) * (i + 0.5);
          let acc = 0;
          return (
            <g key={cat}>
              {series.map((s) => {
                const v = s.values[i];
                if (!v) return null;
                const h = (v / top) * plotH;
                const y = 8 + plotH - ((acc + v) / top) * plotH;
                acc += v;
                return <rect key={s.label} x={cx - colW / 2} y={y} width={colW} height={h} fill={s.color}><title>{`${cat} · ${s.label}: ${v}`}</title></rect>;
              })}
              {totals[i] > 0 && <text className="value-label" x={cx} y={8 + plotH - (totals[i] / top) * plotH - 4} textAnchor="middle">{totals[i]}</text>}
              {(i % Math.ceil(categories.length / 14) === 0) && <text x={cx} y={height - 6} textAnchor="middle" fontSize="11">{cat}</text>}
            </g>
          );
        })}
      </svg>
      <Legend data={series.map((s) => ({ label: s.label, value: 0, color: s.color }))} />
    </figure>
  );
}

function niceTicks(max: number): number[] {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
  const out: number[] = [];
  for (let t = 0; t <= max + step - 1 && out.length < 12; t += step) out.push(t);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
