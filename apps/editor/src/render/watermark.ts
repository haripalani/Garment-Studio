// Watermark for plans that require one (ADR-0012): the same mark locally and on cloud renders.

/** Draws the watermark onto a copy of the image (bottom right, sized to the picture). */
export function watermark(src: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const size = Math.max(14, Math.round(Math.min(c.width, c.height) * 0.035));
  ctx.font = `600 ${size}px "Inter Variable", system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = size / 4;
  ctx.fillText('Made with Garment Studio', c.width - size, c.height - size * 0.8);
  return c;
}
