import type { Crop, ImageLayer } from '@gs/core';

export type ImageAdjust = ImageLayer['adjust'];

export function isNeutral(a: ImageAdjust): boolean {
  return !a.invert && a.hueDeg === 0 && a.saturation === 1 && a.fill === null;
}

/** Bounding box of pixels with alpha above `threshold`, as a crop (fractions removed per edge). */
export function trimBounds(data: Uint8ClampedArray, w: number, h: number, threshold = 8): Crop | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3]! > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { l: x0 / w, t: y0 / h, r: (w - 1 - x1) / w, b: (h - 1 - y1) / h };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/** Applies fill / invert / hue / saturation in place (RGBA, straight alpha). */
export function adjustPixels(data: Uint8ClampedArray, a: ImageAdjust): void {
  const fill = a.fill ? Number.parseInt(a.fill.slice(1), 16) : null;
  const hueShift = a.hueDeg / 360;
  const doHsl = !fill && (a.hueDeg !== 0 || a.saturation !== 1);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;
    if (fill !== null) {
      r = (fill >> 16) & 255;
      g = (fill >> 8) & 255;
      b = fill & 255;
    }
    if (a.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (doHsl) {
      const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
      const [nr, ng, nb] = hslToRgb((((h + hueShift) % 1) + 1) % 1, Math.min(1, s * a.saturation), l);
      r = nr * 255;
      g = ng * 255;
      b = nb * 255;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const fxCache = new WeakMap<object, Map<string, Canvas>>();

/**
 * Returns the source with colour adjustments applied (cached per source + settings).
 * Large images are processed at most `maxSide` px for interactive use; print baking passes Infinity.
 */
export function adjustedImage(
  src: CanvasImageSource & object,
  width: number,
  height: number,
  a: ImageAdjust,
  maxSide = 2048,
): CanvasImageSource {
  if (isNeutral(a)) return src;
  const key = `${a.invert}|${a.hueDeg}|${a.saturation}|${a.fill}|${maxSide}`;
  let perSrc = fxCache.get(src);
  if (!perSrc) {
    perSrc = new Map();
    fxCache.set(src, perSrc);
  }
  const hit = perSrc.get(key);
  if (hit) return hit;
  const k = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  adjustPixels(img.data, a);
  ctx.putImageData(img, 0, 0);
  if (perSrc.size > 8) perSrc.clear();
  perSrc.set(key, c);
  return c;
}

/** Reads pixels of an image source (downscaled to ≤ maxSide) for trimming. */
export function readPixels(
  src: CanvasImageSource,
  width: number,
  height: number,
  maxSide = 1024,
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const k = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}
