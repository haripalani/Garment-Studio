// Procedurally generated textures: knit normal maps per material, backdrop gobos, neck labels.
// Generated in code so the project ships no third-party texture assets (ADR-0002).
import type { Gobo, LabelShape, Material } from '@gs/core';

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: Canvas2D): Ctx {
  const x = c.getContext('2d') as Ctx | null;
  if (!x) throw new Error('2D context unavailable');
  return x;
}

/** Height function per material over one tile, (u, v) ∈ [0, 1). Values roughly in [0, 1]. */
export function knitHeight(material: Material, u: number, v: number): number {
  const TAU = Math.PI * 2;
  switch (material) {
    case 'rib':
      return 0.5 + 0.5 * Math.cos(u * TAU * 4);
    case 'waffle': {
      const a = Math.abs(Math.sin(u * Math.PI * 3));
      const b = Math.abs(Math.sin(v * Math.PI * 3));
      return Math.min(a, b);
    }
    case 'pique': {
      const cu = (u * 6) % 1;
      const cv = (v * 6) % 1;
      const dot = Math.hypot(cu - 0.5, cv - 0.5);
      return 0.35 + 0.65 * Math.max(0, 1 - dot * 2.4);
    }
    case 'mesh': {
      const cu = (u * 5) % 1;
      const cv = (v * 5 + (Math.floor(u * 5) % 2) * 0.5) % 1;
      return Math.hypot(cu - 0.5, cv - 0.5) < 0.28 ? 0 : 1;
    }
    case 'fleece':
      return 0.5 + 0.25 * Math.sin(u * TAU * 7 + Math.sin(v * TAU * 3) * 2) + 0.25 * Math.sin(v * TAU * 9 + u * 5);
    case 'sport-knit':
    case 'interlock':
    case 'cotton-blend':
    case 'cotton':
    default: {
      // Jersey: interlocking V-shaped loops in columns.
      const cols = material === 'interlock' || material === 'sport-knit' ? 8 : 6;
      const cu = (u * cols) % 1;
      const cv = (v * cols * 1.4) % 1;
      const loop = 1 - Math.abs(cu - 0.5) * 2;
      return 0.5 + 0.5 * Math.sin(loop * Math.PI * 0.9) * Math.cos((cv - 0.5) * Math.PI * 1.2);
    }
  }
}

/** Tangent-space normal map tile (RGB) derived from the material's height field. */
export function knitNormalMap(material: Material, size = 128): Canvas2D {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) =>
    knitHeight(material, (((x % size) + size) % size) / size, (((y % size) + size) % size) / size);
  const k = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * k;
      const dy = (h(x, y + 1) - h(x, y - 1)) * k;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Physical-ish parameters per knit. Tile size is the real width (mm) one normal-map tile covers. */
export const MATERIAL_PROPS: Record<Material, { roughness: number; sheen: number; tileMm: number; normal: number }> = {
  cotton: { roughness: 0.92, sheen: 0.35, tileMm: 6, normal: 0.55 },
  'cotton-blend': { roughness: 0.82, sheen: 0.3, tileMm: 5, normal: 0.35 },
  interlock: { roughness: 0.85, sheen: 0.3, tileMm: 5, normal: 0.4 },
  'sport-knit': { roughness: 0.55, sheen: 0.55, tileMm: 4, normal: 0.35 },
  pique: { roughness: 0.9, sheen: 0.25, tileMm: 8, normal: 0.9 },
  rib: { roughness: 0.9, sheen: 0.25, tileMm: 9, normal: 1.0 },
  waffle: { roughness: 0.95, sheen: 0.2, tileMm: 12, normal: 1.1 },
  fleece: { roughness: 1.0, sheen: 0.8, tileMm: 10, normal: 0.6 },
  mesh: { roughness: 0.6, sheen: 0.4, tileMm: 7, normal: 1.0 },
};

