import { describe, expect, it } from 'vitest';
import { createDevTee } from './devTee';
import { createDoc, createImageLayer, createTextLayer, isCloudId, newId, type ProjectDoc } from './doc';
import { mergeDocs } from './merge';

const g = createDevTee();
const place = { pieceId: 'front', side: 'outside' as const, x: 100, y: 100, w: 100, h: 40 };

function base(): ProjectDoc {
  const d = createDoc(g.id, g.version);
  d.layers.push({ ...createTextLayer(place, 'A'), id: 'a' }, { ...createTextLayer(place, 'B'), id: 'b' }, { ...createTextLayer(place, 'C'), id: 'c' });
  return d;
}
const clone = (d: ProjectDoc) => structuredClone(d);
const ids = (d: ProjectDoc) => d.layers.map((l) => l.id);
const merged = (b: ProjectDoc, l: ProjectDoc, r: ProjectDoc) => {
  const m = mergeDocs(b, l, r);
  if (!m.ok) throw new Error(`unexpected conflict: ${m.conflicts.join(', ')}`);
  return m.doc;
};

describe('ids', () => {
  it('are valid cloud ids and unique', () => {
    const set = new Set(Array.from({ length: 2000 }, newId));
    expect(set.size).toBe(2000);
    for (const id of set) expect(isCloudId(id)).toBe(true);
    expect(isCloudId('abc')).toBe(false);
  });
});

describe('three-way merge', () => {
  it('identical sides merge to remote with no change', () => {
    const b = base();
    const m = mergeDocs(b, clone(b), clone(b));
    expect(m).toMatchObject({ ok: true, changed: false });
  });

  it('edits to different layers on each side both survive', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers[0]!.x = 300;
    r.layers[2]!.rotationDeg = 45;
    const d = merged(b, l, r);
    expect(d.layers[0]!.x).toBe(300);
    expect(d.layers[2]!.rotationDeg).toBe(45);
  });

  it('additions on both sides are kept, each near its neighbour', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers.splice(1, 0, { ...createTextLayer(place, 'L'), id: 'l1' }); // after a
    r.layers.push({ ...createTextLayer(place, 'R'), id: 'r1' }); // after c
    expect(ids(merged(b, l, r))).toEqual(['a', 'l1', 'b', 'c', 'r1']);
  });

  it('a deletion on one side wins over an untouched layer on the other', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers = l.layers.filter((x) => x.id !== 'b');
    r.layers[0]!.y = 9;
    const d = merged(b, l, r);
    expect(ids(d)).toEqual(['a', 'c']);
    expect(d.layers[0]!.y).toBe(9);
  });

  it('the same layer changed differently on both sides is a conflict', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers[0]!.x = 1;
    r.layers[0]!.x = 2;
    expect(mergeDocs(b, l, r)).toEqual({ ok: false, conflicts: ['layer a'] });
  });

  it('the same change on both sides is not a conflict', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers[1]!.w = 222;
    r.layers[1]!.w = 222;
    expect(merged(b, l, r).layers[1]!.w).toBe(222);
  });

  it('deleted on one side but edited on the other is a conflict (the edit is not lost)', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers = l.layers.filter((x) => x.id !== 'c');
    r.layers[2]!.opacity = 0.5;
    expect(mergeDocs(b, l, r)).toEqual({ ok: false, conflicts: ['layer c'] });
  });

  it('a reorder on one side applies; reorders on both sides that differ conflict', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.layers.reverse();
    r.layers[1]!.x = 7;
    const d = merged(b, l, r);
    expect(ids(d)).toEqual(['c', 'b', 'a']);
    expect(d.layers[1]!.x).toBe(7);
    const r2 = clone(b);
    r2.layers = [r2.layers[1]!, r2.layers[0]!, r2.layers[2]!];
    expect(mergeDocs(b, l, r2)).toEqual({ ok: false, conflicts: ['layer order'] });
  });

  it('look sections merge independently; the same section changed on both sides conflicts', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.look.fabric.color = '#26365a';
    r.look.scene.hanger = !b.look.scene.hanger;
    const d = merged(b, l, r);
    expect(d.look.fabric.color).toBe('#26365a');
    expect(d.look.scene.hanger).toBe(!b.look.scene.hanger);
    const r2 = clone(b);
    r2.look.fabric.color = '#ffffff';
    expect(mergeDocs(b, l, r2)).toEqual({ ok: false, conflicts: ['look.fabric'] });
  });

  it('garment changes on both sides conflict', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.garment.modelVersion = '0.2.0';
    r.garment.modelVersion = '0.3.0';
    expect(mergeDocs(b, l, r)).toMatchObject({ ok: false, conflicts: ['garment'] });
  });

  it('keeps asset references for images from either side and drops unused ones', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    const ref = { sha256: 'a'.repeat(64), mime: 'image/png', bytes: 1, width: 1, height: 1, name: 'x.png' };
    l.assets.img = ref;
    l.layers.push({ ...createImageLayer(place, 'img', 'x.png'), id: 'i' });
    r.assets.old = { ...ref, sha256: 'b'.repeat(64) }; // referenced by no layer
    const d = merged(b, l, r);
    expect(Object.keys(d.assets)).toEqual(['img']);
  });

  it('reports changed only when the result differs from remote', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    r.layers[0]!.x = 5;
    expect(mergeDocs(b, l, r)).toMatchObject({ ok: true, changed: false });
    l.layers[1]!.x = 6;
    expect(mergeDocs(b, l, r)).toMatchObject({ ok: true, changed: true });
  });
});
