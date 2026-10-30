import { describe, expect, it } from 'vitest';
import { apply, createDevTee, createShapeLayer, pointInPolygon, type Vec } from '@gs/core';
import {
  adjustPixels,
  fitView,
  frameFor,
  hitLayer,
  layerCorners,
  pieceAt,
  pieceFrames,
  reparent,
  seamLinks,
  sheetBounds,
  toScreen,
  toSheet,
  trimBounds,
  zoomAt,
} from './index';

const g = createDevTee();

const near = (a: Vec, b: Vec, d = 4) => {
  expect(a[0]).toBeCloseTo(b[0], d);
  expect(a[1]).toBeCloseTo(b[1], d);
};

describe('view', () => {
  it('round-trips sheet and screen coordinates', () => {
    const v = { zoom: 1.7, panX: 33, panY: -12 };
    near(toSheet(v, toScreen(v, [120, 340])), [120, 340]);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const v = { zoom: 1, panX: 10, panY: 20 };
    const at: Vec = [200, 150];
    const before = toSheet(v, at);
    near(toSheet(zoomAt(v, 2.5, at), at), before);
  });

  it('fits the outside sheet inside the viewport with margins', () => {
    const box = sheetBounds(g, 'outside');
    const v = fitView(box, 560, 790, 40);
    const tl = toScreen(v, [box.x, box.y]);
    const br = toScreen(v, [box.x + box.w, box.y + box.h]);
    expect(tl[0]).toBeGreaterThanOrEqual(39.9);
    expect(tl[1]).toBeGreaterThanOrEqual(39.9);
    expect(br[0]).toBeLessThanOrEqual(520.1);
    expect(br[1]).toBeLessThanOrEqual(750.1);
  });
});

describe('layout', () => {
  it('lays out 6 outside and 9 inside pieces', () => {
    expect(pieceFrames(g, 'outside')).toHaveLength(6);
    expect(pieceFrames(g, 'inside')).toHaveLength(9);
  });

  it('mirrors inside faces horizontally', () => {
    const out = frameFor(g, 'outside', 'sleeveR')!;
    const ins = frameFor(g, 'inside', 'sleeveR')!;
    const p = out.outline[3]!;
    expect(ins.outline[3]![0]).toBeCloseTo(out.w - p[0]);
    expect(ins.outline[3]![1]).toBeCloseTo(p[1]);
  });

  it('finds the piece under a sheet point', () => {
    const f = frameFor(g, 'outside', 'front')!;
    expect(pieceAt(g, 'outside', [f.bounds.x + f.w / 2, f.bounds.y + f.h / 2])?.piece.id).toBe('front');
    expect(pieceAt(g, 'outside', [-500, -500])).toBeUndefined();
  });

  it('hits the topmost visible layer on the current side', () => {
    const place = { pieceId: 'front', side: 'outside' as const, x: 265, y: 300, w: 100, h: 100 };
    const bottom = createShapeLayer(place, 'rect');
    const top = createShapeLayer({ ...place, w: 40, h: 40 }, 'circle');
    const f = frameFor(g, 'outside', 'front')!;
    const centre = apply(f.toSheet, [265, 300]);
    expect(hitLayer(g, [top, bottom], 'outside', centre)?.id).toBe(top.id);
    expect(hitLayer(g, [{ ...top, visible: false }, bottom], 'outside', centre)?.id).toBe(bottom.id);
    expect(hitLayer(g, [top, bottom], 'inside', centre)).toBeUndefined();
    const edge = apply(f.toSheet, [265 + 45, 300]);
    expect(hitLayer(g, [top, bottom], 'outside', edge)?.id).toBe(bottom.id);
  });

  it('honours rotation when hit-testing and computing corners', () => {
    const l = {
      ...createShapeLayer({ pieceId: 'front', side: 'outside', x: 265, y: 300, w: 200, h: 20 }, 'rect'),
      rotationDeg: 90,
    };
    const f = frameFor(g, 'outside', 'front')!;
    const c = layerCorners(l, f);
    near(c[0], apply(f.toSheet, [275, 200]));
    expect(hitLayer(g, [l], 'outside', apply(f.toSheet, [265, 390]))).toBeDefined();
    expect(hitLayer(g, [l], 'outside', apply(f.toSheet, [355, 300]))).toBeUndefined();
  });

  it('keeps the sheet position when re-parenting to another piece', () => {
    const from = frameFor(g, 'outside', 'front')!;
    const to = frameFor(g, 'outside', 'back')!;
    const l = createShapeLayer({ pieceId: 'front', side: 'outside', x: 500, y: 300, w: 50, h: 50 }, 'rect');
    const moved = reparent(l, from, to);
    near(apply(to.toSheet, [moved.x, moved.y]), apply(from.toSheet, [l.x, l.y]));
    expect(moved.pieceId).toBe('back');
  });
});

