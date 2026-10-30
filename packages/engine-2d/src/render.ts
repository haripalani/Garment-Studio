import {
  apply,
  compose,
  formatLength,
  type GarmentModel,
  type ImageLayer,
  type Layer,
  type Mat,
  type Side,
  type Unit,
  type Vec,
} from '@gs/core';
import { drawLayerContent, drawUncroppedImage, type DrawEnv } from './drawLayer';
import { frameFor, layerCorners, layerToPiece, layerToSheet, pieceFrames, type PieceFrame } from './layout';
import { fabricStyle, rgba, type Ctx2D } from './paint';
import { seamLinks } from './seams';
import { pxPerMm, toScreen, viewMatrix, type View } from './view';

export interface SheetStyle {
  mat: string;
  dot: string;
  pieceLine: string;
  label: string;
  labelMuted: string;
  accent: string;
  accentInk: string;
  rulerBg: string;
  rulerLine: string;
  rulerText: string;
}

export interface Fabric {
  mode: 'solid' | 'gradient';
  color: string;
  gradientTo: string;
}

export interface SheetScene {
  garment: GarmentModel;
  layers: readonly Layer[];
  side: Side;
  fabric: Fabric;
  markings: boolean;
  unit: Unit;
  env: DrawEnv;
}

/** Layers to draw on `frame`: its own, plus wrap-over-seams overflow from neighbouring pieces. */
function* layersForPiece(scene: SheetScene, frame: PieceFrame): Generator<{ layer: Layer; m: Mat }> {
  const links = seamLinks(scene.garment, scene.side).filter((l) => l.to === frame.piece.id);
  // layers[0] is the top of the stack → draw bottom-up.
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i]!;
    if (!layer.visible || layer.side !== scene.side) continue;
    if (layer.pieceId === frame.piece.id) {
      yield { layer, m: layerToPiece(layer) };
    } else if (layer.wrap.on) {
      for (const link of links) {
        if (link.from === layer.pieceId) yield { layer, m: compose(link.m, layerToPiece(layer)) };
      }
    }
  }
}

