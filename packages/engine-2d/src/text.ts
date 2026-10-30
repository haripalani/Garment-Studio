import type { TextLayer } from '@gs/core';
import { canvasPaint, type Ctx2D } from './paint';

/** Reference size the text is laid out at before being scaled into its box. */
const S = 100;

type TextProps = Pick<
  TextLayer,
  'text' | 'font' | 'weight' | 'italic' | 'caps' | 'lineHeight' | 'letterSpacing' | 'align'
>;

export function fontString(t: Pick<TextLayer, 'font' | 'weight' | 'italic'>, px: number): string {
  return `${t.italic ? 'italic ' : ''}${t.weight} ${px}px "${t.font}", sans-serif`;
}

export interface TextLayout {
  lines: string[];
  widths: number[];
  width: number;
  height: number;
}

function lines(t: TextProps): string[] {
  const s = t.caps ? t.text.toUpperCase() : t.text;
  const ls = s.split('\n');
  return ls.length ? ls : [''];
}

/** Natural layout at the reference size (px). Letter spacing is in em. */
export function layoutText(ctx: Ctx2D, t: TextProps): TextLayout {
  ctx.save();
  ctx.font = fontString(t, S);
  const ls = lines(t);
  const widths = ls.map((line) => {
    const chars = [...line].length;
    return ctx.measureText(line).width + Math.max(0, chars - 1) * t.letterSpacing * S;
  });
  ctx.restore();
  const width = Math.max(1, ...widths);
  return { lines: ls, widths, width, height: Math.max(1, ls.length * S * t.lineHeight) };
}

/** Height ÷ width of the text block; used to keep the box proportional when the text changes. */
export function textAspect(ctx: Ctx2D, t: TextProps): number {
  const l = layoutText(ctx, t);
  return l.height / l.width;
}

function drawLine(ctx: Ctx2D, line: string, x: number, y: number, spacingPx: number, fill: boolean) {
  if (spacingPx === 0) {
    if (fill) ctx.fillText(line, x, y);
    else ctx.strokeText(line, x, y);
    return;
  }
  let cx = x;
  for (const ch of line) {
    if (fill) ctx.fillText(ch, cx, y);
    else ctx.strokeText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacingPx;
  }
}

/** Draws the text scaled to fill the w×h box centred at the origin. */
export function drawText(ctx: Ctx2D, t: TextLayer, w: number, h: number): void {
  const layout = layoutText(ctx, t);
  ctx.save();
  ctx.scale(w / layout.width, h / layout.height);
  ctx.translate(-layout.width / 2, -layout.height / 2);
  ctx.font = fontString(t, S);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = canvasPaint(ctx, t.paint, layout.width, layout.height, layout.width / 2, layout.height / 2);
  const lh = S * t.lineHeight;
  layout.lines.forEach((line, i) => {
    const lw = layout.widths[i] ?? 0;
    const x = t.align === 'left' ? 0 : t.align === 'right' ? layout.width - lw : (layout.width - lw) / 2;
    drawLine(ctx, line, x, i * lh + lh / 2, t.letterSpacing * S, true);
  });
  ctx.restore();
}
