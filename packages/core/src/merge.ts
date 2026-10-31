// Three-way merge of design documents for sync (ADR-0009). `base` is the last revision both sides
// shared, `local` is this device's version, `remote` is the newer cloud head.
// Merges at layer granularity (by layer id) and per section of the look. Anything both sides changed
// differently is a conflict: the caller then keeps the remote head and saves local as a conflicted copy,
// so nothing is silently dropped.
import { canonicalJson } from './canonical';
import type { Layer, ProjectDoc } from './doc';

export type MergeResult = { ok: true; doc: ProjectDoc; changed: boolean } | { ok: false; conflicts: string[] };

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Classic three-way pick for one value; `undefined` + conflict flag when both sides changed it differently. */
function pick<T>(base: T, local: T, remote: T): { value: T; conflict: boolean } {
  if (same(local, remote)) return { value: remote, conflict: false };
  if (same(local, base)) return { value: remote, conflict: false };
  if (same(remote, base)) return { value: local, conflict: false };
  return { value: local, conflict: true };
}

/** Relative order of the ids common to `a` and `ids`. */
const orderOf = (layers: readonly Layer[], ids: Set<string>) => layers.filter((l) => ids.has(l.id)).map((l) => l.id);

export function mergeDocs(base: ProjectDoc, local: ProjectDoc, remote: ProjectDoc): MergeResult {
  const conflicts: string[] = [];
  if (same(local, remote)) return { ok: true, doc: remote, changed: false };

  const garment = pick(base.garment, local.garment, remote.garment);
  if (garment.conflict) conflicts.push('garment');
  const name = pick(base.name, local.name, remote.name);
  if (name.conflict) conflicts.push('name');
  const look = { ...remote.look };
  for (const k of ['fabric', 'light', 'scene'] as const) {
    const r = pick(base.look[k], local.look[k], remote.look[k]);
    if (r.conflict) conflicts.push(`look.${k}`);
    (look as Record<string, unknown>)[k] = r.value;
  }

  // ── Layers, by id ──
  const byId = (d: ProjectDoc) => new Map(d.layers.map((l) => [l.id, l]));
  const B = byId(base);
  const L = byId(local);
  const R = byId(remote);
  const merged = new Map<string, Layer>();
  for (const id of new Set([...B.keys(), ...L.keys(), ...R.keys()])) {
    const b = B.get(id);
    const l = L.get(id);
    const r = R.get(id);
    if (!b) {
      // Added on one or both sides (ids are random, so a shared id is the same layer).
      if (l && r && !same(l, r)) conflicts.push(`layer ${id}`);
      merged.set(id, (r ?? l)!);
      continue;
    }
    if (!l && !r) continue; // deleted on both sides
    if (!l || !r) {
      // Deleted on one side: fine unless the other side edited it meanwhile.
      const kept = (l ?? r)!;
      if (!same(kept, b)) {
        conflicts.push(`layer ${id}`);
        merged.set(id, kept);
      }
      continue;
    }
    const p = pick(b, l, r);
    if (p.conflict) conflicts.push(`layer ${id}`);
    merged.set(id, p.value);
  }

  // ── Stacking order: whichever side reordered the shared layers wins; both = conflict ──
  const common = new Set([...B.keys()].filter((id) => L.has(id) && R.has(id)));
  const bo = orderOf(base.layers, common);
  const lo = orderOf(local.layers, common);
  const ro = orderOf(remote.layers, common);
  const localReordered = !same(lo, bo);
  const remoteReordered = !same(ro, bo);
  if (localReordered && remoteReordered && !same(lo, ro)) conflicts.push('layer order');
  const primary = localReordered && !remoteReordered ? local : remote;
  const secondary = primary === local ? remote : local;
  const order = primary.layers.map((l) => l.id).filter((id) => merged.has(id));
  // Layers only the other side has: insert after their nearest preceding neighbour in that side's order.
  secondary.layers.forEach((l, i) => {
    if (!merged.has(l.id) || order.includes(l.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(secondary.layers[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, l.id);
  });

  if (conflicts.length) return { ok: false, conflicts };

  const layers = order.map((id) => merged.get(id)!);
  // Asset references: whatever the merged layers still use, from either side.
  const assets: ProjectDoc['assets'] = {};
  for (const l of layers) {
    if (l.type !== 'image') continue;
    const ref = remote.assets[l.assetId] ?? local.assets[l.assetId];
    if (ref) assets[l.assetId] = ref;
  }
  const doc: ProjectDoc = {
    ...remote,
    name: name.value,
    garment: garment.value,
    look,
    layers,
    assets,
    updatedAt: new Date(Math.max(Date.parse(local.updatedAt) || 0, Date.parse(remote.updatedAt) || 0)).toISOString(),
  };
  return { ok: true, doc, changed: !same({ ...doc, updatedAt: '' }, { ...remote, updatedAt: '' }) };
}
