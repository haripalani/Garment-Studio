// Spec sheet (PDF): garment and fabric, front/back views, every placement with size and position,
// and a picture of each printed piece. Built in the browser with pdf-lib.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatLength, type GarmentModel, type Layer, type ProjectDoc, type Unit } from '@gs/core';
import { bakePiece } from '@gs/engine-2d';
import { canvasBlob } from '@gs/engine-3d';
import { assetSource } from '../store/assets';
import { withStudio } from '../render/scene';
import { PREVIEW_PX_PER_MM } from '../viewer/baker';
import { printTargets } from './printFiles';

const A4 = { w: 842, h: 595 }; // landscape, points
const M = 36;
const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.42, 0.44, 0.5);
const LINE = rgb(0.85, 0.86, 0.88);

/** Standard PDF fonts only cover WinAnsi; other characters become "?" instead of failing the export. */
function winAnsi(s: string): string {
  return s.replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…€]/g, '?');
}

function describe(l: Layer, doc: ProjectDoc): string {
  if (l.type === 'text') {
    const paint = l.paint.kind === 'solid' ? l.paint.color : `${l.paint.kind} gradient`;
    return `"${l.text.slice(0, 40)}" · ${l.font} ${l.weight}${l.italic ? ' italic' : ''} · ${paint}`;
  }
  if (l.type === 'image') {
    const a = doc.assets[l.assetId];
    return a ? `${a.name} (${a.width} × ${a.height} px)` : 'image';
  }
  const paint = l.paint.kind === 'solid' ? l.paint.color : `${l.paint.kind} gradient`;
  return `${l.kind} · ${paint}${l.outline.on ? ` · outline ${l.outline.thicknessMm} mm` : ''}`;
}

async function png(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
}

