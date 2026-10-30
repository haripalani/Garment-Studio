// Document commands used by the canvas, panels and keyboard shortcuts.
import {
  createDoc,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  deg2rad,
  newId,
  type Layer,
  type PresetId,
  type ShapeKind,
  type Side,
  type TextLayer,
  type Vec,
} from '@gs/core';
import {
  alignInPiece,
  applyCrop,
  fitView,
  frameFor,
  normaliseDeg,
  pieceAt,
  presetPlacement,
  readPixels,
  sheetBounds,
  sheetToPiece,
  textAspect,
  trimBounds,
  type AlignTo,
  type PieceFrame,
} from '@gs/engine-2d';
import { AssetError, assetSource, importImage } from '../store/assets';
import { DEV_GARMENT, draftLayer, selectedLayer, useDoc } from '../store/doc';
import { look } from '../store/look';
import { toast } from '../store/toast';
import { useWorkspace } from '../store/workspace';
import { DEFAULT_FONT, ensureFont } from '../fonts';

const doc = () => useDoc.getState();
const ws = () => useWorkspace.getState();

type Patch<T> = { [K in keyof T]?: T[K] };

/* ───────────── placement ───────────── */

/** Where new artwork goes: the chest on the outside, the printed-label spot on the inside. */
function defaultTarget(side: Side): { frame: PieceFrame; fx: number; fy: number; fw: number } {
  const g = doc().garment;
  const preset = g.presets[side === 'outside' ? 'chest' : 'printedLabel'];
  const frame = preset ? frameFor(g, side, preset.piece) : undefined;
  if (preset && frame) return { frame, fx: preset.fx, fy: preset.fy, fw: preset.fw };
  const first = frameFor(g, side, g.pieces[0]!.id)!;
  return { frame: first, fx: 0.5, fy: 0.4, fw: 0.4 };
}

export interface DropTarget {
  frame: PieceFrame;
  at: Vec; // piece frame
}

export function targetAtSheetPoint(p: Vec): DropTarget | undefined {
  const frame = pieceAt(doc().garment, ws().side, p);
  return frame ? { frame, at: sheetToPiece(frame, p) } : undefined;
}

function addLayer(layer: Layer, label: string) {
  doc().edit(label, (d) => {
    d.layers.unshift(layer);
  });
  doc().select(layer.id);
  ws().setTool('select');
}

/* ───────────── creating layers ───────────── */

export async function addImageFiles(files: readonly File[], target?: DropTarget): Promise<void> {
  for (const file of files) {
    try {
      const { id, ref, stored } = await importImage(file, file.name || 'Pasted image');
      if (!stored) toast('The image was added but could not be saved on this device; it will be missing after a reload.', 'error');
      const side = ws().side;
      const t = target ?? defaultTarget(side);
      const frame = t.frame;
      const aspect = ref.height / ref.width;
      const fw = 'fw' in t ? t.fw : 0.35;
      let w = frame.w * fw;
      let h = w * aspect;
      if (h > frame.h * 0.6) {
        h = frame.h * 0.6;
        w = h / aspect;
      }
      const at: Vec = 'at' in t ? t.at : [frame.w * t.fx, frame.h * t.fy];
      const layer = createImageLayer(
        { pieceId: frame.piece.id, side, x: at[0], y: at[1], w, h },
        id,
        ref.name.replace(/\.[a-z0-9]+$/i, '') || 'Image',
      );
      doc().edit('Add image', (d) => {
        d.assets[id] = ref;
        d.layers.unshift(layer);
      });
      doc().select(layer.id);
      ws().setTool('select');
    } catch (e) {
      toast(e instanceof AssetError ? e.message : 'The image could not be added.', 'error');
    }
  }
}

let measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

/** Height ÷ width of a text block (falls back to a typical single-line ratio without a 2D context). */
function aspectOf(t: TextLayer): number {
  if (!measureCtx) {
    measureCtx =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : document.createElement('canvas').getContext('2d');
  }
  return measureCtx ? textAspect(measureCtx, t) : 0.25 * t.text.split('\n').length;
}

