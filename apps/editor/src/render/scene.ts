// A studio ready for final output (renders, videos, spec sheets): the live 3D view when it is open,
// otherwise a temporary one off screen. The cloud render page uses the same code (ADR-0013).
import { BRAND, type GarmentModel, type ProjectDoc } from '@gs/core';
import { Studio } from '@gs/engine-3d';
import { ensureFont } from '../fonts';
import { PREVIEW_PX_PER_MM, SHOWN_PIECES, bakeTargets, bakeTexture } from '../viewer/baker';
import { getStudio } from '../viewer/studioRef';

/** Make sure every font the document uses is loaded, so baked text matches the screen. */
export async function ensureDocFonts(doc: ProjectDoc): Promise<void> {
  await Promise.all(
    doc.layers.flatMap((l) => (l.type === 'text' ? [ensureFont(l.font, l.weight, l.italic)] : [])),
  );
}

/** Bake every visible piece at `pxPerMm` into the studio's textures. */
export function bakeInto(studio: Studio, garment: GarmentModel, doc: ProjectDoc, pxPerMm: number): void {
  for (const t of bakeTargets(garment, SHOWN_PIECES)) {
    studio.setPieceTexture(t.pieceId, t.side, bakeTexture(garment, doc.layers, doc.look.fabric, t, pxPerMm));
  }
}

/**
 * Runs `fn` with a studio showing `doc`. The live studio is borrowed when the 3D view is open (its
 * textures are re-baked at `pxPerMm` and restored afterwards); otherwise a hidden one is created.
 */
export async function withStudio<T>(
  garment: GarmentModel,
  doc: ProjectDoc,
  pxPerMm: number,
  fn: (studio: Studio) => Promise<T>,
): Promise<T> {
  await ensureDocFonts(doc);
  const live = getStudio();
  if (live) {
    if (pxPerMm !== PREVIEW_PX_PER_MM) bakeInto(live, garment, doc, pxPerMm);
    try {
      return await fn(live);
    } finally {
      if (pxPerMm !== PREVIEW_PX_PER_MM) bakeInto(live, garment, doc, PREVIEW_PX_PER_MM);
    }
  }
  const canvas = document.createElement('canvas');
  const studio = new Studio(canvas, { labelText: BRAND.name.toUpperCase() });
  try {
    studio.resize(800, 1000);
    studio.setGarment(garment, doc.look);
    bakeInto(studio, garment, doc, pxPerMm);
    return await fn(studio);
  } finally {
    studio.dispose();
  }
}
