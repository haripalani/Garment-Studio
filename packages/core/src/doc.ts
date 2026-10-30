// ProjectDoc v1 (DATA_MODEL.md §1, ADR-0008). All geometry in millimetres, in the layer's piece frame.
import { z } from 'zod';
import { FACTORY_LOOK, LookSchema, completeLook, type Look } from './look';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = z.string().min(1).max(64);

export const GradientStopSchema = z.object({
  at: z.number().min(0).max(1),
  color: hex,
  alpha: z.number().min(0).max(1),
});

export const PaintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: hex }),
  z.object({
    kind: z.enum(['linear', 'radial']),
    angleDeg: z.number(),
    stops: z.array(GradientStopSchema).min(2).max(5),
  }),
]);

export const SideSchema = z.enum(['outside', 'inside']);

const LayerBase = z.object({
  id,
  name: z.string().max(120),
  visible: z.boolean(),
  pieceId: id,
  side: SideSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotationDeg: z.number(),
  opacity: z.number().min(0).max(1),
  flipX: z.boolean(),
  wrap: z.object({ on: z.boolean(), bleedMm: z.number().min(0).max(50) }),
});

export const CropSchema = z.object({
  l: z.number().min(0).max(1),
  t: z.number().min(0).max(1),
  r: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});

export const ImageLayerSchema = LayerBase.extend({
  type: z.literal('image'),
  assetId: id,
  crop: CropSchema.nullable(),
  adjust: z.object({
    invert: z.boolean(),
    hueDeg: z.number().min(-180).max(180),
    saturation: z.number().min(0).max(2),
    fill: hex.nullable(),
  }),
});

export const TextLayerSchema = LayerBase.extend({
  type: z.literal('text'),
  text: z.string().max(2000),
  font: z.string().min(1).max(80),
  weight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  caps: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().min(0.5).max(3),
  letterSpacing: z.number().min(-0.2).max(1),
  paint: PaintSchema,
});

export const SHAPE_KINDS = [
  'rect',
  'square',
  'circle',
  'triangle',
  'star',
  'diamond',
  'line',
  'dashed-line',
] as const;

export const ShapeLayerSchema = LayerBase.extend({
  type: z.literal('shape'),
  kind: z.enum(SHAPE_KINDS),
  paint: PaintSchema,
  outline: z.object({ on: z.boolean(), thicknessMm: z.number().min(0.2).max(50), dashed: z.boolean() }),
});

export const LayerSchema = z.discriminatedUnion('type', [
  ImageLayerSchema,
  TextLayerSchema,
  ShapeLayerSchema,
]);

export const AssetRefSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().max(255),
});

export const ProjectDocSchema = z.object({
  schema: z.literal('garment-studio/project'),
  schemaVersion: z.literal(2),
  id,
  name: z.string().max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  garment: z.object({ modelId: z.string(), modelVersion: z.string() }),
  layers: z.array(LayerSchema).max(500),
  assets: z.record(z.string(), AssetRefSchema),
  look: LookSchema,
});

export type Paint = z.infer<typeof PaintSchema>;
export type GradientStop = z.infer<typeof GradientStopSchema>;
export type Crop = z.infer<typeof CropSchema>;
export type ImageLayer = z.infer<typeof ImageLayerSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type ShapeLayer = z.infer<typeof ShapeLayerSchema>;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type Layer = z.infer<typeof LayerSchema>;
export type AssetRef = z.infer<typeof AssetRefSchema>;
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;

let counter = 0;
/** Short, sortable, collision-resistant id (cuid2 replaces this when the API exists). */
export function newId(): string {
  counter = (counter + 1) % 1296;
  return (
    Date.now().toString(36) + counter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 8)
  );
}

export const SCHEMA_VERSION = 2;

export function createDoc(modelId: string, modelVersion: string, look: Look = FACTORY_LOOK): ProjectDoc {
  const now = new Date().toISOString();
  return {
    schema: 'garment-studio/project',
    schemaVersion: 2,
    id: newId(),
    name: 'Untitled design',
    createdAt: now,
    updatedAt: now,
    garment: { modelId, modelVersion },
    layers: [],
    assets: {},
    look: structuredClone(look),
  };
}

type Placement = Pick<Layer, 'pieceId' | 'side' | 'x' | 'y' | 'w' | 'h'>;

function base(p: Placement, name: string) {
  return {
    id: newId(),
    name,
    visible: true,
    rotationDeg: 0,
    opacity: 1,
    flipX: false,
    wrap: { on: false, bleedMm: 10 },
    ...p,
  };
}

export function createImageLayer(p: Placement, assetId: string, name: string): ImageLayer {
  return {
    ...base(p, name),
    type: 'image',
    assetId,
    crop: null,
    adjust: { invert: false, hueDeg: 0, saturation: 1, fill: null },
  };
}

export function createTextLayer(p: Placement, text = 'Text'): TextLayer {
  return {
    ...base(p, text),
    type: 'text',
    text,
    font: 'Inter',
    weight: 700,
    italic: false,
    caps: false,
    align: 'center',
    lineHeight: 1.12,
    letterSpacing: 0,
    paint: { kind: 'solid', color: '#ffffff' },
  };
}

export function createShapeLayer(p: Placement, kind: ShapeKind): ShapeLayer {
  const line = kind === 'line' || kind === 'dashed-line';
  return {
    ...base(p, SHAPE_NAMES[kind]),
    type: 'shape',
    kind,
    paint: { kind: 'solid', color: '#ffffff' },
    outline: { on: line, thicknessMm: 3, dashed: kind === 'dashed-line' },
  };
}

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  square: 'Square',
  circle: 'Circle',
  triangle: 'Triangle',
  star: 'Star',
  diamond: 'Diamond',
  line: 'Line',
  'dashed-line': 'Dashed line',
};

/**
 * Migrations: each takes a document of version n and returns version n + 1 (ADR-0008).
 * v1 → v2: the look (fabric, key light, studio scene) moves into the document.
 */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  1: (d) => ({ ...d, schemaVersion: 2, look: completeLook(undefined) }),
};

/** Upgrade an older document to the current schema version (unknown future versions are rejected). */
export function migrateDoc(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  let d = value as Record<string, unknown>;
  let v = typeof d.schemaVersion === 'number' ? d.schemaVersion : NaN;
  while (v < SCHEMA_VERSION && MIGRATIONS[v]) {
    d = MIGRATIONS[v]!(d);
    v = d.schemaVersion as number;
  }
  return d;
}

/** Parse, migrate and validate an unknown value as a current-version ProjectDoc. */
export function parseDoc(value: unknown): ProjectDoc {
  return ProjectDocSchema.parse(migrateDoc(value));
}
