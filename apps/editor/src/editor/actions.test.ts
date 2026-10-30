import { createShapeLayer, createDoc, parseDoc } from '@gs/core';
import { frameFor, layerBounds } from '@gs/engine-2d';
import { DEV_GARMENT, useDoc } from '../store/doc';
import { FACTORY_LOOK, look } from '../store/look';
import { useWorkspace } from '../store/workspace';
import {
  addShapeFromDrag,
  addText,
  align,
  applyPreset,
  copySelection,
  deleteLayer,
  duplicateLayer,
  moveInStack,
  nudge,
  pasteLayer,
  rotateBy,
  update,
} from './actions';

const d = () => useDoc.getState();

function addRect(x = 265, y = 300, id?: string) {
  const l = createShapeLayer({ pieceId: 'front', side: 'outside', x, y, w: 100, h: 50 }, 'rect');
  if (id) l.id = id;
  d().edit('Add', (doc) => {
    doc.layers.unshift(l);
  });
  return l.id;
}

beforeEach(() => {
  useDoc.getState().load(createDoc(DEV_GARMENT.id, DEV_GARMENT.version));
  useWorkspace.setState({ side: 'outside', tool: 'select', cropMode: false });
});

describe('document history', () => {
  it('undoes and redoes single edits', () => {
    const id = addRect();
    update(id, { x: 300 });
    expect(d().doc.layers[0]!.x).toBe(300);
    d().undo();
    expect(d().doc.layers[0]!.x).toBe(265);
    d().undo();
    expect(d().doc.layers).toHaveLength(0);
    d().redo();
    d().redo();
    expect(d().doc.layers[0]!.x).toBe(300);
  });

  it('turns a gesture into one undo step', () => {
    const id = addRect();
    const before = d().past.length;
    d().begin('Move');
    for (let i = 1; i <= 20; i++) update(id, { x: 265 + i });
    d().commit();
    expect(d().past.length).toBe(before + 1);
    d().undo();
    expect(d().doc.layers[0]!.x).toBe(265);
  });

  it('cancel reverts an open gesture', () => {
    const id = addRect();
    d().begin('Move');
    update(id, { x: 999 });
    d().cancel();
    expect(d().doc.layers[0]!.x).toBe(265);
  });

  it('a new edit clears the redo stack', () => {
    const id = addRect();
    update(id, { x: 1 });
    d().undo();
    expect(d().future).toHaveLength(1);
    update(id, { x: 2 });
    expect(d().future).toHaveLength(0);
  });

  it('drops the selection when undo removes the selected layer', () => {
    const id = addRect();
    d().select(id);
    d().undo();
    expect(d().selectedId).toBeNull();
  });

  it('ignores no-op edits (no history entry, no dirty revision)', () => {
    const id = addRect();
    const past = d().past.length;
    const rev = d().rev;
    update(id, { x: 265 });
    expect(d().past.length).toBe(past);
    expect(d().rev).toBe(rev);
  });

  it('merges rapid changes to the same look setting into one undo step', () => {
    const past = d().past.length;
    for (let i = 1; i <= 10; i++) look.setFabric({ wrinkleStrength: i / 10 });
    expect(d().past.length).toBe(past + 1);
    look.setFabric({ color: '#141516' }); // a different setting is its own step
    expect(d().past.length).toBe(past + 2);
    d().undo();
    d().undo();
    expect(d().doc.look.fabric.wrinkleStrength).toBe(FACTORY_LOOK.fabric.wrinkleStrength);
  });

  it('keeps the document valid after edits', () => {
    const id = addRect();
    rotateBy(id, 90);
    nudge(id, 5, -5);
    expect(() => parseDoc(JSON.parse(JSON.stringify(d().doc)))).not.toThrow();
  });
});

describe('layer commands', () => {
  it('adds text at the chest and selects it', async () => {
    await addText();
    const l = d().doc.layers[0]!;
    expect(l.type).toBe('text');
    expect(l.pieceId).toBe('front');
    expect(d().selectedId).toBe(l.id);
  });

  it('adds shapes where they are drawn and ignores drags off the pattern', () => {
    const f = frameFor(DEV_GARMENT, 'outside', 'back')!;
    const ox = f.toSheet[4];
    const oy = f.toSheet[5];
    addShapeFromDrag('circle', [ox + 100, oy + 300], [ox + 200, oy + 360], false);
    const l = d().doc.layers[0]!;
    expect(l.pieceId).toBe('back');
    expect(l.w).toBeCloseTo(100);
    expect(l.h).toBeCloseTo(100); // circles stay even
    addShapeFromDrag('rect', [-900, -900], [-800, -800], false);
    expect(d().doc.layers).toHaveLength(1);
  });

  it('applies placement presets, switching side when needed', () => {
    const id = addRect();
    applyPreset(id, 'backNeck');
    let l = d().doc.layers[0]!;
    expect(l.pieceId).toBe('back');
    expect(l.w / l.h).toBeCloseTo(2);
    applyPreset(id, 'printedLabel');
    l = d().doc.layers[0]!;
    expect(l.side).toBe('inside');
    expect(useWorkspace.getState().side).toBe('inside');
  });

  it('aligns to the piece', () => {
    const id = addRect();
    align(id, 'right');
    const f = frameFor(DEV_GARMENT, 'outside', 'front')!;
    const b = layerBounds(d().doc.layers[0]!);
    expect(b.x + b.w).toBeCloseTo(f.w);
  });

  it('duplicates above the original and deletes', () => {
    const id = addRect();
    duplicateLayer(id);
    expect(d().doc.layers).toHaveLength(2);
    expect(d().doc.layers[1]!.id).toBe(id);
    const copy = d().doc.layers[0]!;
    expect(copy.x).toBe(275);
    deleteLayer(copy.id);
    expect(d().doc.layers.map((l) => l.id)).toEqual([id]);
  });

  it('reorders the stack', () => {
    const a = addRect(100, 100, 'aaaaaaaa');
    const b = addRect(110, 110, 'bbbbbbbb');
    const c = addRect(120, 120, 'cccccccc');
    expect(d().doc.layers.map((l) => l.id)).toEqual([c, b, a]);
    moveInStack(a, 0);
    expect(d().doc.layers.map((l) => l.id)).toEqual([a, c, b]);
    moveInStack(a, 99);
    expect(d().doc.layers.map((l) => l.id)).toEqual([c, b, a]);
  });

  it('copies and pastes with an offset', () => {
    const id = addRect();
    d().select(id);
    expect(copySelection()).toBe(true);
    expect(pasteLayer()).toBe(true);
    expect(d().doc.layers).toHaveLength(2);
    expect(d().doc.layers[0]!.x).toBe(275);
    expect(d().selectedId).toBe(d().doc.layers[0]!.id);
  });
});
