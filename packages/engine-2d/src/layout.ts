import {
  apply,
  bbox,
  boxCorners,
  compose,
  deg2rad,
  invert,
  pointInPolygon,
  piecesOnSide,
  rotate,
  scale,
  translate,
  unionBox,
  type Box,
  type GarmentModel,
  type Layer,
  type Mat,
  type PieceDef,
  type Side,
  type Vec,
} from '@gs/core';

/** A piece placed on the sewing sheet for one side. */
export interface PieceFrame {
  piece: PieceDef;
  side: Side;
  /** Outline in the piece frame. Inside faces are mirrored (seen from the inside). */
  outline: readonly Vec[];
  w: number;
  h: number;
  /** Piece frame → sheet. */
  toSheet: Mat;
  /** Outline in sheet coordinates. */
  sheetOutline: readonly Vec[];
  bounds: Box;
}

const cache = new WeakMap<GarmentModel, Partial<Record<Side, PieceFrame[]>>>();

export function pieceFrames(g: GarmentModel, side: Side): PieceFrame[] {
  const entry = cache.get(g) ?? {};
  const hit = entry[side];
  if (hit) return hit;
  const frames = piecesOnSide(g, side).map((piece) => {
    const b = bbox(piece.outlineMm);
    const outline =
      side === 'inside' ? piece.outlineMm.map(([x, y]) => [b.w - x, y] as Vec) : piece.outlineMm;
    const [ox, oy] = piece.layoutMm[side]!;
    const toSheet = translate(ox, oy);
    const sheetOutline = outline.map((p) => apply(toSheet, p));
    return { piece, side, outline, w: b.w, h: b.h, toSheet, sheetOutline, bounds: bbox(sheetOutline) };
  });
  entry[side] = frames;
  cache.set(g, entry);
  return frames;
}

export function frameFor(g: GarmentModel, side: Side, pieceId: string): PieceFrame | undefined {
  return pieceFrames(g, side).find((f) => f.piece.id === pieceId);
}

export function sheetBounds(g: GarmentModel, side: Side): Box {
  return unionBox(pieceFrames(g, side).map((f) => f.bounds));
}

/** Layer box (centred at the origin) → piece frame. */
export function layerToPiece(l: Pick<Layer, 'x' | 'y' | 'rotationDeg' | 'flipX'>): Mat {
  return compose(translate(l.x, l.y), rotate(deg2rad(l.rotationDeg)), scale(l.flipX ? -1 : 1, 1));
}

/** Layer box → sheet. */
export function layerToSheet(l: Layer, frame: PieceFrame): Mat {
  return compose(frame.toSheet, layerToPiece(l));
}

export function layerCorners(l: Layer, frame: PieceFrame): [Vec, Vec, Vec, Vec] {
  return boxCorners(layerToSheet(l, frame), l.w, l.h);
}

/** Topmost piece under a sheet point. */
export function pieceAt(g: GarmentModel, side: Side, p: Vec): PieceFrame | undefined {
  return pieceFrames(g, side).find((f) => pointInPolygon(p, f.sheetOutline));
}

/** Convert a sheet point into a piece frame. */
export function sheetToPiece(frame: PieceFrame, p: Vec): Vec {
  return apply(invert(frame.toSheet), p);
}

/** Topmost visible layer on `side` whose box contains the sheet point (layers[0] is the top). */
export function hitLayer(g: GarmentModel, layers: readonly Layer[], side: Side, p: Vec): Layer | undefined {
  for (const l of layers) {
    if (!l.visible || l.side !== side) continue;
    const frame = frameFor(g, side, l.pieceId);
    if (!frame) continue;
    const local = apply(invert(layerToSheet(l, frame)), p);
    if (Math.abs(local[0]) <= l.w / 2 && Math.abs(local[1]) <= l.h / 2) return l;
  }
  return undefined;
}

/**
 * Re-express a layer in another piece's frame keeping its sheet position and size
 * (used when a layer is dragged from one piece onto another).
 */
export function reparent<L extends Layer>(l: L, from: PieceFrame, to: PieceFrame): L {
  const centreSheet = apply(from.toSheet, [l.x, l.y]);
  const [x, y] = apply(invert(to.toSheet), centreSheet);
  return { ...l, pieceId: to.piece.id, x, y };
}
