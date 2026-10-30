// Procedural 3D garment built from the pattern pieces (ADR-0007 development fallback).
// Every panel's UVs are its pattern piece's own frame (u = x / w, v = 1 - y / h), so the textures
// baked by engine-2d land on the garment exactly where the artwork sits on the pattern.
// Real CLO3D / Marvelous Designer meshes (same UV contract) replace this when assets exist.
import {
  apply,
  bbox,
  pointInPolygon,
  type GarmentModel,
  type Mat,
  type PieceDef,
  type Side,
  type Vec,
} from '@gs/core';

export const MM = 0.001; // world units are metres

export interface PanelGeometry {
  /** Stable key: `${view}:${pieceId}`. */
  key: string;
  pieceId: string;
  view: 'front' | 'back';
  positions: Float32Array; // xyz, metres
  uvs: Float32Array; // piece frame → [0,1]²
  indices: Uint32Array;
  /** Per-vertex ambient-occlusion factor in [0,1] (1 = unoccluded). */
  ao: Float32Array;
}

export interface GarmentGeometry {
  panels: PanelGeometry[];
  /** Neck opening polylines (world, metres) for the rib, per view. */
  necklines: { view: 'front' | 'back'; points: [number, number, number][] }[];
  /** World-space anchors for the hanger and the neck label. */
  anchors: { neckTop: [number, number, number]; shoulderL: [number, number, number]; shoulderR: [number, number, number]; labelCentre: [number, number, number] };
  /** Overall size (metres) for camera framing. */
  size: { w: number; h: number };
}

export interface BuildOptions {
  /** Grid step in mm (smaller = smoother, heavier). */
  stepMm?: number;
  /** 0..1 fold amplitude (0 = flat pillow). */
  wrinkles?: number;
  ao?: boolean;
}

const BODY_DEPTH = 26; // mm at the centre of the body pillow
const BODY_ROUND = 90; // mm over which the edge rounds off
const SLEEVE_DEPTH = 16;
const SLEEVE_ROUND = 55;
const SLEEVE_DROP_DEG = 22;

/* ───────────── helpers ───────────── */

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function nearestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Closest point on a closed polygon's boundary. */
export function nearestOnPolygon(p: Vec, poly: readonly Vec[]): Vec {
  let best: Vec = poly[0]!;
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = nearestOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

function distToEdges(p: Vec, poly: readonly Vec[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const v = distToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    if (v < d) d = v;
  }
  return d;
}

/** Affine transform mapping three source points onto three target points. */
export function affineFrom3(s: [Vec, Vec, Vec], t: [Vec, Vec, Vec]): Mat {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-9) throw new Error('Degenerate correspondence');
  const solve = (u0: number, u1: number, u2: number): [number, number, number] => {
    const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
    const b = ((x1 - x0) * (u2 - u0) - (x2 - x0) * (u1 - u0)) / det;
    return [a, b, u0 - a * x0 - b * y0];
  };
  const [a, c, e] = solve(t[0][0], t[1][0], t[2][0]);
  const [b, d, f] = solve(t[0][1], t[1][1], t[2][1]);
  return [a, b, c, d, e, f];
}

/** Rounded pillow profile: 0 at the edge, 1 from `round` inwards. */
function pillow(d: number, round: number): number {
  const t = Math.min(1, Math.max(0, d / round));
  return Math.sqrt(1 - (1 - t) * (1 - t));
}

/** Deterministic soft folds (diagonal drape plus a few cross folds), roughly in [-1, 1]. */
export function foldField(x: number, y: number): number {
  return (
    0.55 * Math.sin((x * 0.35 + y * 0.94) / 38) * Math.sin(y / 61 + 0.7) +
    0.3 * Math.sin((x * -0.8 + y * 0.6) / 23 + 1.3) +
    0.15 * Math.sin((x + y * 0.2) / 11)
  );
}

interface Region {
  /** Polygon in the region's own frame that bounds the surface. */
  poly: readonly Vec[];
  /** Region frame → view (body) frame. */
  toView: Mat;
  /** Region frame → UV of the piece texture. */
  uv: (p: Vec) => [number, number];
  /** Extra clip: keep only points where this returns true (half sleeves). */
  keep?: (p: Vec) => boolean;
  /** Distance to an extra fold edge (the sleeve's top fold), if any. */
  foldDist?: (p: Vec) => number;
  /** Grid origin so a fold line lands exactly on grid vertices. */
  gridOrigin: Vec;
  depth: number;
  round: number;
}

