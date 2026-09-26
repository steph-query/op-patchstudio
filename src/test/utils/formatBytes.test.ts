import { describe, it, expect } from 'vitest';
import { formatBytes, formatGigabytes } from '../../utils/formatBytes';

describe('formatBytes', () => {
  it('climbs into gigabytes, unlike the builder formatter', () => {
    expect(formatBytes(0)).toBe('0 b');
    expect(formatBytes(900)).toBe('900 b');
    expect(formatBytes(1024)).toBe('1.0 kb');
    expect(formatBytes(1024 ** 2)).toBe('1.0 mb');
    expect(formatBytes(1024 ** 3)).toBe('1.00 gb');
    expect(formatBytes(4_000_000_000)).toBe('3.73 gb');
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.00 gb');
  });

  it('refuses to print nonsense for a missing or negative value', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatGigabytes', () => {
  it('reports gigabytes for comparing use against capacity', () => {
    expect(formatGigabytes(8 * 1024 ** 3)).toBe('8.00');
    expect(formatGigabytes(0)).toBe('0.00');
    expect(formatGigabytes(Number.NaN)).toBe('—');
  });
});
