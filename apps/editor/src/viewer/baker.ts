// Bakes pattern pieces into 3D textures with the same engine-2d drawing used on the sheet,
// re-baking only the pieces whose inputs changed (own layers, wrapped-in layers, fabric, assets).
import type { Fabric, GarmentModel, Layer, Side } from '@gs/core';
import { bakePiece, seamLinks, type SheetScene } from '@gs/engine-2d';
import { assetSource } from '../store/assets';

/** Texture resolution for the live preview. Exports bake at 300 DPI (Stage 7). */
export const PREVIEW_PX_PER_MM = 2;

export interface BakeTarget {
  pieceId: string;
  side: Side;
}

type Out = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Out {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Layers that can paint on a piece/side: its own and those wrapping over a seam onto it. */
export function layersAffecting(g: GarmentModel, layers: readonly Layer[], t: BakeTarget): Layer[] {
  const from = new Set(seamLinks(g, t.side).filter((l) => l.to === t.pieceId).map((l) => l.from));
  return layers.filter(
    (l) => l.side === t.side && (l.pieceId === t.pieceId || (l.wrap.on && from.has(l.pieceId))),
  );
}

export function bakeSignature(
  g: GarmentModel,
  layers: readonly Layer[],
  fabric: Fabric,
  assetsVersion: number,
  t: BakeTarget,
): string {
  const ls = layersAffecting(g, layers, t);
  // Stack order matters too, so the signature keeps the document order.
  return JSON.stringify([
    fabric.mode,
    fabric.color,
    fabric.gradientTo,
    fabric.brightness,
    fabric.contrast,
    ls,
    ls.some((l) => l.type === 'image') ? assetsVersion : 0,
  ]);
}

/**
 * Bake one piece. Inside faces are drawn in the mirrored inside frame by engine-2d; they are flipped
 * back here so both faces share the panel's outside-frame UVs.
 */
export function bakeTexture(
  g: GarmentModel,
  layers: readonly Layer[],
  fabric: Fabric,
  t: BakeTarget,
  pxPerMm = PREVIEW_PX_PER_MM,
): Out {
  const scene: SheetScene = {
    garment: g,
    layers,
    side: t.side,
    fabric,
    markings: false,
    unit: 'mm',
    env: { asset: assetSource, fxMaxSide: 2048 },
  };
  const raw = bakePiece(scene, { pieceId: t.pieceId, side: t.side, pxPerMm, background: true });
  const needsFilter = fabric.brightness !== 1 || fabric.contrast !== 1;
  if (t.side === 'outside' && !needsFilter) return raw;
  const out = makeCanvas(raw.width, raw.height);
  const ctx = out.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return raw;
  if (needsFilter) ctx.filter = `brightness(${fabric.brightness}) contrast(${fabric.contrast})`;
  if (t.side === 'inside') ctx.setTransform(-1, 0, 0, 1, raw.width, 0);
  ctx.drawImage(raw, 0, 0);
  return out;
}

/** Pieces shown on the flat-lay tee (bodies and sleeves). */
export const SHOWN_PIECES = ['front', 'back', 'sleeveR', 'sleeveL'];

/** The pieces the 3D garment shows, per face. */
export function bakeTargets(g: GarmentModel, pieceIds: readonly string[]): BakeTarget[] {
  return pieceIds.flatMap((id) => {
    const p = g.pieces.find((x) => x.id === id);
    return p ? p.sides.map((side) => ({ pieceId: id, side })) : [];
  });
}
