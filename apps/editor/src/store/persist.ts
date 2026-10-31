// The local library (ADR-0009): every design lives on this device first, in IndexedDB, with the
// bookkeeping sync needs (the last cloud revision and the document at that revision, for merging).
// Signed out, designs are simply local; signed in, the sync engine (cloud/sync.ts) uploads them.
import { createStore, del, entries, get, set } from 'idb-keyval';
import { isCloudId, parseDoc, type ProjectDoc } from '@gs/core';
import { ensureFont } from '../fonts';
import { restoreAssets } from './assets';
import { DEV_GARMENT, useDoc } from './doc';

export interface LocalProject {
  id: string;
  doc: ProjectDoc;
  /** The cloud revision this copy is based on, and the document at that revision (merge base). */
  cloud: { revision: number; base: ProjectDoc } | null;
  /** Local changes not yet in the cloud. */
  dirty: boolean;
  /** Account this design syncs with; null = this device only. */
  ownerId: string | null;
  /** Set when this design is the conflicted copy of another. */
  conflictOf?: string | null;
  /** Small preview (data URL) for the project browser. */
  thumb?: string | null;
  deleted?: boolean;
  updatedAt: string;
}

const store = createStore('gs-library', 'projects');
const CURRENT = 'gs:current';
const LEGACY_KEY = 'work:doc';
const DEBOUNCE_MS = 800;

export const library = {
  get: (id: string) => get<LocalProject>(id, store),
  put: (p: LocalProject) => set(p.id, p, store),
  remove: (id: string) => del(id, store),
  async all(): Promise<LocalProject[]> {
    return (await entries<string, LocalProject>(store)).map(([, p]) => p);
  },
  /** Update a record in place (no-op if it disappeared). */
  async update(id: string, fn: (p: LocalProject) => LocalProject | void): Promise<LocalProject | undefined> {
    const p = await get<LocalProject>(id, store);
    if (!p) return undefined;
    const next = fn(p) ?? p;
    await set(id, next, store);
    return next;
  },
};

