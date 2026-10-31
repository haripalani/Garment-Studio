// Production files built in the browser with the same drawing code as the screen (engine-2d):
// - print files: each print at real size on a transparent background (DTG / screen / DTF), per piece and side
// - sublimation panels: every pattern piece as one full panel with fabric colour, bleed and a cut line
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { GarmentModel, ProjectDoc, Side } from '@gs/core';
import { bakePiece, type SheetScene } from '@gs/engine-2d';
import { canvasBlob } from '@gs/engine-3d';
import { assetSource } from '../store/assets';
import { layersAffecting } from '../viewer/baker';
import { ensureDocFonts } from '../render/scene';
import type { Dpi } from './options';
import { pngWithDpi } from './png';


export interface ExportFile {
  path: string;
  pieceId: string;
  side: Side;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
}

export interface ExportProgress {
  (done: number, total: number): void;
}

const pxPerMm = (dpi: number) => dpi / 25.4;

function sheetScene(garment: GarmentModel, doc: ProjectDoc, side: Side): SheetScene {
  return {
    garment,
    layers: doc.layers,
    side,
    fabric: doc.look.fabric,
    markings: false,
    unit: 'mm',
    // Full resolution for image effects in production output.
    env: { asset: assetSource, fxMaxSide: 8192 },
  };
}

