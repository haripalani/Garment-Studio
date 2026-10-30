import type { ImageLayer, Layer, ShapeLayer } from '@gs/core';
import { adjustedImage } from './imageFx';
import { canvasPaint, type Ctx2D } from './paint';
import { drawText } from './text';

export interface AssetSource {
  image: CanvasImageSource & object;
  width: number;
  height: number;
}

export interface DrawEnv {
  asset: (assetId: string) => AssetSource | undefined;
  /** Max processed size for colour adjustments (Infinity when baking print files). */
  fxMaxSide?: number;
}

function shapePath(ctx: Ctx2D, l: ShapeLayer, w: number, h: number): void {
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  switch (l.kind) {
    case 'rect':
    case 'square':
      ctx.rect(-hw, -hh, w, h);
      break;
    case 'circle':
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(0, -hh);
      ctx.lineTo(hw, hh);
      ctx.lineTo(-hw, hh);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(0, -hh);
      ctx.lineTo(hw, 0);
      ctx.lineTo(0, hh);
      ctx.lineTo(-hw, 0);
      ctx.closePath();
      break;
    case 'star': {
      // 5-point star fitted to the box (outer points touch the box edges).
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.42;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      const minY = Math.min(...pts.map((p) => p[1]));
      const maxY = Math.max(...pts.map((p) => p[1]));
      const maxX = Math.max(...pts.map((p) => Math.abs(p[0])));
      const cy = (minY + maxY) / 2;
      pts.forEach(([x, y], i) => {
        const px = (x / maxX) * hw;
        const py = ((y - cy) / ((maxY - minY) / 2)) * hh;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      break;
    }
    case 'line':
    case 'dashed-line':
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw, 0);
      break;
  }
}

function drawShape(ctx: Ctx2D, l: ShapeLayer, w: number, h: number): void {
  const isLine = l.kind === 'line' || l.kind === 'dashed-line';
  const t = l.outline.thicknessMm;
  // Outlines are drawn inside the box so the visible size equals the layer size.
  const inset = isLine ? 0 : l.outline.on ? t : 0;
  shapePath(ctx, l, Math.max(0.01, w - inset), Math.max(0.01, h - inset));
  const style = canvasPaint(ctx, l.paint, w, h);
  if (isLine || l.outline.on) {
    ctx.lineWidth = isLine ? Math.max(t, 0.1) : t;
    ctx.lineJoin = 'round';
    ctx.lineCap = l.outline.dashed || l.kind === 'dashed-line' ? 'butt' : 'round';
    ctx.setLineDash(l.outline.dashed || l.kind === 'dashed-line' ? [t * 3, t * 2] : []);
    ctx.strokeStyle = style;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = style;
    ctx.fill();
  }
}

function drawImageLayer(ctx: Ctx2D, l: ImageLayer, w: number, h: number, env: DrawEnv): boolean {
  const a = env.asset(l.assetId);
  if (!a) return false;
  const src = adjustedImage(a.image, a.width, a.height, l.adjust, env.fxMaxSide);
  // The adjusted copy may be downscaled; crop in source pixels of whatever we draw from.
  const sw0 = src === a.image ? a.width : (src as { width: number }).width;
  const sh0 = src === a.image ? a.height : (src as { height: number }).height;
  const c = l.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const sx = c.l * sw0;
  const sy = c.t * sh0;
  const sw = Math.max(1, (1 - c.l - c.r) * sw0);
  const sh = Math.max(1, (1 - c.t - c.b) * sh0);
  ctx.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  return true;
}

/** Draws layer content into a w×h box centred at the current origin. Returns false if an asset is missing. */
export function drawLayerContent(ctx: Ctx2D, l: Layer, env: DrawEnv): boolean {
  ctx.save();
  ctx.globalAlpha *= l.opacity;
  let ok = true;
  if (l.type === 'image') ok = drawImageLayer(ctx, l, l.w, l.h, env);
  else if (l.type === 'text') drawText(ctx, l, l.w, l.h);
  else drawShape(ctx, l, l.w, l.h);
  ctx.restore();
  return ok;
}

/** Draws the full, uncropped image of an image layer (crop mode ghost). */
export function drawUncroppedImage(ctx: Ctx2D, l: ImageLayer, env: DrawEnv): void {
  const a = env.asset(l.assetId);
  if (!a) return;
  const c = l.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const fullW = l.w / Math.max(0.0001, 1 - c.l - c.r);
  const fullH = l.h / Math.max(0.0001, 1 - c.t - c.b);
  const x = -l.w / 2 - c.l * fullW;
  const y = -l.h / 2 - c.t * fullH;
  const src = adjustedImage(a.image, a.width, a.height, l.adjust, env.fxMaxSide);
  ctx.drawImage(src, x, y, fullW, fullH);
}
