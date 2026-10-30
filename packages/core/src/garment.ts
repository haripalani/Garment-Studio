import type { Vec } from './geometry';

export type Side = 'outside' | 'inside';
export type Localised = Readonly<Record<string, string>>;

export type PresetId =
  | 'chest'
  | 'leftChest'
  | 'frontBottom'
  | 'back'
  | 'backNeck'
  | 'rightSleeve'
  | 'leftSleeve'
  | 'label'
  | 'printedLabel';

export const PRESET_IDS: readonly PresetId[] = [
  'chest',
  'leftChest',
  'frontBottom',
  'back',
  'backNeck',
  'rightSleeve',
  'leftSleeve',
  'label',
  'printedLabel',
];

export interface PieceDef {
  id: string;
  role: string;
  name: Localised;
  /** Closed outline in the piece's own frame (mm, origin = bbox top-left, y down), clockwise on screen. */
  outlineMm: readonly Vec[];
  cut: number;
  sides: readonly Side[];
  /** Top-left of the piece on the sewing sheet, per side (mm). */
  layoutMm: Partial<Record<Side, Vec>>;
  /** Draw the dashed centre line (symmetric pieces). */
  centreLine?: boolean;
}

/** Two outline chords sewn together. a0 meets b0 and a1 meets b1 (vertex indices into each outline). */
export interface SeamDef {
  a: { piece: string; from: number; to: number };
  b: { piece: string; from: number; to: number };
}

export interface PresetDef {
  piece: string;
  side: Side;
  /** Centre as a fraction of the piece bbox, width as a fraction of the piece width. */
  fx: number;
  fy: number;
  fw: number;
}

export interface GarmentModel {
  id: string;
  version: string;
  category: string;
  name: Localised;
  cut: Localised;
  /** True for generated development garments that are never shipped in the catalogue. */
  dev?: boolean;
  pieces: readonly PieceDef[];
  seams: readonly SeamDef[];
  presets: Partial<Record<PresetId, PresetDef>>;
}

export function pieceById(g: GarmentModel, id: string): PieceDef | undefined {
  return g.pieces.find((p) => p.id === id);
}

export function piecesOnSide(g: GarmentModel, side: Side): PieceDef[] {
  return g.pieces.filter((p) => p.sides.includes(side) && p.layoutMm[side]);
}
