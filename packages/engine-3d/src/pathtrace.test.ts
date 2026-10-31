import { describe, expect, it } from 'vitest';
import { QUALITY_SAMPLES, renderPlan } from './pathtrace';
import { fitDistance } from './studio';

describe('render plan', () => {
  it('uses the documented sample counts per quality', () => {
    expect(QUALITY_SAMPLES).toEqual({ draft: 150, good: 500, high: 1000, max: 1500 });
    expect(renderPlan(2000, 2500, 'good').samples).toBe(500);
  });

  it('tiles large frames and raises texture and bake resolution only for fine, large renders', () => {
    expect(renderPlan(1080, 1080, 'draft')).toMatchObject({ tiles: 1, textureSize: 1024, bakePxPerMm: 2, bounces: 4 });
    expect(renderPlan(2000, 2500, 'good')).toMatchObject({ tiles: 2, textureSize: 1024, bakePxPerMm: 2, bounces: 6 });
    expect(renderPlan(3840, 2160, 'max')).toMatchObject({ tiles: 3, textureSize: 2048, bakePxPerMm: 4 });
    expect(renderPlan(1200, 1500, 'high')).toMatchObject({ textureSize: 2048, bakePxPerMm: 2 });
  });
});

describe('framing', () => {
  const tee = { w: 0.9, h: 0.75 };
  it('fits the height for tall frames and the width for narrow ones', () => {
    const square = fitDistance(tee, 26, 1);
    expect(fitDistance(tee, 26, 0.5)).toBeGreaterThan(square); // narrow: width limits, move back
    expect(fitDistance(tee, 26, 2)).toBeCloseTo(fitDistance(tee, 26, 3)); // wide: height limits
  });

  it('keeps the whole garment inside the frame with a margin', () => {
    const fov = (26 * Math.PI) / 180;
    for (const aspect of [0.5, 0.8, 1, 1.78]) {
      const d = fitDistance(tee, 26, aspect);
      const halfH = Math.tan(fov / 2) * d;
      const halfW = halfH * aspect;
      expect(halfH).toBeGreaterThanOrEqual((tee.h + 0.16) / 2);
      expect(halfW).toBeGreaterThanOrEqual(tee.w / 2);
    }
  });
});
