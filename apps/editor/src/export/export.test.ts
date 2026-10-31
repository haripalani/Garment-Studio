import { describe, expect, it } from 'vitest';
import { createDevTee, createDoc, createShapeLayer, createTextLayer } from '@gs/core';
import { formatDuration } from '../render/download';
import { crc32, pngDpi, pngSize, pngWithDpi } from './png';
import { printTargets } from './printFiles';

/** Smallest valid PNG: 1×1 RGBA, IHDR + IDAT + IEND. */
const TINY = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

describe('PNG print metadata', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('writes a pHYs chunk after IHDR, readable as the DPI', () => {
    expect(pngDpi(TINY)).toBeNull();
    const out = pngWithDpi(TINY, 300);
    expect(pngDpi(out)).toBe(300);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs'); // 8 sig + 25 IHDR + 4 length
    expect(out.length).toBe(TINY.length + 21);
    expect(pngSize(out)).toEqual({ width: 1, height: 1 });
  });

  it('replaces an existing pHYs instead of adding a second', () => {
    const twice = pngWithDpi(pngWithDpi(TINY, 150), 300);
    expect(pngDpi(twice)).toBe(300);
    expect(twice.length).toBe(TINY.length + 21);
  });

  it('rejects non-PNG data', () => {
    expect(() => pngWithDpi(new Uint8Array(20), 300)).toThrow('Not a PNG');
  });
});

describe('print targets', () => {
  const g = createDevTee();
  it('lists only piece sides with visible artwork, including artwork wrapped over a seam', () => {
    const doc = createDoc(g.id, g.version);
    expect(printTargets(g, doc)).toEqual([]);
    doc.layers.push(createTextLayer({ pieceId: 'back', side: 'outside', x: 260, y: 200, w: 200, h: 60 }));
    doc.layers.push(createTextLayer({ pieceId: 'front', side: 'inside', x: 260, y: 200, w: 200, h: 60 }));
    expect(printTargets(g, doc)).toEqual([
      { pieceId: 'back', side: 'outside' },
      { pieceId: 'front', side: 'inside' },
    ]);
    const hidden = { ...createShapeLayer({ pieceId: 'sleeveL', side: 'outside', x: 50, y: 50, w: 20, h: 20 }, 'rect'), visible: false };
    doc.layers.push(hidden);
    expect(printTargets(g, doc)).toHaveLength(2);
  });
});

describe('durations', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(400)).toBe('1 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(200_400)).toBe('3 min 20 s');
  });
});