function outlinePath(ctx: Ctx2D, pts: readonly Vec[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/**
 * Draws one piece's printable content (fabric + artwork, clipped) in the piece frame.
 * Shared by the screen renderer and print/texture baking so all three always match.
 */
export function drawPieceContent(
  ctx: Ctx2D,
  scene: SheetScene,
  frame: PieceFrame,
  opts: { background: boolean; bleedMm?: number },
): void {
  const bleed = opts.bleedMm ?? 0;
  ctx.save();
  if (bleed > 0) {
    // Bleed: paint unclipped, then keep only the outline grown by `bleed` (fill + 2×bleed stroke).
    if (opts.background) {
      ctx.fillStyle = fabricStyle(ctx, scene.fabric, -bleed, frame.h + bleed);
      ctx.fillRect(-bleed, -bleed, frame.w + bleed * 2, frame.h + bleed * 2);
    }
    drawLayers(ctx, scene, frame);
    ctx.globalCompositeOperation = 'destination-in';
    outlinePath(ctx, frame.outline);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.lineWidth = bleed * 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.stroke();
  } else {
    outlinePath(ctx, frame.outline);
    if (opts.background) {
      ctx.fillStyle = fabricStyle(ctx, scene.fabric, 0, frame.h);
      ctx.fill();
    }
    ctx.clip();
    drawLayers(ctx, scene, frame);
  }
  ctx.restore();
}

function drawLayers(ctx: Ctx2D, scene: SheetScene, frame: PieceFrame): void {
  for (const { layer, m } of layersForPiece(scene, frame)) {
    ctx.save();
    ctx.transform(...m);
    drawLayerContent(ctx, layer, scene.env);
    ctx.restore();
  }
}

export interface ScreenTarget {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  view: View;
  style: SheetStyle;
}

const RULER = 20;

function setScreen(t: ScreenTarget): void {
  t.ctx.setTransform(t.dpr, 0, 0, t.dpr, 0, 0);
}

function setSheet(t: ScreenTarget): void {
  const m = viewMatrix(t.view);
  t.ctx.setTransform(m[0] * t.dpr, 0, 0, m[3] * t.dpr, m[4] * t.dpr, m[5] * t.dpr);
}

function drawDots(t: ScreenTarget): void {
  const { ctx, view, style } = t;
  const k = pxPerMm(view);
  let step = 10;
  while (step * k < 14) step *= 2;
  const x0 = Math.floor(-view.panX / k / step) * step;
  const y0 = Math.floor(-view.panY / k / step) * step;
  ctx.fillStyle = style.dot;
  for (let x = x0; x * k + view.panX < t.width; x += step) {
    for (let y = y0; y * k + view.panY < t.height; y += step) {
      ctx.fillRect(Math.round(x * k + view.panX) - 0.5, Math.round(y * k + view.panY) - 0.5, 1.4, 1.4);
    }
  }
}

function pieceLabel(frame: PieceFrame, unit: Unit): [string, string] {
  const name = frame.piece.name.en ?? frame.piece.id;
  const dims = `${formatLength(frame.w, unit, false)} × ${formatLength(frame.h, unit)} · cut ${frame.piece.cut}`;
  return [frame.side === 'inside' ? `${name} · inside` : name, dims];
}

/** The whole sewing sheet for the current side: dots, pieces, artwork, markings and labels. */
export function renderSheet(t: ScreenTarget, scene: SheetScene): void {
  const { ctx, style } = t;
  setScreen(t);
  ctx.fillStyle = style.mat;
  ctx.fillRect(0, 0, t.width, t.height);
  drawDots(t);

  const frames = pieceFrames(scene.garment, scene.side);
  const k = pxPerMm(t.view);
  for (const frame of frames) {
    setSheet(t);
    ctx.transform(...frame.toSheet);
    drawPieceContent(ctx, scene, frame, { background: true });
    outlinePath(ctx, frame.outline);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = style.pieceLine;
    ctx.stroke();
    if (scene.markings && frame.piece.centreLine) {
      ctx.beginPath();
      ctx.moveTo(frame.w / 2, 0);
      ctx.lineTo(frame.w / 2, frame.h);
      ctx.setLineDash([4 / k, 4 / k]);
      ctx.strokeStyle = rgba('#ffffff', 0.35);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Labels in screen space (constant size). Short pieces get the label above.
  setScreen(t);
  ctx.textAlign = 'center';
  for (const frame of frames) {
    const [name, dims] = pieceLabel(frame, scene.unit);
    const cx = frame.bounds.x + frame.bounds.w / 2;
    const above = frame.h < 60;
    const [sx, sy] = toScreen(t.view, [cx, above ? frame.bounds.y : frame.bounds.y + frame.bounds.h]);
    if (sx < -200 || sx > t.width + 200) continue;
    ctx.font = '600 12px "Inter Variable", Inter, sans-serif';
    ctx.fillStyle = style.label;
    if (above) {
      ctx.textBaseline = 'bottom';
      ctx.fillText(name, sx, sy - 5);
    } else {
      ctx.textBaseline = 'top';
      ctx.fillText(name, sx, sy + 6);
      ctx.font = '400 11px "Inter Variable", Inter, sans-serif';
      ctx.fillStyle = style.labelMuted;
      ctx.fillText(dims, sx, sy + 22);
    }
  }
}

export type HandleId = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | 'rotate';

export interface SelectionGeometry {
  /** Screen-space corners TL, TR, BR, BL. */
  corners: [Vec, Vec, Vec, Vec];
  rotateHandle: Vec;
  centre: Vec;
}

export function selectionGeometry(view: View, garment: GarmentModel, layer: Layer): SelectionGeometry | null {
  const frame = frameFor(garment, layer.side, layer.pieceId);
  if (!frame) return null;
  const corners = layerCorners(layer, frame).map((p) => toScreen(view, p)) as [Vec, Vec, Vec, Vec];
  const [tl, tr] = corners;
  const mid: Vec = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
  const centre: Vec = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
  const dx = mid[0] - centre[0];
  const dy = mid[1] - centre[1];
  const len = Math.hypot(dx, dy) || 1;
  const rotateHandle: Vec = [mid[0] + (dx / len) * 22, mid[1] + (dy / len) * 22];
  return { corners, rotateHandle, centre };
}

/** Ghost of the full selected layer (shows overflow past the piece), box, handles and size badge. */
export function renderSelection(
  t: ScreenTarget,
  scene: SheetScene,
  layer: Layer,
  opts: { crop?: boolean },
): void {
  const { ctx, style } = t;
  const frame = frameFor(scene.garment, layer.side, layer.pieceId);
  if (!frame) return;

  setSheet(t);
  ctx.transform(...layerToSheet(layer, frame));
  ctx.globalAlpha = 0.35;
  if (opts.crop && layer.type === 'image') drawUncroppedImage(ctx, layer as ImageLayer, scene.env);
  else drawLayerContent(ctx, layer, scene.env);
  ctx.globalAlpha = 1;

  const g = selectionGeometry(t.view, scene.garment, layer);
  if (!g) return;
  setScreen(t);
  ctx.beginPath();
  g.corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = style.accent;
  if (opts.crop) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  const handles: Vec[] = opts.crop ? [...g.corners, ...edgeMids(g.corners)] : g.corners;
  for (const [x, y] of handles) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeRect(x - 4, y - 4, 8, 8);
  }
  if (!opts.crop) {
    const [mx, my] = midpoint(g.corners[0], g.corners[1]);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(g.rotateHandle[0], g.rotateHandle[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(g.rotateHandle[0], g.rotateHandle[1], 6, 0, Math.PI * 2);
    ctx.fillStyle = style.accent;
    ctx.fill();
  }

  // Size badge under the lowest corner.
  const text = `${formatLength(layer.w, scene.unit, false)} × ${formatLength(layer.h, scene.unit)}`;
  ctx.font = '600 11px "Inter Variable", Inter, sans-serif';
  const tw = ctx.measureText(text).width + 12;
  const bottom = Math.max(...g.corners.map((c) => c[1]));
  const bx = g.centre[0] - tw / 2;
  const by = bottom + 10;
  ctx.fillStyle = style.accent;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw, 18, 9);
  ctx.fill();
  ctx.fillStyle = style.accentInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, g.centre[0], by + 9.5);
}

export function midpoint(a: Vec, b: Vec): Vec {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Edge midpoints N, E, S, W for corners TL, TR, BR, BL. */
export function edgeMids(c: readonly [Vec, Vec, Vec, Vec]): [Vec, Vec, Vec, Vec] {
  return [midpoint(c[0], c[1]), midpoint(c[1], c[2]), midpoint(c[2], c[3]), midpoint(c[3], c[0])];
}

/** Rubber-band preview while drawing a shape (sheet rectangle). */
export function renderDraft(t: ScreenTarget, a: Vec, b: Vec): void {
  setScreen(t);
  const [x0, y0] = toScreen(t.view, a);
  const [x1, y1] = toScreen(t.view, b);
  t.ctx.setLineDash([5, 4]);
  t.ctx.strokeStyle = t.style.accent;
  t.ctx.lineWidth = 1.5;
  t.ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  t.ctx.setLineDash([]);
}

const MM_PER: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 };

function rulerStep(unit: Unit, k: number): { major: number; minor: number } {
  const u = MM_PER[unit];
  const steps =
    unit === 'in'
      ? [1, 2, 5, 10, 20, 50]
      : unit === 'mm'
        ? [10, 25, 50, 100, 250, 500, 1000]
        : [1, 2.5, 5, 10, 25, 50, 100];
  const major = (steps.find((s) => s * u * k >= 60) ?? steps[steps.length - 1]!) * u;
  return { major, minor: major / 5 };
}

/** Top and left rulers in the current unit. */
export function renderRulers(t: ScreenTarget, unit: Unit, cursor?: Vec): void {
  const { ctx, view, style } = t;
  setScreen(t);
  const k = pxPerMm(view);
  const { major, minor } = rulerStep(unit, k);
  ctx.fillStyle = style.rulerBg;
  ctx.fillRect(0, 0, t.width, RULER);
  ctx.fillRect(0, 0, RULER, t.height);
  ctx.strokeStyle = style.rulerLine;
  ctx.fillStyle = style.rulerText;
  ctx.font = '400 10px "Inter Variable", Inter, sans-serif';
  ctx.lineWidth = 1;
  ctx.beginPath();

  const first = (pan: number) => Math.floor(-pan / k / minor) * minor;
  for (let mm = first(view.panX); mm * k + view.panX < t.width; mm += minor) {
    const x = Math.round(mm * k + view.panX) + 0.5;
    if (x < RULER) continue;
    const isMajor = Math.abs(mm / major - Math.round(mm / major)) < 1e-6;
    ctx.moveTo(x, RULER);
    ctx.lineTo(x, isMajor ? 6 : RULER - 5);
    if (isMajor) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(+(mm / MM_PER[unit]).toFixed(2)), x + 3, 3);
    }
  }
  for (let mm = first(view.panY); mm * k + view.panY < t.height; mm += minor) {
    const y = Math.round(mm * k + view.panY) + 0.5;
    if (y < RULER) continue;
    const isMajor = Math.abs(mm / major - Math.round(mm / major)) < 1e-6;
    ctx.moveTo(RULER, y);
    ctx.lineTo(isMajor ? 6 : RULER - 5, y);
    if (isMajor) {
      ctx.save();
      ctx.translate(3, y + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(String(+(mm / MM_PER[unit]).toFixed(2)), 0, 0);
      ctx.restore();
    }
  }
  ctx.moveTo(0, RULER + 0.5);
  ctx.lineTo(t.width, RULER + 0.5);
  ctx.moveTo(RULER + 0.5, 0);
  ctx.lineTo(RULER + 0.5, t.height);
  ctx.stroke();

  if (cursor) {
    const [cx, cy] = toScreen(view, cursor);
    ctx.strokeStyle = style.accent;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, 0);
    ctx.lineTo(Math.round(cx) + 0.5, RULER);
    ctx.moveTo(0, Math.round(cy) + 0.5);
    ctx.lineTo(RULER, Math.round(cy) + 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = style.rulerBg;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.fillStyle = style.rulerText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(unit, RULER / 2, RULER / 2);
}

export const RULER_SIZE = RULER;

/** Sheet point of a piece-frame point (used by the editor for read-outs). */
export function pieceToSheet(frame: PieceFrame, p: Vec): Vec {
  return apply(frame.toSheet, p);
}