function uvOf(piece: PieceDef) {
  const b = bbox(piece.outlineMm);
  return (p: Vec): [number, number] => [p[0] / b.w, 1 - p[1] / b.h];
}

function buildRegion(
  r: Region,
  step: number,
  view: 'front' | 'back',
  toWorld: (p: Vec, z: number) => [number, number, number],
  opts: Required<BuildOptions>,
  key: string,
  pieceId: string,
): PanelGeometry {
  const b = bbox(r.poly);
  // Expand by one cell so the alpha-tested edge has geometry on both sides of the outline.
  const x0 = r.gridOrigin[0] - Math.ceil((r.gridOrigin[0] - (b.x - step)) / step) * step;
  const y0 = r.gridOrigin[1] - Math.ceil((r.gridOrigin[1] - (b.y - step)) / step) * step;
  const nx = Math.ceil((b.x + b.w + step - x0) / step) + 1;
  const ny = Math.ceil((b.y + b.h + step - y0) / step) + 1;

  const index = new Int32Array(nx * ny).fill(-1);
  const pos: number[] = [];
  const uv: number[] = [];
  const ao: number[] = [];
  const near: boolean[] = [];
  let count = 0;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const grid: Vec = [x0 + i * step, y0 + j * step];
      if (r.keep && !r.keep(grid)) continue;
      const inside = pointInPolygon(grid, r.poly);
      // Outside vertices snap onto the outline: the mesh edge is the piece edge and UVs stay in [0,1]
      // (no clamped-texture fringe past the seam).
      const p: Vec = inside ? grid : nearestOnPolygon(grid, r.poly);
      let d = inside ? distToEdges(p, r.poly) : 0;
      if (inside && r.foldDist) d = Math.min(d, r.foldDist(p));
      const pr = inside ? pillow(d, r.round) : 0;
      const viewP = apply(r.toView, p);
      const fold = opts.wrinkles * foldField(viewP[0], viewP[1]);
      const z = inside ? r.depth * pr + fold * 7 * pr : 0;
      index[j * nx + i] = count++;
      pos.push(...toWorld(viewP, z));
      uv.push(...r.uv(p));
      // AO: darker toward the seams and in fold valleys.
      const edge = 1 - pr;
      ao.push(opts.ao ? Math.max(0.45, 1 - 0.38 * edge * edge - 0.12 * Math.max(0, -fold) * pr) : 1);
      near.push(inside || distToEdges(grid, r.poly) <= step * 1.5);
    }
  }

  const idx: number[] = [];
  const m = r.toView;
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = index[j * nx + i]!;
      const b2 = index[j * nx + i + 1]!;
      const c = index[(j + 1) * nx + i]!;
      const d2 = index[(j + 1) * nx + i + 1]!;
      if (a < 0 || b2 < 0 || c < 0 || d2 < 0) continue;
      if (!(near[a] || near[b2] || near[c] || near[d2])) continue;
      // Winding: outer faces point toward this view's viewer. The back view mirrors X in toWorld,
      // which already flips orientation, so the same index order faces -Z there. A region map with
      // a reflection (negative determinant, e.g. one of the sleeves) flips it once more.
      if (mirrored) idx.push(a, b2, c, b2, d2, c);
      else idx.push(a, c, b2, b2, c, d2);
    }
  }

  return {
    key,
    pieceId,
    view,
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
    ao: new Float32Array(ao),
  };
}

/* ───────────── garment ───────────── */

function pieceOf(g: GarmentModel, id: string): PieceDef {
  const p = g.pieces.find((x) => x.id === id);
  if (!p) throw new Error(`Missing piece ${id}`);
  return p;
}

/**
 * Builds the flat-lay tee from the garment's front/back bodies and the sleeves sewn to their
 * armholes (found through the seam table). `side` only selects which inside textures apply later.
 */
