import { describe, expect, it } from 'vitest';
import { toApiLines } from '../components/common/LineItems';
import type { Material } from '../types';
import { formatINR, formatINRCompact, initials } from './format';
import { REQUIREMENT_NEXT, toneOf } from './status';

const mat = { id: 1, code: 'ECHO01', description: 'x', category: 'c', uom: 'EA', costPrice: '3200.00', listPrice: '4999.00', isSample: true } satisfies Material;

describe('formatting', () => {
  it('formats rupees in the Indian numbering system', () => {
    expect(formatINR('1234567.5')).toBe('₹12,34,567.50');
    expect(formatINR(null)).toBe('—');
    expect(formatINRCompact('2560000')).toBe('₹25.60 L');
    expect(formatINRCompact('123456789')).toBe('₹12.35 Cr');
  });
  it('derives initials', () => expect(initials('Training Administrator')).toBe('TA'));
});

describe('status helpers', () => {
  it('maps statuses to semantic tones', () => {
    expect(toneOf('Failed')).toBe('negative');
    expect(toneOf('Pending Approval')).toBe('critical');
    expect(toneOf('Passed')).toBe('positive');
    expect(toneOf('Something else')).toBe('neutral');
  });
  it('only offers sign-off from In Test', () => {
    expect(REQUIREMENT_NEXT['In Test']).toContain('Approved');
    expect(REQUIREMENT_NEXT.New).not.toContain('Approved');
  });
});

describe('line item validation', () => {
  it('rejects missing materials, fractional quantities and malformed prices', () => {
    const r = toApiLines([
      { material: null, quantity: '1', unitPrice: '' },
      { material: mat, quantity: '1.5', unitPrice: '' },
      { material: mat, quantity: '2', unitPrice: '10.123' },
      { material: mat, quantity: '3', unitPrice: '99.50' },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/material/);
    expect(r.errors[1]).toMatch(/whole quantity/);
    expect(r.errors[2]).toMatch(/two decimals/);
    expect(r.errors[3]).toBeNull();
    expect(r.items[3]).toEqual({ materialId: 1, quantity: 3, unitPrice: '99.50' });
  });
});
