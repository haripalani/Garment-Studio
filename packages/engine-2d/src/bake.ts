import type { Side } from '@gs/core';
import { frameFor } from './layout';
import type { Ctx2D } from './paint';
import { drawPieceContent, type SheetScene } from './render';

export interface BakeOptions {
  pieceId: string;
  side: Side;
  /** Output resolution. 300 DPI ≈ 11.81 px/mm. */
  pxPerMm: number;
  /** Fabric colour under the artwork (3D textures) or transparent (print files). */
  background: boolean;
  bleedMm?: number;
}

export type BakedCanvas = OffscreenCanvas | HTMLCanvasElement;

/** OffscreenCanvas where available (workers, most browsers); a detached <canvas> otherwise (some WebKit builds). */
export function createBakeCanvas(w: number, h: number): BakedCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Renders one piece using exactly the same drawing code as the screen.
 * Used for 3D textures (Stage 5) and print / sublimation exports (Stage 7).
 */
export function bakePiece(scene: SheetScene, o: BakeOptions): BakedCanvas {
  const frame = frameFor(scene.garment, o.side, o.pieceId);
  if (!frame) throw new Error(`Piece ${o.pieceId} is not on the ${o.side}`);
  const bleed = o.bleedMm ?? 0;
  const w = Math.max(1, Math.ceil((frame.w + bleed * 2) * o.pxPerMm));
  const h = Math.max(1, Math.ceil((frame.h + bleed * 2) * o.pxPerMm));
  const canvas = createBakeCanvas(w, h);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2D context unavailable');
  ctx.scale(o.pxPerMm, o.pxPerMm);
  ctx.translate(bleed, bleed);
  drawPieceContent(ctx, { ...scene, side: o.side }, frame, { background: o.background, bleedMm: bleed });
  return canvas;
}
