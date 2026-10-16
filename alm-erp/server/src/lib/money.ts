/**
 * Decimal-safe money arithmetic using integer paise (BigInt).
 * Values cross the API and database boundary as strings with two decimals.
 */
const MONEY_RE = /^\d{1,13}(\.\d{1,2})?$/;

export function isMoney(s: string): boolean {
  return MONEY_RE.test(s);
}

export function toPaise(s: string | number): bigint {
  const str = typeof s === 'number' ? s.toFixed(2) : s.trim();
  if (!MONEY_RE.test(str)) throw new Error(`Invalid money amount: ${s}`);
  const [int, frac = ''] = str.split('.');
  return BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
}

export function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export function lineAmount(quantity: number, unitPrice: string): bigint {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive integer');
  return BigInt(quantity) * toPaise(unitPrice);
}

/** Tax for a net amount at a rate in basis points, rounded half-up to the paisa. */
export function taxAmount(netPaise: bigint, rateBp: number): bigint {
  return (netPaise * BigInt(rateBp) + 5000n) / 10000n;
}

export function totals(lines: { quantity: number; unitPrice: string }[], rateBp: number) {
  const net = lines.reduce((sum, l) => sum + lineAmount(l.quantity, l.unitPrice), 0n);
  const tax = taxAmount(net, rateBp);
  return { net, tax, total: net + tax };
}