export async function addText(target?: DropTarget): Promise<void> {
  await ensureFont(DEFAULT_FONT, 700);
  const side = ws().side;
  const t = target ?? defaultTarget(side);
  const frame = t.frame;
  const w = Math.min(frame.w * 0.45, 260);
  const at: Vec = 'at' in t ? t.at : [frame.w * t.fx, frame.h * t.fy];
  const base = createTextLayer({ pieceId: frame.piece.id, side, x: at[0], y: at[1], w, h: w / 4 }, 'Text');
  const layer: TextLayer = { ...base, font: DEFAULT_FONT, paint: { kind: 'solid', color: inkFor() } };
  layer.h = w * aspectOf(layer);
  addLayer(layer, 'Add text');
  ws().focusText();
}

/** Shape from a drag on the sheet (a→b). A click without drag makes a 60 mm shape. */
export function addShapeFromDrag(kind: ShapeKind, a: Vec, b: Vec, even: boolean): void {
  const centre: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const target = targetAtSheetPoint(centre);
  if (!target) {
    toast('Draw shapes on a pattern piece.');
    return;
  }
  const line = kind === 'line' || kind === 'dashed-line';
  let w = Math.abs(b[0] - a[0]);
  let h = Math.abs(b[1] - a[1]);
  if (w < 2 && h < 2) {
    w = 60;
    h = line ? 4 : 60;
  }
  if (even || kind === 'square' || kind === 'circle') {
    if (!line) w = h = Math.max(w, h);
  }
  if (line) h = Math.max(h, 4);
  const [x, y] = target.at;
  const shape = createShapeLayer({ pieceId: target.frame.piece.id, side: ws().side, x, y, w, h }, kind);
  addLayer({ ...shape, paint: { kind: 'solid', color: inkFor() } }, 'Add shape');
}

/** A default ink that shows on the current fabric: near-black on light fabric, white on dark. */
function inkFor(): string {
  const n = Number.parseInt(look.get().fabric.color.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? '#141516' : '#ffffff';
}

/* ───────────── editing ───────────── */

export function update(id: string, patch: Patch<Layer>, label = 'Edit'): void {
  doc().edit(label, (d) => {
    const l = draftLayer(d, id);
    if (l) Object.assign(l, patch);
  });
}

/** Edits during a gesture (slider drag, typing). Call endLive() when the gesture ends. */
export function live(id: string, patch: Patch<Layer>, label = 'Adjust'): void {
  doc().begin(label);
  update(id, patch, label);
}

export function endLive(): void {
  doc().commit();
}

/** Text edits keep the box width and refit the height to the new text. */
export async function updateText(id: string, patch: Patch<TextLayer>, gesture = false): Promise<void> {
  const cur = doc().doc.layers.find((l) => l.id === id);
  if (!cur || cur.type !== 'text') return;
  const next = { ...cur, ...patch } as TextLayer;
  await ensureFont(next.font, next.weight, next.italic);
  const h = Math.max(1, next.w * aspectOf(next));
  if (gesture) live(id, { ...patch, h } as Patch<Layer>, 'Edit text');
  else update(id, { ...patch, h } as Patch<Layer>, 'Edit text');
}

export function deleteLayer(id: string): void {
  doc().edit('Delete', (d) => {
    d.layers = d.layers.filter((l) => l.id !== id);
  });
  if (doc().selectedId === id) doc().select(null);
  ws().setCropMode(false);
}

export function duplicateLayer(id: string, offsetMm = 10): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (!l) return;
  const copy = { ...structuredClone(l), id: newId(), x: l.x + offsetMm, y: l.y + offsetMm, name: l.name };
  const i = doc().doc.layers.findIndex((x) => x.id === id);
  doc().edit('Duplicate', (d) => {
    d.layers.splice(i, 0, copy);
  });
  doc().select(copy.id);
}

