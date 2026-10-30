// Fabric, key light and studio scene ("the look") — part of ProjectDoc from schema v2.
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const MATERIALS = [
  'cotton',
  'cotton-blend',
  'interlock',
  'sport-knit',
  'pique',
  'rib',
  'waffle',
  'fleece',
  'mesh',
] as const;
export const GOBOS = [
  'none',
  'window',
  'blinds',
  'soft-blinds',
  'leaves',
  'palm',
  'branches',
  'stripes',
  'spotlight',
] as const;
export const LABEL_SHAPES = ['small-woven', 'wide', 'square', 'tall-satin', 'loop'] as const;

export const FabricSchema = z.object({
  mode: z.enum(['solid', 'gradient']),
  color: hex,
  gradientTo: hex,
  material: z.enum(MATERIALS),
  ao: z.boolean(),
  wrinkles: z.boolean(),
  wrinkleStrength: z.number().min(0).max(1),
  texture: z.number().min(0).max(1),
  knitScale: z.number().min(1).max(8),
  brightness: z.number().min(0.5).max(1.5),
  contrast: z.number().min(0.5).max(1.5),
});

export const LightSchema = z.object({
  azimuthDeg: z.number().min(-180).max(180),
  elevationDeg: z.number().min(0).max(90),
  power: z.number().min(0).max(6),
});

export const SceneSchema = z.object({
  hdri: z.boolean(),
  hdriIntensity: z.number().min(0).max(3),
  hdriRotationDeg: z.number().min(0).max(360),
  backdrop: z.boolean(),
  backdropShadow: z.boolean(),
  backdropColor: hex,
  gobo: z.enum(GOBOS),
  goboInvert: z.boolean(),
  backdropBrightness: z.number().min(0.5).max(1.5),
  backdropContrast: z.number().min(0.5).max(1.5),
  hanger: z.boolean(),
  hangerColor: hex,
  neckLabel: z.boolean(),
  labelShape: z.enum(LABEL_SHAPES),
  labelColor: hex,
  autoRotate: z.boolean(),
  patternMarkings: z.boolean(),
});

export const LookSchema = z.object({ fabric: FabricSchema, light: LightSchema, scene: SceneSchema });

export type Material = (typeof MATERIALS)[number];
export type Gobo = (typeof GOBOS)[number];
export type LabelShape = (typeof LABEL_SHAPES)[number];
export type Fabric = z.infer<typeof FabricSchema>;
export type KeyLight = z.infer<typeof LightSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Look = z.infer<typeof LookSchema>;

export const FACTORY_LOOK: Look = {
  fabric: {
    mode: 'solid',
    color: '#f2f0ea',
    gradientTo: '#9fb6c9',
    material: 'cotton',
    ao: true,
    wrinkles: true,
    wrinkleStrength: 0.5,
    texture: 0.5,
    knitScale: 3,
    brightness: 1,
    contrast: 1,
  },
  light: { azimuthDeg: 40, elevationDeg: 35, power: 3 },
  scene: {
    hdri: true,
    hdriIntensity: 1.15,
    hdriRotationDeg: 38,
    backdrop: true,
    backdropShadow: true,
    backdropColor: '#ece6dc',
    gobo: 'leaves',
    goboInvert: false,
    backdropBrightness: 1,
    backdropContrast: 1,
    hanger: true,
    hangerColor: '#f4f4f2',
    neckLabel: false,
    labelShape: 'small-woven',
    labelColor: '#efe6d2',
    autoRotate: false,
    patternMarkings: true,
  },
};

/** Fill missing fields (settings added in later versions) from the factory look. */
export function completeLook(partial: { fabric?: object; light?: object; scene?: object } | undefined): Look {
  return {
    fabric: { ...FACTORY_LOOK.fabric, ...partial?.fabric },
    light: { ...FACTORY_LOOK.light, ...partial?.light },
    scene: { ...FACTORY_LOOK.scene, ...partial?.scene },
  } as Look;
}
