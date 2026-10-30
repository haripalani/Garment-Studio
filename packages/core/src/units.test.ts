import { describe, expect, it } from 'vitest';
import { defaultUnitForLocale, formatLength, fromMm, parseLength, toMm } from './units';

describe('units', () => {
  it('round-trips through every unit', () => {
    for (const u of ['mm', 'cm', 'in'] as const) {
      expect(toMm(fromMm(530, u), u)).toBeCloseTo(530, 10);
    }
  });

  it('formats with unit-specific precision', () => {
    expect(formatLength(530, 'cm')).toBe('53.0 cm');
    expect(formatLength(530, 'mm')).toBe('530 mm');
    expect(formatLength(254, 'in')).toBe('10.00 in');
    expect(formatLength(254, 'in', false)).toBe('10.00');
  });

  it('parses user input in the current or an explicit unit', () => {
    expect(parseLength('12,5', 'cm')).toBe(125);
    expect(parseLength('12.5 cm', 'mm')).toBe(125);
    expect(parseLength('1in', 'cm')).toBeCloseTo(25.4);
    expect(parseLength(' 40 ', 'mm')).toBe(40);
    expect(parseLength('abc', 'cm')).toBeNull();
    expect(parseLength('', 'cm')).toBeNull();
  });

  it('picks inches only for imperial locales', () => {
    expect(defaultUnitForLocale('en-US')).toBe('in');
    expect(defaultUnitForLocale('en-GB')).toBe('cm');
    expect(defaultUnitForLocale('fr-FR')).toBe('cm');
  });
});
