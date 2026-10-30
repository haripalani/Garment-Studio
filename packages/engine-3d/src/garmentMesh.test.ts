import { describe, expect, it } from 'vitest';
import { apply, createDevTee, type Vec } from '@gs/core';
import { affineFrom3, buildGarmentGeometry, knitHeight, MM, nearestOnPolygon } from './index';

const g = createDevTee();
const geo = buildGarmentGeometry(g, { stepMm: 8 });

describe('garment geometry', () => {
  it('builds front and back bodies plus both sleeves on each side', () => {
    expect(geo.panels.map((p) => p.key).sort()).toEqual(
      ['back:back', 'back:sleeveL', 'back:sleeveR', 'front:front', 'front:sleeveL', 'front:sleeveR'].sort(),
    );
  });

  it('keeps UVs inside the piece texture and indices in range', () => {
    for (const p of geo.panels) {
      for (const v of p.uvs) {
        expect(v).toBeGreaterThanOrEqual(-1e-6);
        expect(v).toBeLessThanOrEqual(1 + 1e-6);
      }
      const n = p.positions.length / 3;
      expect(p.indices.length).toBeGreaterThan(300);
      for (const i of p.indices) expect(i).toBeLessThan(n);
    }
  });

  it('inflates the front toward the viewer and the back away from it', () => {
    const z = (key: string) => [...geo.panels.find((p) => p.key === key)!.positions].filter((_, i) => i % 3 === 2);
    expect(Math.min(...z('front:front'))).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.max(...z('front:front'))).toBeGreaterThan(15 * MM);
    expect(Math.max(...z('back:back'))).toBeLessThanOrEqual(1e-6);
  });

  it('orients outer faces toward each view (front +Z, back −Z)', () => {
    for (const p of geo.panels) {
      let sum = 0;
      for (let t = 0; t < p.indices.length; t += 3) {
        const [a, b, c] = [p.indices[t]!, p.indices[t + 1]!, p.indices[t + 2]!].map((i) => [
          p.positions[i * 3]!,
          p.positions[i * 3 + 1]!,
        ]) as [number[], number[], number[]];
        sum += (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
      }
      if (p.view === 'front') expect(sum).toBeGreaterThan(0);
      else expect(sum).toBeLessThan(0);
    }
  });

  it('meets front and back at the side seams (z = 0 on the outline)', () => {
    const front = geo.panels.find((p) => p.key === 'front:front')!;
    // Vertices with u ≈ 0 lie on the front's left side seam.
    let checked = 0;
    for (let i = 0; i < front.uvs.length / 2; i++) {
      if (front.uvs[i * 2]! < 1e-6) {
        expect(Math.abs(front.positions[i * 3 + 2]!)).toBeLessThan(1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('attaches each sleeve at its armhole: the cap top meets the shoulder point', () => {
    const front = g.pieces.find((p) => p.id === 'front')!;
    const sleeve = geo.panels.find((p) => p.key === 'front:sleeveR')!;
    const seam = g.seams.find((s) => s.a.piece === 'front' && s.b.piece === 'sleeveR')!;
    const sh = front.outlineMm[seam.a.from]!;
    const cx = 265;
    const cy = 365;
    const target: Vec = [(sh[0] - cx) * MM, -(sh[1] - cy) * MM];
    let best = Infinity;
    for (let i = 0; i < sleeve.positions.length / 3; i++) {
      best = Math.min(best, Math.hypot(sleeve.positions[i * 3]! - target[0], sleeve.positions[i * 3 + 1]! - target[1]));
    }
    expect(best).toBeLessThan(10 * MM);
  });

  it('places the right sleeve on the wearer’s right (viewer’s left from the front) on both faces', () => {
    const avgX = (key: string) => {
      const p = geo.panels.find((x) => x.key === key)!;
      let s = 0;
      for (let i = 0; i < p.positions.length; i += 3) s += p.positions[i]!;
      return s / (p.positions.length / 3);
    };
    expect(avgX('front:sleeveR')).toBeLessThan(-0.2);
    expect(avgX('back:sleeveR')).toBeLessThan(-0.2);
    expect(avgX('front:sleeveL')).toBeGreaterThan(0.2);
  });

  it('flattens folds when wrinkles are off and darkens edges only with AO', () => {
    const flat = buildGarmentGeometry(g, { stepMm: 8, wrinkles: 0, ao: false });
    const p = flat.panels.find((x) => x.key === 'front:front')!;
    expect(new Set(p.ao).size).toBe(1);
    const withAo = geo.panels.find((x) => x.key === 'front:front')!;
    expect(Math.min(...withAo.ao)).toBeLessThan(0.8);
  });
});

describe('helpers', () => {
  it('solves an affine transform from three correspondences', () => {
    const m = affineFrom3([[0, 0], [10, 0], [0, 10]], [[5, 5], [5, 25], [-5, 5]]);
    const close = (a: Vec, b: Vec) => {
      expect(a[0]).toBeCloseTo(b[0]);
      expect(a[1]).toBeCloseTo(b[1]);
    };
    close(apply(m, [10, 0]), [5, 25]);
    close(apply(m, [10, 10]), [-5, 25]);
  });

  it('finds the nearest point on a polygon boundary', () => {
    const sq: Vec[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(nearestOnPolygon([15, 5], sq)).toEqual([10, 5]);
    expect(nearestOnPolygon([-3, -4], sq)).toEqual([0, 0]);
  });

  it('knit height fields stay in range for every material', () => {
    for (const m of ['cotton', 'cotton-blend', 'interlock', 'sport-knit', 'pique', 'rib', 'waffle', 'fleece', 'mesh'] as const) {
      for (let i = 0; i < 50; i++) {
        const h = knitHeight(m, (i * 0.137) % 1, (i * 0.291) % 1);
        expect(h).toBeGreaterThanOrEqual(-0.01);
        expect(h).toBeLessThanOrEqual(1.01);
      }
    }
  });
});