/** Move a layer to a new index in the stack (0 = top). */
export function moveInStack(id: string, to: number): void {
  const layers = doc().doc.layers;
  const from = layers.findIndex((l) => l.id === id);
  if (from < 0) return;
  const target = Math.max(0, Math.min(layers.length - 1, to));
  if (target === from) return;
  doc().edit('Reorder', (d) => {
    const [l] = d.layers.splice(from, 1);
    if (l) d.layers.splice(target, 0, l);
  });
}

export function setVisible(id: string, visible: boolean): void {
  update(id, { visible }, visible ? 'Show layer' : 'Hide layer');
}

export function rename(id: string, name: string): void {
  update(id, { name: name.slice(0, 120) || 'Layer' }, 'Rename');
}

export function rotateBy(id: string, deg: number): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (l) update(id, { rotationDeg: normaliseDeg(l.rotationDeg + deg) }, 'Rotate');
}

export function nudge(id: string, dx: number, dy: number): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (l) update(id, { x: l.x + dx, y: l.y + dy }, 'Nudge');
}

export function flip(id: string): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (l) update(id, { flipX: !l.flipX }, 'Mirror');
}

export function align(id: string, to: AlignTo): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (!l) return;
  const frame = frameFor(doc().garment, l.side, l.pieceId);
  if (frame) update(id, alignInPiece(l, frame, to), 'Align');
}

export function applyPreset(id: string, preset: PresetId): void {
  const g = doc().garment;
  const p = g.presets[preset];
  const l = doc().doc.layers.find((x) => x.id === id);
  if (!p || !l) return;
  const frame = frameFor(g, p.side, p.piece);
  if (!frame) return;
  update(id, { pieceId: p.piece, side: p.side, ...presetPlacement(l, frame, p) }, 'Place');
  if (ws().side !== p.side) ws().setSide(p.side);
}

/* ───────────── image crop ───────────── */

export function trimEmptyEdges(id: string): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (!l || l.type !== 'image') return;
  const src = assetSource(l.assetId);
  if (!src) return;
  const px = readPixels(src.image, src.width, src.height);
  const crop = px ? trimBounds(px.data, px.w, px.h) : null;
  if (!crop) {
    toast('Nothing to trim: the picture has no transparent edges.');
    return;
  }
  update(id, applyCrop(l, crop), 'Trim edges');
}

export function resetCrop(id: string): void {
  const l = doc().doc.layers.find((x) => x.id === id);
  if (l?.type === 'image') update(id, applyCrop(l, null), 'Reset crop');
}

/* ───────────── clipboard ───────────── */

let clipboard: Layer | null = null;

export function copySelection(): boolean {
  const l = selectedLayer(doc());
  if (!l) return false;
  clipboard = structuredClone(l);
  return true;
}

export function pasteLayer(): boolean {
  if (!clipboard) return false;
  const l = clipboard;
  const exists = doc().doc.layers.some((x) => x.id === l.id);
  const copy = { ...structuredClone(l), id: newId(), x: l.x + (exists ? 10 : 0), y: l.y + (exists ? 10 : 0) };
  clipboard = copy;
  addLayer(copy, 'Paste');
  if (ws().side !== copy.side) ws().setSide(copy.side);
  return true;
}

/* ───────────── view & document ───────────── */

export function fit(): void {
  const { viewport, side } = ws();
  if (viewport.width < 10 || viewport.height < 10) return;
  const box = sheetBounds(doc().garment, side);
  // Leave room for the rulers, the tool rail, the label text and the zoom bar.
  ws().setView(
    fitView(box, viewport.width, viewport.height, 28, { left: 80, top: 34, right: 10, bottom: 80 }),
  );
}

export function newDesign(): void {
  useDoc.getState().load(createDoc(DEV_GARMENT.id, DEV_GARMENT.version, look.initial()));
  ws().setCropMode(false);
  ws().requestFit();
}

export { deg2rad };
