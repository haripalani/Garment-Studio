import { describe, expect, it } from 'vitest';
import { apply, createDevTee, createImageLayer, createShapeLayer, type ImageLayer, type Vec } from '@gs/core';
import {
  alignInPiece,
  applyCrop,
  cropEdges,
  cropPan,
  frameFor,
  layerCorners,
  layerBounds,
  presetPlacement,
  rotateTo,
  scaleFromCorner,
} from './index';

const g = createDevTee();
const frame = frameFor(g, 'outside', 'front')!;
const S = (p: Vec) => apply(frame.toSheet, p);
const near = (a: Vec, b: Vec, d = 6) => {
  expect(a[0]).toBeCloseTo(b[0], d);
  expect(a[1]).toBeCloseTo(b[1], d);
};

const rect = createShapeLayer({ pieceId: 'front', side: 'outside', x: 200, y: 300, w: 100, h: 50 }, 'rect');

describe('scale from corner', () => {
  it('keeps the opposite corner fixed and the aspect ratio by default', () => {
    // Drag SE corner from (250, 325) to (350, 400).
    const r = scaleFromCorner(rect, frame, 'se', S([350, 400]), false);
    expect(r.w / r.h).toBeCloseTo(2);
    const after = layerCorners({ ...rect, ...r }, frame);
    near(after[0], layerCorners(rect, frame)[0]);
  });

  it('scales freely with Shift', () => {
    const r = scaleFromCorner(rect, frame, 'se', S([350, 400]), true);
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(125);
  });

  it('works on rotated layers', () => {
    const rot = { ...rect, rotationDeg: 90 };
    const before = layerCorners(rot, frame);
    // In content space SE is (+50, +25); rotated 90° that is sheet offset (-25, +50).
    // Doubling the size moves SE to content (+150, +75) → sheet offset (-75, +150).
    const r = scaleFromCorner(rot, frame, 'se', S([200 - 75, 300 + 150]), false);
    near(layerCorners({ ...rot, ...r }, frame)[0], before[0]);
    expect(r.w).toBeCloseTo(200);
  });

  it('never collapses below the minimum size', () => {
    const r = scaleFromCorner(rect, frame, 'se', S([0, 0]), true);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
});

describe('rotate', () => {
  it('follows the pointer around the centre and snaps with Shift', () => {
    const c: Vec = [200, 300];
    expect(rotateTo(rect, frame, S([c[0] + 100, c[1]]), S([c[0], c[1] + 100]), false)).toBeCloseTo(90);
    expect(rotateTo(rect, frame, S([c[0] + 100, c[1]]), S([c[0] + 100, c[1] + 40]), true)).toBe(
      15 * Math.round(21.8 / 15),
    );
  });

  it('normalises into (-180, 180]', () => {
    const r = rotateTo({ ...rect, rotationDeg: 170 }, frame, S([300, 300]), S([200, 400]), false);
    expect(r).toBeCloseTo(-100);
  });
});

describe('align to piece', () => {
  it('aligns the rotated bounds to the piece edges', () => {
    const rot = { ...rect, rotationDeg: 90 };
    const left = { ...rot, ...alignInPiece(rot, frame, 'left') };
    expect(layerBounds(left).x).toBeCloseTo(0);
    const bottom = { ...rot, ...alignInPiece(rot, frame, 'bottom') };
    const b = layerBounds(bottom);
    expect(b.y + b.h).toBeCloseTo(frame.h);
    const c = { ...rect, ...alignInPiece(rect, frame, 'centre') };
    expect(c.x).toBeCloseTo(frame.w / 2);
  });
});

describe('crop', () => {
  const img: ImageLayer = createImageLayer(
    { pieceId: 'front', side: 'outside', x: 200, y: 300, w: 100, h: 100 },
    'a',
    'x.png',
  );

  it('dragging the west edge crops and keeps the right edge in place', () => {
    const r = cropEdges(img, frame, ['w'], S([175, 300]));
    expect(r.crop!.l).toBeCloseTo(0.25);
    expect(r.w).toBeCloseTo(75);
    expect(r.x + r.w / 2).toBeCloseTo(250);
  });

  it('cannot crop past the picture or invert', () => {
    const r = cropEdges(img, frame, ['w'], S([100, 300]));
    expect(r.crop!.l).toBeCloseTo(0);
    const r2 = cropEdges(img, frame, ['w'], S([400, 300]));
    expect(r2.w).toBeCloseTo(1);
  });

  it('pans the picture under a fixed window', () => {
    const cropped = { ...img, ...cropEdges(img, frame, ['w'], S([175, 300])) };
    const c = cropPan(cropped, frame, S([200, 300]), S([210, 300]));
    expect(c.l + c.r).toBeCloseTo(0.25);
    expect(c.l).toBeCloseTo(0.25 - 10 / 100);
  });

  it('applyCrop keeps the physical scale and visible position', () => {
    const r = applyCrop(img, { l: 0.1, t: 0.2, r: 0.3, b: 0 });
    expect(r.w).toBeCloseTo(60);
    expect(r.h).toBeCloseTo(80);
    expect(r.x - r.w / 2).toBeCloseTo(150 + 10);
    const back = applyCrop({ ...img, ...r }, null);
    expect(back.w).toBeCloseTo(100);
    expect(back.x).toBeCloseTo(200);
  });
});

describe('presets', () => {
  it('places by fractions of the piece and keeps aspect', () => {
    const p = presetPlacement({ w: 200, h: 100 }, frame, { fx: 0.5, fy: 0.3, fw: 0.4 });
    expect(p.x).toBeCloseTo(frame.w / 2);
    expect(p.w).toBeCloseTo(frame.w * 0.4);
    expect(p.h).toBeCloseTo(p.w / 2);
  });
});
