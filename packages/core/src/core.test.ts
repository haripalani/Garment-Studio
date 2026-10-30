import { describe, expect, it } from 'vitest';
import {
  apply,
  boxCorners,
  compose,
  createDevTee,
  createDoc,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  deg2rad,
  invert,
  parseDoc,
  pointInPolygon,
  rotate,
  signedArea,
  similarityFromSegments,
  FACTORY_LOOK,
  completeLook,
  translate,
  type Vec,
} from './index';

const close = (a: Vec, b: Vec) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('geometry', () => {
  it('inverts composed transforms', () => {
    const m = compose(translate(30, -12), rotate(deg2rad(37)), translate(-4, 9));
    close(apply(invert(m), apply(m, [11, 22])), [11, 22]);
  });

  it('maps segment endpoints with a similarity transform', () => {
    const m = similarityFromSegments([0, 0], [10, 0], [5, 5], [5, 25]);
    close(apply(m, [0, 0]), [5, 5]);
    close(apply(m, [10, 0]), [5, 25]);
    close(apply(m, [5, 0]), [5, 15]);
  });

  it('computes box corners and point-in-polygon', () => {
    const c = boxCorners(translate(10, 10), 4, 2);
    close(c[0], [8, 9]);
    close(c[2], [12, 11]);
    expect(pointInPolygon([10, 10], c)).toBe(true);
    expect(pointInPolygon([13, 10], c)).toBe(false);
  });
});

describe('dev garment', () => {
  const g = createDevTee();

  it('has clockwise outlines anchored at the bbox origin', () => {
    for (const p of g.pieces) {
      expect(signedArea(p.outlineMm)).toBeGreaterThan(0);
      const xs = p.outlineMm.map((v) => v[0]);
      const ys = p.outlineMm.map((v) => v[1]);
      expect(Math.min(...xs)).toBeCloseTo(0);
      expect(Math.min(...ys)).toBeCloseTo(0);
    }
  });

  it('has 6 outside and 9 inside pieces, like the reference tee', () => {
    expect(g.pieces.filter((p) => p.sides.includes('outside'))).toHaveLength(6);
    expect(g.pieces.filter((p) => p.sides.includes('inside'))).toHaveLength(9);
  });

  it('sews seam chords of similar length (within 15 %)', () => {
    for (const s of g.seams) {
      const pa = g.pieces.find((p) => p.id === s.a.piece)!.outlineMm;
      const pb = g.pieces.find((p) => p.id === s.b.piece)!.outlineMm;
      const la = Math.hypot(pa[s.a.to]![0] - pa[s.a.from]![0], pa[s.a.to]![1] - pa[s.a.from]![1]);
      const lb = Math.hypot(pb[s.b.to]![0] - pb[s.b.from]![0], pb[s.b.to]![1] - pb[s.b.from]![1]);
      expect(Math.abs(la - lb) / la).toBeLessThan(0.15);
    }
  });

  it('places every preset inside its piece', () => {
    for (const p of Object.values(g.presets)) {
      const piece = g.pieces.find((x) => x.id === p.piece)!;
      const xs = piece.outlineMm.map((v) => v[0]);
      const ys = piece.outlineMm.map((v) => v[1]);
      const pt: Vec = [p.fx * Math.max(...xs), p.fy * Math.max(...ys)];
      expect(pointInPolygon(pt, piece.outlineMm)).toBe(true);
    }
  });
});

describe('ProjectDoc', () => {
  it('validates a document built from the factories', () => {
    const doc = createDoc('dev-tee', '0.1.0');
    const place = { pieceId: 'front', side: 'outside' as const, x: 265, y: 240, w: 200, h: 80 };
    doc.layers.push(createTextLayer(place, 'Hello'), createShapeLayer(place, 'star'));
    doc.layers.push(createImageLayer(place, 'a1', 'logo.png'));
    doc.assets.a1 = {
      sha256: 'a'.repeat(64),
      mime: 'image/png',
      bytes: 10,
      width: 10,
      height: 10,
      name: 'logo.png',
    };
    expect(() => parseDoc(JSON.parse(JSON.stringify(doc)))).not.toThrow();
  });

  it('rejects invalid documents', () => {
    const doc = createDoc('dev-tee', '0.1.0') as unknown as Record<string, unknown>;
    expect(() => parseDoc({ ...doc, schemaVersion: 99 })).toThrow();
    expect(() => parseDoc({ ...doc, layers: [{ type: 'text' }] })).toThrow();
  });

  it('migrates a v1 document (no look) to v2 with the factory look', () => {
    const v2 = createDoc('dev-tee', '0.1.0');
    const { look: _drop, ...rest } = v2;
    const v1 = { ...rest, schemaVersion: 1 };
    const migrated = parseDoc(JSON.parse(JSON.stringify(v1)));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.look).toEqual(FACTORY_LOOK);
  });

  it('fills settings missing from a stored look', () => {
    const l = completeLook({ fabric: { color: '#000000' } });
    expect(l.fabric.color).toBe('#000000');
    expect(l.fabric.material).toBe(FACTORY_LOOK.fabric.material);
    expect(l.scene).toEqual(FACTORY_LOOK.scene);
  });
});

describe('canonical JSON', () => {
  it('sorts keys at every depth and drops undefined', async () => {
    const { canonicalJson, docSha256 } = await import('./canonical');
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: undefined, x: 2 }], c: 'é' } })).toBe(
      '{"a":{"c":"é","d":[1,{"x":2,"z":1}]},"b":1}',
    );
    expect(await docSha256({ b: 1, a: 2 })).toBe(await docSha256({ a: 2, b: 1 }));
    expect(await docSha256({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });
});
