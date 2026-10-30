// 2D geometry in millimetres. y points down (screen convention) everywhere.

export type Vec = readonly [number, number];
/** Affine matrix [a, b, c, d, e, f] — same layout as CanvasRenderingContext2D.setTransform. */
export type Mat = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  // m · n  (apply n first, then m)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function compose(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => mul(acc, m), IDENTITY);
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function scale(sx: number, sy = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible');
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat, p: Vec): Vec {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

/** Similarity transform (rotation + uniform scale + translation) mapping a0→b0 and a1→b1. */
export function similarityFromSegments(a0: Vec, a1: Vec, b0: Vec, b1: Vec): Mat {
  const va: Vec = [a1[0] - a0[0], a1[1] - a0[1]];
  const vb: Vec = [b1[0] - b0[0], b1[1] - b0[1]];
  const la = Math.hypot(va[0], va[1]);
  const lb = Math.hypot(vb[0], vb[1]);
  if (la < 1e-9 || lb < 1e-9) throw new Error('Degenerate segment');
  const angle = Math.atan2(vb[1], vb[0]) - Math.atan2(va[1], va[0]);
  const k = lb / la;
  return compose(translate(b0[0], b0[1]), rotate(angle), scale(k), translate(-a0[0], -a0[1]));
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bbox(points: readonly Vec[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBox(boxes: readonly Box[]): Box {
  return bbox(boxes.flatMap((b) => [[b.x, b.y] as Vec, [b.x + b.w, b.y + b.h] as Vec]));
}

/** Signed area (shoelace). Positive = clockwise on screen (y down). */
export function signedArea(poly: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Corners of a rectangle of size w×h centred at the origin, transformed by m (TL, TR, BR, BL). */
export function boxCorners(m: Mat, w: number, h: number): [Vec, Vec, Vec, Vec] {
  return [
    apply(m, [-w / 2, -h / 2]),
    apply(m, [w / 2, -h / 2]),
    apply(m, [w / 2, h / 2]),
    apply(m, [-w / 2, h / 2]),
  ];
}

/** Samples a cubic Bézier (excluding the start point). */
export function cubic(p0: Vec, c1: Vec, c2: Vec, p1: Vec, steps = 12): Vec[] {
  const out: Vec[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return out;
}
