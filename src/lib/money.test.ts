import { describe, expect, it } from 'vitest';
import { parseDisplayDate, rupeesToPaise } from './api';

describe('rupeesToPaise', () => {
  it('rounds to whole paise without floating-point drift', () => {
    expect(rupeesToPaise(92.45)).toBe(9245);
    expect(rupeesToPaise(11144.85)).toBe(1114485);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
});

describe('parseDisplayDate', () => {
  it('turns a display date into ISO and rejects anything else', () => {
    expect(parseDisplayDate('04 Oct 2026')).toBe('2026-10-04');
    expect(parseDisplayDate('2026-10-04')).toBe('');
    expect(parseDisplayDate('—')).toBe('');
  });
});