async function pngBytes(canvas: OffscreenCanvas | HTMLCanvasElement, dpi: number): Promise<Uint8Array> {
  const blob = await canvasBlob(canvas, 'image/png');
  return pngWithDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

function readme(lines: string[]): Uint8Array {
  return strToU8(lines.join('\r\n'));
}

/** Pieces/sides that carry visible artwork (own layers or artwork wrapped over a seam). */
export function printTargets(garment: GarmentModel, doc: ProjectDoc): { pieceId: string; side: Side }[] {
  const out: { pieceId: string; side: Side }[] = [];
  for (const side of ['outside', 'inside'] as const) {
    for (const p of garment.pieces) {
      if (!p.sides.includes(side) || !p.layoutMm[side]) continue;
      if (layersAffecting(garment, doc.layers, { pieceId: p.id, side }).some((l) => l.visible)) {
        out.push({ pieceId: p.id, side });
      }
    }
  }
  return out;
}

export async function buildPrintZip(
  garment: GarmentModel,
  doc: ProjectDoc,
  o: { dpi: Dpi; bleedMm: number; onProgress?: ExportProgress },
): Promise<{ zip: Uint8Array; files: ExportFile[] }> {
  await ensureDocFonts(doc);
  const targets = printTargets(garment, doc);
  if (!targets.length) throw new Error('There is no artwork to export yet.');
  const zip: Zippable = {};
  const files: ExportFile[] = [];
  for (const [i, t] of targets.entries()) {
    o.onProgress?.(i, targets.length);
    await nextTick();
    const canvas = bakePiece(sheetScene(garment, doc, t.side), {
      pieceId: t.pieceId,
      side: t.side,
      pxPerMm: pxPerMm(o.dpi),
      background: false,
      bleedMm: o.bleedMm,
    });
    const piece = garment.pieces.find((p) => p.id === t.pieceId)!;
    const path = `prints/${t.side}/${t.pieceId}.png`;
    zip[path] = [await pngBytes(canvas, o.dpi), { level: 0 }];
    files.push({
      path,
      pieceId: t.pieceId,
      side: t.side,
      widthMm: round(Math.max(...piece.outlineMm.map((v) => v[0])) + o.bleedMm * 2),
      heightMm: round(Math.max(...piece.outlineMm.map((v) => v[1])) + o.bleedMm * 2),
      widthPx: canvas.width,
      heightPx: canvas.height,
    });
  }
  o.onProgress?.(targets.length, targets.length);
  zip['manifest.json'] = strToU8(JSON.stringify(manifest(garment, doc, 'print', o.dpi, o.bleedMm, files), null, 2));
  zip['README.txt'] = readme([
    `Print files for "${doc.name}" (${garment.name.en ?? garment.id} ${garment.version})`,
    '',
    `Each PNG covers one whole pattern piece at real size, ${o.dpi} DPI (set in the file), on a transparent`,
    `background, with ${o.bleedMm} mm extra on every side. Artwork sits exactly where it was placed on the piece,`,
    'so files can be printed and aligned to the cut piece without measuring.',
    '',
    'prints/outside: prints on the outside of the garment.',
    'prints/inside: prints on the inside, drawn as seen when looking at the inside.',
    '',
    'manifest.json lists every file with its piece, side and size in millimetres and pixels.',
  ]);
  return { zip: zipSync(zip), files };
}

export async function buildSublimationZip(
  garment: GarmentModel,
  doc: ProjectDoc,
  o: { dpi: Dpi; bleedMm: number; cutLine: boolean; onProgress?: ExportProgress },
): Promise<{ zip: Uint8Array; files: ExportFile[] }> {
  await ensureDocFonts(doc);
  const pieces = garment.pieces.filter((p) => p.sides.includes('outside') && p.layoutMm.outside);
  const zip: Zippable = {};
  const files: ExportFile[] = [];
  const k = pxPerMm(o.dpi);
  for (const [i, piece] of pieces.entries()) {
    o.onProgress?.(i, pieces.length);
    await nextTick();
    const canvas = bakePiece(sheetScene(garment, doc, 'outside'), {
      pieceId: piece.id,
      side: 'outside',
      pxPerMm: k,
      background: true,
      bleedMm: o.bleedMm,
    });
    if (o.cutLine) drawCutLine(canvas, piece.outlineMm, k, o.bleedMm);
    const w = Math.max(...piece.outlineMm.map((v) => v[0]));
    const h = Math.max(...piece.outlineMm.map((v) => v[1]));
    for (let copy = 1; copy <= piece.cut; copy++) {
      const path = `panels/${piece.id}${piece.cut > 1 ? `-${copy}` : ''}.png`;
      zip[path] = [await pngBytes(canvas, o.dpi), { level: 0 }];
      files.push({
        path,
        pieceId: piece.id,
        side: 'outside',
        widthMm: round(w + o.bleedMm * 2),
        heightMm: round(h + o.bleedMm * 2),
        widthPx: canvas.width,
        heightPx: canvas.height,
      });
    }
  }
  o.onProgress?.(pieces.length, pieces.length);
  zip['manifest.json'] = strToU8(JSON.stringify(manifest(garment, doc, 'sublimation', o.dpi, o.bleedMm, files), null, 2));
  zip['README.txt'] = readme([
    `Sublimation panels for "${doc.name}" (${garment.name.en ?? garment.id} ${garment.version})`,
    '',
    `One PNG per pattern piece to cut (pieces cut more than once appear once per copy), ${o.dpi} DPI, with the`,
    `fabric colour and artwork extended ${o.bleedMm} mm beyond the cut edge.`,
    o.cutLine ? 'A thin dark line marks the cut edge.' : 'No cut line is drawn.',
    '',
    'Files are not mirrored: if your transfer paper needs mirrored artwork, mirror at print time (most RIPs have an option).',
  ]);
  return { zip: zipSync(zip), files };
}

function drawCutLine(canvas: OffscreenCanvas | HTMLCanvasElement, outline: readonly (readonly [number, number])[], k: number, bleedMm: number) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, bleedMm * k, bleedMm * k);
  ctx.beginPath();
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineWidth = 0.35; // mm
  ctx.strokeStyle = 'rgba(20, 20, 20, 0.9)';
  ctx.stroke();
  ctx.restore();
}

const round = (v: number) => Math.round(v * 10) / 10;

function manifest(garment: GarmentModel, doc: ProjectDoc, kind: string, dpi: number, bleedMm: number, files: ExportFile[]) {
  return {
    generator: 'Garment Studio',
    kind,
    design: doc.name,
    garment: { id: garment.id, version: garment.version },
    dpi,
    bleedMm,
    createdAt: new Date().toISOString(),
    files,
  };
}
