// All geometry is stored in millimetres (ADR-0008). Units only affect display and input.
export type Unit = 'mm' | 'cm' | 'in';

export const UNITS: readonly Unit[] = ['mm', 'cm', 'in'];

const MM_PER: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 };

/** Decimal places shown for a value in each unit. */
export const UNIT_DECIMALS: Record<Unit, number> = { mm: 0, cm: 1, in: 2 };

export function fromMm(mm: number, unit: Unit): number {
  return mm / MM_PER[unit];
}

export function toMm(value: number, unit: Unit): number {
  return value * MM_PER[unit];
}

export function formatLength(mm: number, unit: Unit, withUnit = true): string {
  const v = fromMm(mm, unit).toFixed(UNIT_DECIMALS[unit]);
  return withUnit ? `${v} ${unit}` : v;
}

/** Parse user input like "12,5", "12.5 cm", "3in". Returns millimetres, or null if not a number. */
export function parseLength(input: string, unit: Unit): number | null {
  const m = input
    .trim()
    .replace(',', '.')
    .match(/^(-?\d*\.?\d+)\s*(mm|cm|in)?$/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = (m[2]?.toLowerCase() as Unit | undefined) ?? unit;
  return toMm(n, u);
}

export function defaultUnitForLocale(locale: string): Unit {
  return /^en-(US|LR|MM)$/i.test(locale) ? 'in' : 'cm';
}
