// Content inspection for uploaded files (ADR-0014): magic-byte sniffing, raster size limits and
// SVG safety rules. Pure functions, unit-tested; the scanner runs them before antivirus.
import { imageSize } from 'image-size';

export const MAX_RASTER_PX = 12_000;

export type Sniffed = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | 'image/svg+xml' | 'application/pdf';

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12))) return 'image/avif';
  // Adobe Illustrator files are PDFs with a private stream; the header may follow a small preamble.
  if (b.length >= 5 && ascii(b, 0, Math.min(b.length, 1024)).includes('%PDF-')) return 'application/pdf';
  if (looksLikeSvg(b)) return 'image/svg+xml';
  return null;
}

function looksLikeSvg(b: Uint8Array): boolean {
  let head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4096)).replace(/^﻿/, '');
  // Skip the XML declaration, comments and a doctype before the root element.
  head = head.replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*/i, '');
  return /^<svg[\s>]/i.test(head);
}

/** Reasons an SVG is unsafe to display or rasterise, empty when it is acceptable. */
export function svgProblems(text: string): string[] {
  const out: string[] = [];
  // [\s/>] also catches self-closing forms such as <foreignObject/>.
  if (/<script[\s/>]/i.test(text)) out.push('contains a script');
  if (/<foreignObject[\s/>]/i.test(text)) out.push('contains foreignObject');
  if (/<(iframe|embed|object|audio|video)[\s/>]/i.test(text)) out.push('embeds other documents or media');
  if (/<!ENTITY/i.test(text)) out.push('declares XML entities');
  if (/\son[a-z]+\s*=/i.test(text)) out.push('has event-handler attributes');
  if (/(?:href|src)\s*=\s*["']\s*(?:javascript:|vbscript:|data:text\/html)/i.test(text)) out.push('has script links');
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//i.test(text)) out.push('references external files');
  if (/@import|url\(\s*["']?\s*(?:https?:)?\/\//i.test(text)) out.push('loads external styles');
  return out;
}

const num = (s: string | undefined) => {
  const m = s ? /^\s*([\d.]+)\s*(px)?\s*$/.exec(s) : null;
  return m?.[1] ? Math.round(Number(m[1])) : null;
};

export function svgSize(text: string): { width: number | null; height: number | null } {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
  let width = num(attr('width'));
  let height = num(attr('height'));
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if ((width === null || height === null) && vb?.length === 4 && vb.every(Number.isFinite)) {
    width ??= Math.round(vb[2]!);
    height ??= Math.round(vb[3]!);
  }
  return { width: width && width > 0 ? width : null, height: height && height > 0 ? height : null };
}

export type Inspection =
  | { ok: true; width: number | null; height: number | null; isVector: boolean }
  | { ok: false; reason: string };

/** Everything except antivirus: type, size and safety. */
export function inspect(bytes: Uint8Array, declaredMime: string): Inspection {
  const actual = sniff(bytes);
  if (actual !== declaredMime) {
    return { ok: false, reason: `content is ${actual ?? 'an unknown type'}, not ${declaredMime}` };
  }
  if (actual === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    const bad = svgProblems(text);
    if (bad.length) return { ok: false, reason: `unsafe SVG: ${bad.join(', ')}` };
    return { ok: true, ...svgSize(text), isVector: true };
  }
  if (actual === 'application/pdf') return { ok: true, width: null, height: null, isVector: true };
  let dim: { width?: number; height?: number };
  try {
    dim = imageSize(bytes);
  } catch {
    return { ok: false, reason: 'the image could not be read' };
  }
  if (!dim.width || !dim.height) return { ok: false, reason: 'the image has no dimensions' };
  if (dim.width > MAX_RASTER_PX || dim.height > MAX_RASTER_PX) {
    return { ok: false, reason: `the image is larger than ${MAX_RASTER_PX} px on a side` };
  }
  return { ok: true, width: dim.width, height: dim.height, isVector: false };
}
