const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');

/** Display formatting only – authoritative amounts are computed by the server. */
export const formatINR = (amount: string | number | null | undefined, whole = false) =>
  amount === null || amount === undefined || amount === '' ? '—' : (whole ? inr0 : inrFmt).format(Number(amount));
export const formatNumber = (n: number | string | null | undefined) => (n === null || n === undefined ? '—' : num.format(Number(n)));

/** Compact INR for KPI tiles: ₹12.4 L, ₹3.2 Cr. */
export function formatINRCompact(amount: string | number): string {
  const n = Number(amount);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inr0.format(n);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatDate = (s: string | null | undefined) => (s ? dateFmt.format(new Date(s.length === 10 ? `${s}T00:00:00` : s)) : '—');
export const formatDateTime = (s: string | null | undefined) => (s ? dateTimeFmt.format(new Date(s)) : '—');

export function timeAgo(s: string): string {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(s);
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export const todayISO = () => new Date().toISOString().slice(0, 10);