export const currentProjectId = () => localStorage.getItem(CURRENT);
const setCurrent = (id: string) => localStorage.setItem(CURRENT, id);

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
let listeners: ((s: SaveState) => void)[] = [];
export function onSaveState(fn: (s: SaveState) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
const emit = (s: SaveState) => listeners.forEach((l) => l(s));

/** Valid document or null (an unreadable copy is kept aside for recovery). */
async function readDoc(raw: unknown, key: string): Promise<ProjectDoc | null> {
  try {
    return parseDoc(raw);
  } catch {
    await set(`${key}:corrupt:${Date.now()}`, raw).catch(() => undefined);
    return null;
  }
}

/** Opens a design in the editor: assets and fonts first, then the document. Returns missing asset ids. */
export async function openDoc(doc: ProjectDoc): Promise<string[]> {
  const missing = await restoreAssets(Object.keys(doc.assets));
  await Promise.all(doc.layers.filter((l) => l.type === 'text').map((l) => ensureFont(l.font, l.weight, l.italic)));
  setCurrent(doc.id);
  useDoc.getState().load(doc);
  return missing;
}

/**
 * Pre-Stage-8 ids were 16 characters; the cloud needs 20–32. Padding is deterministic, so running the
 * migration twice (two tabs, or React's double effects in development) can't create two copies.
 */
export const cloudIdFor = (id: string) => (isCloudId(id) ? id : `${id.toLowerCase().replace(/[^a-z0-9]/g, '')}${'0'.repeat(24)}`.slice(0, 24));

let migrating: Promise<void> | null = null;
/** The Stage 4–7 single working copy becomes the first library entry (with a cloud-valid id). */
function migrateLegacy(): Promise<void> {
  migrating ??= (async () => {
    const raw = await get(LEGACY_KEY).catch(() => undefined);
    if (!raw) return;
    const doc = await readDoc(raw, LEGACY_KEY);
    if (doc) {
      const fixed = { ...doc, id: cloudIdFor(doc.id) };
      if (!(await library.get(fixed.id))) {
        await library.put({ id: fixed.id, doc: fixed, cloud: null, dirty: true, ownerId: null, updatedAt: fixed.updatedAt });
      }
      setCurrent(fixed.id);
    }
    await del(LEGACY_KEY);
  })();
  return migrating;
}

/** Restores the design that was open last. Returns the asset ids that could not be restored. */
export async function restoreWorkingCopy(): Promise<string[]> {
  try {
    await migrateLegacy();
    const id = currentProjectId();
    const p = id ? await library.get(id) : undefined;
    if (!p || p.deleted) return [];
    const doc = await readDoc(p.doc, `project:${p.id}`);
    if (!doc || doc.garment.modelId !== DEV_GARMENT.id) return [];
    return await openDoc(doc);
  } catch {
    return [];
  }
}

/** A new design nobody has touched: not worth keeping as a project. */
export const isUntouched = (doc: ProjectDoc) => doc.layers.length === 0 && doc.createdAt === doc.updatedAt;

/** Saves the open design unless it is new and untouched (it would only clutter the project list). */
export async function saveOpenDesign(): Promise<void> {
  const { doc } = useDoc.getState();
  if (!isUntouched(doc) || (await library.get(doc.id))) await saveCurrent(doc);
}

/** Saves a design (by default the open one) to the library, creating its record on first save. */
export async function saveCurrent(doc: ProjectDoc = useDoc.getState().doc): Promise<LocalProject> {
  if (!isCloudId(doc.id)) {
    // Designs from before Stage 8 get a cloud-valid id once (not an undoable edit).
    const fixed = { ...doc, id: cloudIdFor(doc.id) };
    if (useDoc.getState().doc === doc) useDoc.setState({ doc: fixed });
    return saveCurrent(fixed);
  }
  const prev = await library.get(doc.id);
  const next: LocalProject = {
    id: doc.id,
    doc,
    cloud: prev?.cloud ?? null,
    dirty: prev ? prev.dirty || !prev.cloud || JSON.stringify(prev.doc) !== JSON.stringify(doc) : true,
    ownerId: prev?.ownerId ?? null,
    conflictOf: prev?.conflictOf ?? null,
    thumb: prev?.thumb ?? null,
    deleted: false,
    updatedAt: doc.updatedAt,
  };
  await library.put(next);
  if (useDoc.getState().doc.id === doc.id) setCurrent(doc.id);
  return next;
}

type SavedListener = (p: LocalProject) => void;
let savedListeners: SavedListener[] = [];
/** Called after every successful local save (the sync engine pushes from here). */
export function onSaved(fn: SavedListener): () => void {
  savedListeners.push(fn);
  return () => {
    savedListeners = savedListeners.filter((l) => l !== fn);
  };
}

/** Saves the document a moment after the last change (and immediately before the page unloads). */
export function startAutosave(): () => void {
  let timer: number | undefined;
  let lastRev = useDoc.getState().rev;
  const save = async () => {
    window.clearTimeout(timer);
    timer = undefined;
    const { rev } = useDoc.getState();
    try {
      const p = await saveCurrent();
      // Only report "saved" if nothing changed while writing; otherwise the next save is pending.
      if (timer === undefined && useDoc.getState().rev === rev) emit('saved');
      savedListeners.forEach((l) => l(p));
    } catch {
      emit('error');
    }
  };
  const unsub = useDoc.subscribe((s, prev) => {
    if (s.rev === lastRev) return;
    lastRev = s.rev;
    // Another design was opened while a save was pending: save the previous one now, or its last
    // edits would be lost (the debounced save only sees the newly opened design).
    if (s.doc.id !== prev.doc.id && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
      void saveCurrent(prev.doc).then((p) => savedListeners.forEach((l) => l(p)));
    }
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