/** Light pattern projected onto the backdrop (white = light). */
export function goboTexture(gobo: Gobo, invert: boolean, size = 512): Canvas2D {
  const c = makeCanvas(size, size);
  const x = ctx2d(c);
  const s = size;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, s, s);
  x.fillStyle = '#000';
  const rand = mulberry32(7);
  switch (gobo) {
    case 'window':
      x.fillRect(s * 0.48, 0, s * 0.04, s);
      x.fillRect(0, s * 0.48, s, s * 0.04);
      x.fillRect(0, 0, s * 0.08, s);
      x.fillRect(s * 0.92, 0, s * 0.08, s);
      break;
    case 'blinds':
    case 'soft-blinds':
      for (let i = 0; i < 14; i++) x.fillRect(0, (i * s) / 14, s, s / 28);
      break;
    case 'stripes':
      x.save();
      x.translate(s / 2, s / 2);
      x.rotate(-0.5);
      for (let i = -12; i < 12; i++) x.fillRect(-s, (i * s) / 10, s * 2, s / 18);
      x.restore();
      break;
    case 'leaves':
    case 'palm':
    case 'branches':
      for (let i = 0; i < (gobo === 'branches' ? 18 : 42); i++) {
        const cx = rand() * s;
        const cy = rand() * s;
        const r = (gobo === 'palm' ? 0.12 : 0.05) * s * (0.5 + rand());
        x.save();
        x.translate(cx, cy);
        x.rotate(rand() * Math.PI);
        x.beginPath();
        if (gobo === 'branches') {
          x.lineWidth = s * 0.012;
          x.strokeStyle = '#000';
          x.moveTo(-r * 2, 0);
          x.quadraticCurveTo(0, -r, r * 2, r * 0.3);
          x.stroke();
        } else {
          x.ellipse(0, 0, r, r * (gobo === 'palm' ? 0.18 : 0.45), 0, 0, Math.PI * 2);
          x.fill();
        }
        x.restore();
      }
      break;
    case 'spotlight': {
      x.fillStyle = '#000';
      x.fillRect(0, 0, s, s);
      const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.45);
      g.addColorStop(0, '#fff');
      g.addColorStop(1, '#000');
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
      break;
    }
    case 'none':
      break;
  }
  if (gobo === 'soft-blinds' || gobo === 'leaves' || gobo === 'palm' || gobo === 'branches') {
    blur(x, s, gobo === 'soft-blinds' ? 8 : 5);
  }
  if (invert) {
    x.globalCompositeOperation = 'difference';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, s, s);
    x.globalCompositeOperation = 'source-over';
  }
  return c;
}

function blur(x: Ctx, s: number, px: number): void {
  const copy = makeCanvas(s, s);
  const cx = ctx2d(copy);
  cx.drawImage(x.canvas as CanvasImageSource, 0, 0);
  x.filter = `blur(${px}px)`;
  x.drawImage(copy as CanvasImageSource, 0, 0);
  x.filter = 'none';
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Label sizes in mm (w × h) per shape. */
export const LABEL_SIZES: Record<LabelShape, [number, number]> = {
  'small-woven': [50, 34],
  wide: [80, 26],
  square: [40, 40],
  'tall-satin': [32, 56],
  loop: [44, 30],
};

export function labelTexture(shape: LabelShape, color: string, text: string): Canvas2D {
  const [w, h] = LABEL_SIZES[shape];
  const k = 8;
  const c = makeCanvas(w * k, h * k);
  const x = ctx2d(c);
  x.fillStyle = color;
  x.fillRect(0, 0, w * k, h * k);
  const n = Number.parseInt(color.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  x.fillStyle = lum > 0.5 ? '#1d1d1f' : '#f2f0ea';
  x.font = `600 ${Math.min(h * k * 0.32, (w * k) / (text.length * 0.62))}px "Inter Variable", Inter, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, (w * k) / 2, (h * k) / 2);
  // Woven edge
  x.strokeStyle = 'rgba(0,0,0,0.15)';
  x.lineWidth = k;
  x.strokeRect(k / 2, k / 2, w * k - k, h * k - k);
  return c;
}

/** Alpha mask for the backdrop shadow overlay: opaque where the gobo blocks light. */
export function goboShadowAlpha(gobo: Gobo, invert: boolean, size = 512): Canvas2D {
  // goboTexture is white where light passes; invert it once more so blocked light becomes white (= opaque alpha).
  return goboTexture(gobo, !invert, size);
}
