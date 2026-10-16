import { toneOf } from '../../utils/status';

/** Fiori ObjectStatus: coloured text, or a filled "inverted" label. */
export function Status({ value, inverted, tone }: { value: string; inverted?: boolean; tone?: ReturnType<typeof toneOf> }) {
  return <span className={`status ${tone ?? toneOf(value)} ${inverted ? 'inverted' : ''}`}>{value}</span>;
}

export function Priority({ value }: { value: string }) {
  return <span className={`prio p-${value.toLowerCase().replace(/\s+/g, '-')}`}>{value}</span>;
}

export function SampleFlag({ show, label = 'Sample' }: { show: boolean; label?: string }) {
  return show ? <span className="sample-flag" title="Sample data loaded by the development seed – not an operational record">{label}</span> : null;
}
