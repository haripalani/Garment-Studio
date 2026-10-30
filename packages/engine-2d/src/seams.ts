import { invert, similarityFromSegments, type GarmentModel, type Mat, type Side } from '@gs/core';
import { pieceFrames } from './layout';

/** Maps points in `from`'s piece frame to `to`'s piece frame, flattened across a seam. */
export interface SeamLink {
  from: string;
  to: string;
  m: Mat;
}

const cache = new WeakMap<GarmentModel, Partial<Record<Side, SeamLink[]>>>();

/**
 * Wrap-over-seams transforms for one side. Each seam chord of piece A is mapped onto the chord of
 * piece B it is sewn to, so artwork running off A continues on B as it will after sewing.
 * Both directions are returned.
 */
export function seamLinks(g: GarmentModel, side: Side): SeamLink[] {
  const entry = cache.get(g) ?? {};
  const hit = entry[side];
  if (hit) return hit;
  const frames = new Map(pieceFrames(g, side).map((f) => [f.piece.id, f]));
  const links: SeamLink[] = [];
  for (const s of g.seams) {
    const a = frames.get(s.a.piece);
    const b = frames.get(s.b.piece);
    if (!a || !b) continue;
    const a0 = a.outline[s.a.from];
    const a1 = a.outline[s.a.to];
    const b0 = b.outline[s.b.from];
    const b1 = b.outline[s.b.to];
    if (!a0 || !a1 || !b0 || !b1) continue;
    const m = similarityFromSegments(a0, a1, b0, b1);
    links.push({ from: a.piece.id, to: b.piece.id, m }, { from: b.piece.id, to: a.piece.id, m: invert(m) });
  }
  entry[side] = links;
  cache.set(g, entry);
  return links;
}
