// Procedural development garment (ADR-0007 fallback). Plausible tee pattern proportions so the
// 2D editor, wrap-over-seams and (Stage 5) the procedural 3D tee can be built before real assets exist.
// Never shipped as a catalogue item (`dev: true`).
import { bbox, cubic, signedArea, type Vec } from './geometry';
import type { GarmentModel, PieceDef, SeamDef } from './garment';

/** Builds a polyline while recording the indices of named vertices. */
class Outline {
  pts: Vec[] = [];
  marks: Record<string, number> = {};
  move(p: Vec, mark?: string) {
    this.pts.push(p);
    if (mark) this.marks[mark] = this.pts.length - 1;
    return this;
  }
  line(p: Vec, mark?: string) {
    return this.move(p, mark);
  }
  curve(c1: Vec, c2: Vec, p: Vec, mark?: string, steps = 12) {
    const from = this.pts[this.pts.length - 1]!;
    const s = cubic(from, c1, c2, p, steps);
    this.pts.push(...s);
    if (mark) this.marks[mark] = this.pts.length - 1;
    return this;
  }
}

interface BodyOpts {
  w: number;
  h: number;
  neckW: number;
  neckD: number;
  inset: number;
  slope: number;
  armD: number;
}

/** Front/back body. Vertex marks: neckL, shL, armL, hemL, hemR, armR, shR, neckR. Clockwise on screen. */
function body(o: BodyOpts): Outline {
  const cx = o.w / 2;
  const nl: Vec = [cx - o.neckW / 2, 0];
  const nr: Vec = [cx + o.neckW / 2, 0];
  const shL: Vec = [o.inset, o.slope];
  const shR: Vec = [o.w - o.inset, o.slope];
  const out = new Outline()
    .move(nl, 'neckL')
    .line(shL, 'shL')
    .curve([o.inset + 4, o.slope + o.armD * 0.45], [o.inset * 0.35, o.armD - 6], [0, o.armD], 'armL')
    .line([0, o.h], 'hemL')
    .line([o.w, o.h], 'hemR')
    .line([o.w, o.armD], 'armR')
    .curve([o.w - o.inset * 0.35, o.armD - 6], [o.w - o.inset - 4, o.slope + o.armD * 0.45], shR, 'shR')
    .line(nr, 'neckR');
  // Neck scoop back to neckL (closing segment is implicit).
  const scoop = cubic(nr, [nr[0], o.neckD * 0.75], [cx + o.neckW * 0.28, o.neckD], [cx, o.neckD], 10).concat(
    cubic([cx, o.neckD], [cx - o.neckW * 0.28, o.neckD], [nl[0], o.neckD * 0.75], nl, 10).slice(0, -1),
  );
  out.pts.push(...scoop);
  return out;
}

/** Sleeve: cap on top, hem at the bottom. Marks: capL, top, capR, hemR, hemL. */
function sleeve(w: number, len: number, capH: number, hemInset: number): Outline {
  return new Outline()
    .move([0, capH], 'capL')
    .curve([w * 0.12, capH * 0.35], [w * 0.3, 0], [w / 2, 0], 'top')
    .curve([w * 0.7, 0], [w * 0.88, capH * 0.35], [w, capH], 'capR')
    .line([w - hemInset, len], 'hemR')
    .line([hemInset, len], 'hemL');
}

function rect(w: number, h: number): Outline {
  return new Outline().move([0, 0], 'tl').line([w, 0], 'tr').line([w, h], 'br').line([0, h], 'bl');
}

function normalise(o: Outline): { pts: Vec[]; marks: Record<string, number> } {
  // Translate to bbox origin and force clockwise winding so seam transforms are proper rotations.
  const b = bbox(o.pts);
  let pts = o.pts.map(([x, y]) => [x - b.x, y - b.y] as Vec);
  let marks = { ...o.marks };
  if (signedArea(pts) < 0) {
    const n = pts.length;
    pts = pts.slice().reverse();
    marks = Object.fromEntries(Object.entries(marks).map(([k, i]) => [k, n - 1 - i]));
  }
  return { pts, marks };
}

const EN = (s: string) => ({ en: s });

