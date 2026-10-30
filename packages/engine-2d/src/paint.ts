import { deg2rad, type Paint } from '@gs/core';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function rgba(hex: string, alpha = 1): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Canvas fill/stroke style for a paint over a w×h box centred at (cx, cy) in the coordinates that
 * will be current when filling. Linear angle: 0° = left→right, 90° = top→bottom.
 */
export function canvasPaint(
  ctx: Ctx2D,
  paint: Paint,
  w: number,
  h: number,
  cx = 0,
  cy = 0,
): string | CanvasGradient {
  if (paint.kind === 'solid') return paint.color;
  let g: CanvasGradient;
  if (paint.kind === 'linear') {
    const a = deg2rad(paint.angleDeg);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  } else {
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2);
  }
  const stops = [...paint.stops].sort((x, y) => x.at - y.at);
  for (const s of stops) g.addColorStop(s.at, rgba(s.color, s.alpha));
  return g;
}

/** Fabric fill for a piece: solid, or a top→bottom gradient across the piece bounds. */
export function fabricStyle(
  ctx: Ctx2D,
  fabric: { mode: 'solid' | 'gradient'; color: string; gradientTo: string },
  top: number,
  bottom: number,
): string | CanvasGradient {
  if (fabric.mode === 'solid') return fabric.color;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, fabric.color);
  g.addColorStop(1, fabric.gradientTo);
  return g;
}