describe('wrap over seams', () => {
  const links = seamLinks(g, 'outside');

  it('creates both directions for every seam whose pieces are on the side', () => {
    expect(links).toHaveLength(g.seams.length * 2);
  });

  it('maps seam chord endpoints onto the sewn chord', () => {
    const s = g.seams[2]!; // front left side seam ↔ back right side seam
    const front = frameFor(g, 'outside', 'front')!;
    const back = frameFor(g, 'outside', 'back')!;
    const link = links.find((l) => l.from === 'front' && l.to === 'back')!;
    const shoulder = links.filter((l) => l.from === 'front' && l.to === 'back');
    expect(shoulder.length).toBeGreaterThanOrEqual(2);
    const m = links.find(
      (l) =>
        l.from === 'front' &&
        l.to === 'back' &&
        Math.hypot(
          ...(apply(l.m, front.outline[s.a.from]!).map((v, i) => v - back.outline[s.b.from]![i]!) as [
            number,
            number,
          ]),
        ) < 1e-6,
    );
    expect(m ?? link).toBeDefined();
    near(apply(m!.m, front.outline[s.a.to]!), back.outline[s.b.to]!);
  });

  it('flattens across the seam: front interior lands outside the back piece', () => {
    const s = g.seams[2]!;
    const front = frameFor(g, 'outside', 'front')!;
    const back = frameFor(g, 'outside', 'back')!;
    const m = links.find(
      (l) =>
        l.from === 'front' &&
        l.to === 'back' &&
        Math.abs(apply(l.m, front.outline[s.a.from]!)[0] - back.outline[s.b.from]![0]) < 1e-6,
    )!;
    // 30 mm inside the front's left side seam, half-way down.
    const inside: Vec = [30, 500];
    expect(pointInPolygon(inside, front.outline)).toBe(true);
    expect(pointInPolygon(apply(m.m, inside), back.outline)).toBe(false);
    // …and a point just past the front's left edge lands inside the back.
    expect(pointInPolygon(apply(m.m, [-30, 500]), back.outline)).toBe(true);
  });
});

describe('image effects', () => {
  it('finds the opaque bounds of an image', () => {
    const w = 10;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 2; y <= 5; y++) for (let x = 3; x <= 7; x++) data[(y * w + x) * 4 + 3] = 255;
    const c = trimBounds(data, w, h)!;
    expect(c.l).toBeCloseTo(0.3);
    expect(c.r).toBeCloseTo(0.2);
    expect(c.t).toBeCloseTo(0.25);
    expect(c.b).toBeCloseTo(0.25);
    expect(trimBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  it('fills, inverts and shifts hue while keeping alpha', () => {
    const px = () => new Uint8ClampedArray([255, 0, 0, 200, 0, 0, 0, 0]);
    const fill = px();
    adjustPixels(fill, { invert: false, hueDeg: 0, saturation: 1, fill: '#00ff00' });
    expect([...fill.slice(0, 4)]).toEqual([0, 255, 0, 200]);
    expect(fill[7]).toBe(0);

    const inv = px();
    adjustPixels(inv, { invert: true, hueDeg: 0, saturation: 1, fill: null });
    expect([...inv.slice(0, 4)]).toEqual([0, 255, 255, 200]);

    const hue = px();
    adjustPixels(hue, { invert: false, hueDeg: 120, saturation: 1, fill: null });
    expect(hue[1]).toBe(255);
    expect(hue[0]).toBe(0);

    const grey = px();
    adjustPixels(grey, { invert: false, hueDeg: 0, saturation: 0, fill: null });
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
  });
});
