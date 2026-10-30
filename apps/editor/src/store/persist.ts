import { get as idbGet, set as idbSet } from 'idb-keyval';
import { parseDoc, type ProjectDoc } from '@gs/core';
import { ensureFont } from '../fonts';
import { restoreAssets } from './assets';
import { DEV_GARMENT, useDoc } from './doc';

// Local working copy: the current design survives reloads (as in the reference while signed out).
// Versioned cloud projects and multi-project storage arrive with sync (Stage 8, ADR-0009).

const KEY = 'work:doc';
const DEBOUNCE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
let listeners: ((s: SaveState) => void)[] = [];
export function onSaveState(fn: (s: SaveState) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
const emit = (s: SaveState) => listeners.forEach((l) => l(s));

/** Restores the working document. Returns the asset ids that could not be restored. */
export async function restoreWorkingCopy(): Promise<string[]> {
  let stored: unknown;
  try {
    stored = await idbGet(KEY);
  } catch {
    return [];
  }
  if (!stored) return [];
  let doc: ProjectDoc;
  try {
    doc = parseDoc(stored);
  } catch {
    // Unreadable or from an incompatible version: start fresh but keep the old copy for recovery.
    await idbSet(`${KEY}:corrupt:${Date.now()}`, stored).catch(() => undefined);
    return [];
  }
  if (doc.garment.modelId !== DEV_GARMENT.id) return [];
  const missing = await restoreAssets(Object.keys(doc.assets));
  await Promise.all(
    doc.layers.filter((l) => l.type === 'text').map((l) => ensureFont(l.font, l.weight, l.italic)),
  );
  useDoc.getState().load(doc);
  return missing;
}

/** Saves the document a moment after the last change (and immediately before the page unloads). */
export function startAutosave(): () => void {
  let timer: number | undefined;
  let lastRev = useDoc.getState().rev;
  const save = async () => {
    window.clearTimeout(timer);
    timer = undefined;
    const { doc, rev } = useDoc.getState();
    try {
      await idbSet(KEY, doc);
      // Only report "saved" if nothing changed while writing; otherwise the next save is pending.
      if (timer === undefined && useDoc.getState().rev === rev) emit('saved');
    } catch {
      emit('error');
    }
  };
  const unsub = useDoc.subscribe((s) => {
    if (s.rev === lastRev) return;
    lastRev = s.rev;
    // Unsaved from the moment of the change, not from when the debounced write starts.
    emit('saving');
    window.clearTimeout(timer);
    timer = window.setTimeout(save, DEBOUNCE_MS);
  });
  const flush = () => {
    if (timer !== undefined) void save();
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHidden);
  return () => {
    unsub();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHidden);
  };
}