export async function buildSpecSheet(garment: GarmentModel, doc: ProjectDoc, unit: Unit): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`${doc.name} spec sheet`));
  pdf.setCreator('Garment Studio');
  pdf.setProducer('Garment Studio (pdf-lib)');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const len = (mm: number) => formatLength(mm, unit);
  const text = (page: PDFPage, s: string, x: number, y: number, size = 9, f: PDFFont = font, color = INK) =>
    page.drawText(winAnsi(s), { x, y, size, font: f, color });

  // ── Page 1: overview with front and back views ──
  const p1 = pdf.addPage([A4.w, A4.h]);
  text(p1, doc.name || 'Untitled design', M, A4.h - M - 14, 18, bold);
  text(
    p1,
    `${garment.name.en ?? garment.id} · ${garment.cut.en ?? ''} · model ${garment.id} ${garment.version} · ${new Date().toISOString().slice(0, 10)}`,
    M,
    A4.h - M - 32,
    9,
    font,
    MUTED,
  );
  const views = await withStudio(garment, doc, PREVIEW_PX_PER_MM, async (studio) => {
    const v = studio.offscreenView(720, 900);
    try {
      v.render(0);
      const front = await png(v.canvas);
      v.render(Math.PI);
      const back = await png(v.canvas);
      return { front, back };
    } finally {
      v.dispose();
    }
  });
  const imgH = 360;
  const imgW = imgH * 0.8;
  for (const [i, [label, bytes]] of ([['Front', views.front], ['Back', views.back]] as const).entries()) {
    const img = await pdf.embedPng(bytes);
    const x = M + i * (imgW + 16);
    p1.drawImage(img, { x, y: A4.h - M - 60 - imgH, width: imgW, height: imgH });
    text(p1, label, x, A4.h - M - 74 - imgH, 9, bold);
  }
  const f = doc.look.fabric;
  const facts: [string, string][] = [
    ['Fabric', `${f.material}${f.mode === 'gradient' ? ` gradient ${f.color} > ${f.gradientTo}` : ` ${f.color}`}`],
    ['Prints', `${doc.layers.filter((l) => l.visible).length} placements, ${printTargets(garment, doc).length} printed sides`],
    ['Units', unit],
    ['Hanger', doc.look.scene.hanger ? 'shown' : 'hidden'],
    ['Neck label', doc.look.scene.neckLabel ? doc.look.scene.labelShape : 'none'],
  ];
  let fy = A4.h - M - 70;
  const fx = M + 2 * (imgW + 16) + 8;
  text(p1, 'Summary', fx, fy, 11, bold);
  for (const [k, v] of facts) {
    fy -= 16;
    text(p1, k, fx, fy, 8, font, MUTED);
    fy -= 12;
    text(p1, v, fx, fy, 9);
  }

  // ── Page 2+: placements table ──
  const cols = [
    { h: '#', w: 22 },
    { h: 'Layer', w: 120 },
    { h: 'Type', w: 46 },
    { h: 'Piece · side', w: 110 },
    { h: 'Position (x, y)', w: 110 },
    { h: 'Size (w × h)', w: 110 },
    { h: 'Rotation', w: 52 },
    { h: 'Details', w: 200 },
  ];
  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M - 14;
  text(page, 'Placements', M, y, 14, bold);
  text(page, 'Positions are the centre of each print, measured from the top-left of its piece.', M, y - 16, 8, font, MUTED);
  y -= 40;
  const header = () => {
    let x = M;
    for (const c of cols) {
      text(page, c.h, x, y, 8, bold, MUTED);
      x += c.w;
    }
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: A4.w - M, y: y - 5 }, thickness: 0.6, color: LINE });
    y -= 18;
  };
  header();
  const visible = doc.layers.filter((l) => l.visible);
  for (const [i, l] of visible.entries()) {
    if (y < M + 20) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M - 14;
      header();
    }
    const piece = garment.pieces.find((p) => p.id === l.pieceId);
    const cells = [
      String(i + 1),
      l.name.slice(0, 26),
      l.type,
      `${piece?.name.en ?? l.pieceId} · ${l.side}`,
      `${len(l.x)}, ${len(l.y)}`,
      `${len(l.w)} × ${len(l.h)}`,
      `${Math.round(l.rotationDeg * 10) / 10}°`,
      describe(l, doc).slice(0, 52),
    ];
    let x = M;
    cells.forEach((c, k) => {
      text(page, c, x, y, 8);
      x += cols[k]!.w;
    });
    y -= 15;
  }
  if (!visible.length) text(page, 'No prints placed yet.', M, y, 9, font, MUTED);

  // ── Printed pieces ──
  const targets = printTargets(garment, doc);
  if (targets.length) {
    page = pdf.addPage([A4.w, A4.h]);
    text(page, 'Printed pieces', M, A4.h - M - 14, 14, bold);
    const cell = { w: (A4.w - 2 * M - 3 * 16) / 4, h: 210 };
    for (const [i, t] of targets.entries()) {
      if (i && i % 8 === 0) page = pdf.addPage([A4.w, A4.h]);
      const k = i % 8;
      const cx = M + (k % 4) * (cell.w + 16);
      const cy = A4.h - M - 50 - Math.floor(k / 4) * (cell.h + 30);
      const canvas = bakePiece(
        { garment, layers: doc.layers, side: t.side, fabric: doc.look.fabric, markings: false, unit: 'mm', env: { asset: assetSource, fxMaxSide: 2048 } },
        { pieceId: t.pieceId, side: t.side, pxPerMm: 1, background: true },
      );
      const img = await pdf.embedPng(await png(canvas));
      const s = Math.min(cell.w / img.width, cell.h / img.height);
      page.drawImage(img, { x: cx, y: cy - img.height * s, width: img.width * s, height: img.height * s });
      const piece = garment.pieces.find((p) => p.id === t.pieceId);
      text(page, `${piece?.name.en ?? t.pieceId} · ${t.side}`, cx, cy - cell.h - 14, 8, bold);
    }
  }

  const pages = pdf.getPages();
  pages.forEach((pg, i) => text(pg, `${i + 1} / ${pages.length}`, A4.w - M - 30, M / 2, 8, font, MUTED));
  return pdf.save();
}
