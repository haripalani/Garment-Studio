// Pure layer manipulation maths for the pattern editor. Inputs are sheet-space points (mm);
// every function returns the layer fields to update. Working in the layer's own content frame
// (invert(layerToSheet)) makes rotation and mirroring fall out naturally.
import {
  apply,
  bbox,
  deg2rad,
  invert,
  rad2deg,
  type Crop,
  type ImageLayer,
  type Layer,
  type Vec,
} from '@gs/core';
import { layerToPiece, layerToSheet, type PieceFrame } from './layout';

export const MIN_SIZE_MM = 1;

export type Corner = 'nw' | 'ne' | 'se' | 'sw';
export type Edge = 'n' | 'e' | 's' | 'w';

const SIGN: Record<Corner, [number, number]> = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };

/** Scale from a corner, keeping the opposite corner fixed. `free` lets width and height change independently. */
export function scaleFromCorner(
  start: Layer,
  frame: PieceFrame,
  corner: Corner,
  pointer: Vec,
  free: boolean,
): Pick<Layer, 'x' | 'y' | 'w' | 'h'> {
  const toLocal = invert(layerToSheet(start, frame));
  const [sx, sy] = SIGN[corner];
  const o: Vec = [(-sx * start.w) / 2, (-sy * start.h) / 2];
  const p = apply(toLocal, pointer);
  let w: number;
  let h: number;
  if (free) {
    w = Math.max(MIN_SIZE_MM, (p[0] - o[0]) * sx);
    h = Math.max(MIN_SIZE_MM, (p[1] - o[1]) * sy);
  } else {
    const d: Vec = [sx * start.w, sy * start.h];
    const f = ((p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
    const k = Math.max(f, MIN_SIZE_MM / Math.min(start.w, start.h));
    w = start.w * k;
    h = start.h * k;
  }
  const centreLocal: Vec = [o[0] + (sx * w) / 2, o[1] + (sy * h) / 2];
  const [x, y] = apply(layerToPiece(start), centreLocal);
  return { x, y, w, h };
}

/** Rotate about the layer centre following the pointer. `snap` rounds to 15°; near-axis angles snap within 2°. */
export function rotateTo(start: Layer, frame: PieceFrame, from: Vec, pointer: Vec, snap: boolean): number {
  const c = apply(frame.toSheet, [start.x, start.y]);
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
  const a1 = Math.atan2(pointer[1] - c[1], pointer[0] - c[0]);
  let deg = start.rotationDeg + rad2deg(a1 - a0);
  if (snap) deg = Math.round(deg / 15) * 15;
  else {
    const near = Math.round(deg / 90) * 90;
    if (Math.abs(deg - near) < 2) deg = near;
  }
  return normaliseDeg(deg);
}

export function normaliseDeg(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.abs(d) < 1e-9 ? 0 : d;
}

/** Axis-aligned bounds of a layer in its piece frame. */
export function layerBounds(l: Layer) {
  const m = layerToPiece(l);
  return bbox([
    apply(m, [-l.w / 2, -l.h / 2]),
    apply(m, [l.w / 2, -l.h / 2]),
    apply(m, [l.w / 2, l.h / 2]),
    apply(m, [-l.w / 2, l.h / 2]),
  ]);
}

export type AlignTo = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/** Align the layer's rotated bounds to the piece bounds. */
export function alignInPiece(l: Layer, frame: PieceFrame, to: AlignTo): Pick<Layer, 'x' | 'y'> {
  const b = layerBounds(l);
  let { x, y } = l;
  if (to === 'left') x += -b.x;
  if (to === 'right') x += frame.w - (b.x + b.w);
  if (to === 'centre') x += frame.w / 2 - (b.x + b.w / 2);
  if (to === 'top') y += -b.y;
  if (to === 'bottom') y += frame.h - (b.y + b.h);
  if (to === 'middle') y += frame.h / 2 - (b.y + b.h / 2);
  return { x, y };
}

const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };

/** The full (uncropped) image box in the layer's content frame. */
export function fullImageBox(l: ImageLayer): { x0: number; y0: number; fw: number; fh: number } {
  const c = l.crop ?? NO_CROP;
  const fw = l.w / Math.max(1e-4, 1 - c.l - c.r);
  const fh = l.h / Math.max(1e-4, 1 - c.t - c.b);
  return { x0: -l.w / 2 - c.l * fw, y0: -l.h / 2 - c.t * fh, fw, fh };
}

/**
 * Drag one or two crop edges. The rest of the picture stays where it is on the pattern,
 * so the layer box (x, y, w, h) changes along with the crop.
 */
export function cropEdges(
  start: ImageLayer,
  frame: PieceFrame,
  edges: readonly Edge[],
  pointer: Vec,
): Pick<ImageLayer, 'x' | 'y' | 'w' | 'h' | 'crop'> {
  const p = apply(invert(layerToSheet(start, frame)), pointer);
  const { x0, y0, fw, fh } = fullImageBox(start);
  let left = -start.w / 2;
  let right = start.w / 2;
  let top = -start.h / 2;
  let bottom = start.h / 2;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  if (edges.includes('w')) left = clamp(p[0], x0, right - MIN_SIZE_MM);
  if (edges.includes('e')) right = clamp(p[0], left + MIN_SIZE_MM, x0 + fw);
  if (edges.includes('n')) top = clamp(p[1], y0, bottom - MIN_SIZE_MM);
  if (edges.includes('s')) bottom = clamp(p[1], top + MIN_SIZE_MM, y0 + fh);
  const crop: Crop = {
    l: (left - x0) / fw,
    r: (x0 + fw - right) / fw,
    t: (top - y0) / fh,
    b: (y0 + fh - bottom) / fh,
  };
  const [x, y] = apply(layerToPiece(start), [(left + right) / 2, (top + bottom) / 2]);
  return { x, y, w: right - left, h: bottom - top, crop };
}

/** Slide the picture under a fixed crop window (drag inside while cropping). */
export function cropPan(start: ImageLayer, frame: PieceFrame, from: Vec, pointer: Vec): Crop {
  const toLocal = invert(layerToSheet(start, frame));
  const a = apply(toLocal, from);
  const b = apply(toLocal, pointer);
  const c = start.crop ?? NO_CROP;
  const { fw, fh } = fullImageBox(start);
  const spanX = c.l + c.r;
  const spanY = c.t + c.b;
  const l = Math.min(spanX, Math.max(0, c.l - (b[0] - a[0]) / fw));
  const t = Math.min(spanY, Math.max(0, c.t - (b[1] - a[1]) / fh));
  return { l, r: spanX - l, t, b: spanY - t };
}

/**
 * Apply a new crop (e.g. "Trim empty edges") keeping the visible pixels where they are
 * and the physical scale (mm per image pixel) unchanged.
 */
export function applyCrop(
  start: ImageLayer,
  crop: Crop | null,
): Pick<ImageLayer, 'x' | 'y' | 'w' | 'h' | 'crop'> {
  const { x0, y0, fw, fh } = fullImageBox(start);
  const c = crop ?? NO_CROP;
  const left = x0 + c.l * fw;
  const right = x0 + fw - c.r * fw;
  const top = y0 + c.t * fh;
  const bottom = y0 + fh - c.b * fh;
  const [x, y] = apply(layerToPiece(start), [(left + right) / 2, (top + bottom) / 2]);
  return { x, y, w: Math.max(MIN_SIZE_MM, right - left), h: Math.max(MIN_SIZE_MM, bottom - top), crop };
}

/** Layer fields for a preset placement on a piece, keeping the layer's aspect ratio. */
export function presetPlacement(
  l: Pick<Layer, 'w' | 'h'>,
  frame: PieceFrame,
  p: { fx: number; fy: number; fw: number },
): Pick<Layer, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'> {
  const aspect = l.h / l.w;
  let w = frame.w * p.fw;
  let h = w * aspect;
  const maxH = frame.h * 0.6;
  if (h > maxH) {
    h = maxH;
    w = h / aspect;
  }
  return { x: frame.w * p.fx, y: frame.h * p.fy, w, h, rotationDeg: 0 };
}

export { deg2rad };