export function createDevTee(): GarmentModel {
  const W = 530;
  const H = 730;
  const front = normalise(body({ w: W, h: H, neckW: 170, neckD: 85, inset: 35, slope: 40, armD: 235 }));
  const back = normalise(body({ w: W, h: H, neckW: 170, neckD: 22, inset: 35, slope: 40, armD: 235 }));
  const sl = normalise(sleeve(370, 220, 100, 22));
  const sr = normalise(sleeve(370, 220, 100, 22));

  const pieces: PieceDef[] = [
    {
      id: 'front',
      role: 'front',
      name: EN('Front'),
      outlineMm: front.pts,
      cut: 1,
      sides: ['outside', 'inside'],
      layoutMm: { outside: [0, 590], inside: [0, 60] },
      centreLine: true,
    },
    {
      id: 'back',
      role: 'back',
      name: EN('Back'),
      outlineMm: back.pts,
      cut: 1,
      sides: ['outside', 'inside'],
      layoutMm: { outside: [600, 590], inside: [600, 60] },
      centreLine: true,
    },
    {
      id: 'sleeveR',
      role: 'sleeveR',
      name: EN('Right sleeve'),
      outlineMm: sr.pts,
      cut: 1,
      sides: ['outside', 'inside'],
      layoutMm: { outside: [80, 200], inside: [80, 960] },
      centreLine: true,
    },
    {
      id: 'sleeveL',
      role: 'sleeveL',
      name: EN('Left sleeve'),
      outlineMm: sl.pts,
      cut: 1,
      sides: ['outside', 'inside'],
      layoutMm: { outside: [680, 200], inside: [680, 960] },
      centreLine: true,
    },
    {
      id: 'ribFront',
      role: 'rib',
      name: EN('Neck rib · front'),
      outlineMm: normalise(rect(230, 22)).pts,
      cut: 1,
      sides: ['outside'],
      layoutMm: { outside: [150, 60] },
    },
    {
      id: 'ribBack',
      role: 'rib',
      name: EN('Neck rib · back'),
      outlineMm: normalise(rect(200, 22)).pts,
      cut: 1,
      sides: ['outside'],
      layoutMm: { outside: [765, 60] },
    },
    {
      id: 'label',
      role: 'label',
      name: EN('Label'),
      outlineMm: normalise(rect(50, 34)).pts,
      cut: 1,
      sides: ['inside'],
      layoutMm: { inside: [540, 60] },
    },
    {
      id: 'hemFront',
      role: 'facing',
      name: EN('Hem facing · front'),
      outlineMm: normalise(rect(530, 30)).pts,
      cut: 1,
      sides: ['inside'],
      layoutMm: { inside: [0, 1520] },
    },
    {
      id: 'hemBack',
      role: 'facing',
      name: EN('Hem facing · back'),
      outlineMm: normalise(rect(530, 30)).pts,
      cut: 1,
      sides: ['inside'],
      layoutMm: { inside: [600, 1520] },
    },
    {
      id: 'hemSleeveR',
      role: 'facing',
      name: EN('Right sleeve hem facing'),
      outlineMm: normalise(rect(326, 25)).pts,
      cut: 1,
      sides: ['inside'],
      layoutMm: { inside: [102, 1360] },
    },
    {
      id: 'hemSleeveL',
      role: 'facing',
      name: EN('Left sleeve hem facing'),
      outlineMm: normalise(rect(326, 25)).pts,
      cut: 1,
      sides: ['inside'],
      layoutMm: { inside: [702, 1360] },
    },
  ];

  const m = (o: { marks: Record<string, number> }, k: string) => {
    const i = o.marks[k];
    if (i === undefined) throw new Error(`Missing mark ${k}`);
    return i;
  };

  // Front left (viewer) = wearer's right; it meets the back's right (viewer from behind) = wearer's right.
  const seams: SeamDef[] = [
    // Shoulders: neck point to neck point, shoulder tip to shoulder tip.
    {
      a: { piece: 'front', from: m(front, 'neckL'), to: m(front, 'shL') },
      b: { piece: 'back', from: m(back, 'neckR'), to: m(back, 'shR') },
    },
    {
      a: { piece: 'front', from: m(front, 'neckR'), to: m(front, 'shR') },
      b: { piece: 'back', from: m(back, 'neckL'), to: m(back, 'shL') },
    },
    // Side seams: underarm to underarm, hem to hem.
    {
      a: { piece: 'front', from: m(front, 'armL'), to: m(front, 'hemL') },
      b: { piece: 'back', from: m(back, 'armR'), to: m(back, 'hemR') },
    },
    {
      a: { piece: 'front', from: m(front, 'armR'), to: m(front, 'hemR') },
      b: { piece: 'back', from: m(back, 'armL'), to: m(back, 'hemL') },
    },
    // Armholes to sleeve caps (chords): shoulder tip meets the cap top, underarm meets the cap corner.
    {
      a: { piece: 'front', from: m(front, 'shL'), to: m(front, 'armL') },
      b: { piece: 'sleeveR', from: m(sr, 'top'), to: m(sr, 'capL') },
    },
    {
      a: { piece: 'back', from: m(back, 'shR'), to: m(back, 'armR') },
      b: { piece: 'sleeveR', from: m(sr, 'top'), to: m(sr, 'capR') },
    },
    {
      a: { piece: 'front', from: m(front, 'shR'), to: m(front, 'armR') },
      b: { piece: 'sleeveL', from: m(sl, 'top'), to: m(sl, 'capR') },
    },
    {
      a: { piece: 'back', from: m(back, 'shL'), to: m(back, 'armL') },
      b: { piece: 'sleeveL', from: m(sl, 'top'), to: m(sl, 'capL') },
    },
  ];

  return {
    id: 'dev-tee',
    version: '0.1.0',
    category: 'tee',
    name: EN('Development tee'),
    cut: EN('Procedural · crew neck'),
    dev: true,
    pieces,
    seams,
    presets: {
      chest: { piece: 'front', side: 'outside', fx: 0.5, fy: 0.33, fw: 0.45 },
      leftChest: { piece: 'front', side: 'outside', fx: 0.7, fy: 0.24, fw: 0.16 },
      frontBottom: { piece: 'front', side: 'outside', fx: 0.5, fy: 0.8, fw: 0.4 },
      back: { piece: 'back', side: 'outside', fx: 0.5, fy: 0.32, fw: 0.5 },
      backNeck: { piece: 'back', side: 'outside', fx: 0.5, fy: 0.1, fw: 0.16 },
      rightSleeve: { piece: 'sleeveR', side: 'outside', fx: 0.36, fy: 0.62, fw: 0.28 },
      leftSleeve: { piece: 'sleeveL', side: 'outside', fx: 0.64, fy: 0.62, fw: 0.28 },
      label: { piece: 'label', side: 'inside', fx: 0.5, fy: 0.5, fw: 0.8 },
      printedLabel: { piece: 'back', side: 'inside', fx: 0.5, fy: 0.09, fw: 0.18 },
    },
  };
}
