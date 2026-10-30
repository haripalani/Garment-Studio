import { create } from 'zustand';
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { createDevTee, createDoc, type GarmentModel, type Layer, type ProjectDoc } from '@gs/core';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Edits with the same merge key within MERGE_MS join this entry (slider drags, repeated nudges). */
  mergeKey?: string;
  at?: number;
}

const MERGE_MS = 800;

const HISTORY_LIMIT = 200;

// The development garment until the catalogue exists (Stage 5, ADR-0007).
export const DEV_GARMENT: GarmentModel = createDevTee();

interface DocState {
  doc: ProjectDoc;
  garment: GarmentModel;
  selectedId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Open gesture (drag, slider, typing): edits accumulate here and become one undo step. */
  txn: HistoryEntry | null;
  /** Increments on every document change (cheap change detection for renderers and autosave). */
  rev: number;

  /** Apply an edit. Inside a transaction it joins the gesture; otherwise it is its own undo step. */
  edit: (label: string, recipe: (d: Draft<ProjectDoc>) => void, opts?: { merge?: string }) => void;
  begin: (label: string) => void;
  commit: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  /** Replace the whole document (load / new design). Clears history. */
  load: (doc: ProjectDoc) => void;
}

function stamp(d: Draft<ProjectDoc>) {
  d.updatedAt = new Date().toISOString();
}

export const useDoc = create<DocState>()((set, get) => ({
  doc: createDoc(DEV_GARMENT.id, DEV_GARMENT.version),
  garment: DEV_GARMENT,
  selectedId: null,
  past: [],
  future: [],
  txn: null,
  rev: 0,

  edit: (label, recipe, opts) => {
    const s = get();
    const [changed, p1, i1] = produceWithPatches(s.doc, recipe);
    // No-op edits (same values) must not create history entries or mark the document dirty.
    if (p1.length === 0) return;
    const [next, p2, i2] = produceWithPatches(changed, stamp);
    const patches = [...p1, ...p2];
    const inverse = [...i2, ...i1];
    if (s.txn) {
      set({
        doc: next,
        rev: s.rev + 1,
        txn: { ...s.txn, patches: [...s.txn.patches, ...patches], inverse: [...inverse, ...s.txn.inverse] },
      });
      return;
    }
    const now = Date.now();
    const last = s.past[s.past.length - 1];
    if (opts?.merge && last?.mergeKey === opts.merge && now - (last.at ?? 0) < MERGE_MS && s.future.length === 0) {
      const merged: HistoryEntry = {
        ...last,
        patches: [...last.patches, ...patches],
        inverse: [...inverse, ...last.inverse],
        at: now,
      };
      set({ doc: next, rev: s.rev + 1, past: [...s.past.slice(0, -1), merged] });
      return;
    }
    const entry: HistoryEntry = { label, patches, inverse, at: now, ...(opts?.merge ? { mergeKey: opts.merge } : {}) };
    set({ doc: next, rev: s.rev + 1, past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] });
  },

  begin: (label) => {
    if (!get().txn) set({ txn: { label, patches: [], inverse: [] } });
  },

  commit: () => {
    const { txn, past } = get();
    if (!txn) return;
    if (txn.patches.length === 0) return set({ txn: null });
    set({ txn: null, past: [...past, txn].slice(-HISTORY_LIMIT), future: [] });
  },

  cancel: () => {
    const { txn, doc, rev } = get();
    if (!txn) return;
    set({ txn: null, doc: applyPatches(doc, txn.inverse), rev: rev + 1 });
  },

  undo: () => {
    get().commit();
    const { past, future, doc, rev, selectedId } = get();
    const e = past[past.length - 1];
    if (!e) return;
    const next = applyPatches(doc, e.inverse);
    set({
      doc: next,
      rev: rev + 1,
      past: past.slice(0, -1),
      future: [e, ...future],
      selectedId: next.layers.some((l) => l.id === selectedId) ? selectedId : null,
    });
  },

  redo: () => {
    const { past, future, doc, rev, selectedId } = get();
    const e = future[0];
    if (!e) return;
    const next = applyPatches(doc, e.patches);
    set({
      doc: next,
      rev: rev + 1,
      past: [...past, e],
      future: future.slice(1),
      selectedId: next.layers.some((l) => l.id === selectedId) ? selectedId : null,
    });
  },

  select: (selectedId) => set({ selectedId }),

  load: (doc) => set({ doc, selectedId: null, past: [], future: [], txn: null, rev: get().rev + 1 }),
}));

export function selectedLayer(s: Pick<DocState, 'doc' | 'selectedId'>): Layer | undefined {
  return s.selectedId ? s.doc.layers.find((l) => l.id === s.selectedId) : undefined;
}

export const useSelected = () => useDoc((s) => selectedLayer(s));

/** Mutable access to a layer inside an edit recipe. */
export function draftLayer(d: Draft<ProjectDoc>, id: string): Draft<Layer> | undefined {
  return d.layers.find((l) => l.id === id);
}