export function buildGarmentGeometry(g: GarmentModel, options: BuildOptions = {}): GarmentGeometry {
  const opts: Required<BuildOptions> = { stepMm: 6, wrinkles: 0.5, ao: true, ...options };
  const front = pieceOf(g, 'front');
  const back = pieceOf(g, 'back');
  const fb = bbox(front.outlineMm);
  const cx = fb.w / 2;
  const cy = fb.h / 2;

  const toWorld =
    (view: 'front' | 'back') =>
    (p: Vec, z: number): [number, number, number] =>
      view === 'front'
        ? [(p[0] - cx) * MM, -(p[1] - cy) * MM, z * MM]
        : [-(p[0] - cx) * MM, -(p[1] - cy) * MM, -z * MM];

  const panels: PanelGeometry[] = [];
  for (const [view, body] of [
    ['front', front],
    ['back', back],
  ] as const) {
    panels.push(
      buildRegion(
        {
          poly: body.outlineMm,
          toView: [1, 0, 0, 1, 0, 0],
          uv: uvOf(body),
          gridOrigin: [0, 0],
          depth: BODY_DEPTH,
          round: BODY_ROUND,
        },
        opts.stepMm,
        view,
        toWorld(view),
        opts,
        `${view}:${body.id}`,
        body.id,
      ),
    );

    // Sleeves sewn to this body's armholes: map the visible half of the sleeve pattern into the body frame.
    for (const s of g.seams) {
      if (s.a.piece !== body.id) continue;
      const sleeve = g.pieces.find((p) => p.id === s.b.piece && p.role.startsWith('sleeve'));
      if (!sleeve) continue;
      const sh = body.outlineMm[s.a.from]!;
      const arm = body.outlineMm[s.a.to]!;
      const top = sleeve.outlineMm[s.b.from]!;
      const cap = sleeve.outlineMm[s.b.to]!;
      const sb = bbox(sleeve.outlineMm);
      const outward = arm[0] < cx ? -1 : 1;
      const a = (SLEEVE_DROP_DEG * Math.PI) / 180;
      const dir: Vec = [outward * Math.cos(a), Math.sin(a)];
      const m = affineFrom3(
        [top, cap, [top[0], top[1] + sb.h]],
        [sh, arm, [sh[0] + dir[0] * sb.h, sh[1] + dir[1] * sb.h]],
      );
      const fold = top[0];
      const leftHalf = cap[0] < fold;
      panels.push(
        buildRegion(
          {
            poly: sleeve.outlineMm,
            toView: m,
            uv: uvOf(sleeve),
            keep: (p) => (leftHalf ? p[0] <= fold + 1e-6 : p[0] >= fold - 1e-6),
            foldDist: (p) => Math.abs(p[0] - fold),
            gridOrigin: [fold, 0],
            depth: SLEEVE_DEPTH,
            round: SLEEVE_ROUND,
          },
          opts.stepMm,
          view,
          toWorld(view),
          opts,
          `${view}:${sleeve.id}`,
          sleeve.id,
        ),
      );
    }
  }

  // Neck openings: outline points near the top between the neck points, sorted left → right.
  const necklines = (['front', 'back'] as const).map((view) => {
    const body = view === 'front' ? front : back;
    const b = bbox(body.outlineMm);
    const pts = body.outlineMm
      .filter(([x, y]) => y > 0.5 && y < b.h * 0.2 && x > b.w * 0.25 && x < b.w * 0.75)
      .slice()
      .sort((p, q) => p[0] - q[0]);
    const tw = toWorld(view);
    const edge = [body.outlineMm.find(([x, y]) => y === 0 && x < cx), body.outlineMm.find(([x, y]) => y === 0 && x > cx)];
    const all = [edge[0] ?? pts[0]!, ...pts, edge[1] ?? pts[pts.length - 1]!];
    return { view, points: all.map((p) => tw(p, 4)) };
  });

  const neckTopY = cy * MM;
  const backNeck = Math.max(...back.outlineMm.filter(([x]) => Math.abs(x - cx) < 5).map(([, y]) => (y < fb.h * 0.2 ? y : 0)));
  return {
    panels,
    necklines,
    anchors: {
      neckTop: [0, neckTopY, 0],
      shoulderL: [(35 - cx) * MM, -(40 - cy) * MM, 0],
      shoulderR: [(fb.w - 35 - cx) * MM, -(40 - cy) * MM, 0],
      labelCentre: [0, -(backNeck + 24 - cy) * MM, -6 * MM],
    },
    size: { w: (fb.w + 2 * 200) * MM, h: fb.h * MM },
  };
}

/** Which texture each panel uses for its outer and inner face. */
export function panelTextureKeys(p: PanelGeometry): { outer: TextureKey; inner: TextureKey } {
  return { outer: { pieceId: p.pieceId, side: 'outside' }, inner: { pieceId: p.pieceId, side: 'inside' } };
}

export interface TextureKey {
  pieceId: string;
  side: Side;
}
