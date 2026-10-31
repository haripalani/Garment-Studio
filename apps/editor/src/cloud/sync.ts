// Sync engine (ADR-0009): designs are saved locally first, then pushed as cloud revisions with
// optimistic concurrency. A newer cloud head is merged three ways (base, local, remote); a conflict
// keeps the cloud version and saves this device's version as "(conflicted copy)", so nothing is lost.
import { create } from 'zustand';
import { docSha256, mergeDocs, newId, type ProjectDoc } from '@gs/core';
import { useDoc } from '../store/doc';
import { library, onSaved, type LocalProject } from '../store/persist';
import { toast } from '../store/toast';
import { getStudio } from '../viewer/studioRef';
import { bakePiece } from '@gs/engine-2d';
import { assetSource } from '../store/assets';
import { ApiError, OfflineError, api, apiResponse, parseResponse } from './api';
import { canSync, useSession } from './session';
import { downloadDocAssets, uploadBlob, uploadDocAssets } from './uploads';
import { flushExportOutbox } from './exports';

export type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'unverified' | 'limit' | 'error';

interface Version {
  revision: number;
  doc: ProjectDoc;
  docSha256: string;
}
interface CloudProject {
  id: string;
  name: string;
  headRevision: number;
  head: Version;
  deleted: boolean;
}

export const useSync = create<{ state: SyncState; message: string | null; lastSyncedAt: number | null }>()(() => ({
  state: 'local',
  message: null,
  lastSyncedAt: null,
}));
const status = (state: SyncState, message: string | null = null) =>
  useSync.setState({ state, message, ...(state === 'synced' ? { lastSyncedAt: Date.now() } : {}) });

/** Stable id of this browser, so other devices' change notices can be told apart from our own. */
export function deviceId(): string {
  let id = localStorage.getItem('gs:device');
  if (!id) localStorage.setItem('gs:device', (id = newId()));
  return id;
}

const isOpen = (id: string) => useDoc.getState().doc.id === id;

/** Puts a newer version into the editor when the design is open (one undoable step). */
function showInEditor(id: string, doc: ProjectDoc, label: string) {
  if (isOpen(id)) useDoc.getState().replace(doc, label);
}

// One operation at a time per design.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(id, next);
  return next;
}

/**
 * Run `fn` once the open gesture ends. Ending a gesture doesn't change the document, so no save (and
 * no push) would follow on its own; without this its final state would wait for the next edit.
 */
function afterGesture(fn: () => void): void {
  const off = useDoc.subscribe((s) => {
    if (s.txn) return;
    off();
    fn();
  });
}

/** Resolves when the design's queued sync operations have finished. */
export function settled(id: string): Promise<void> {
  return (chains.get(id) ?? Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
}

/** The newest local document: the editor's state when open (it may be ahead of the saved record). */
function latestLocal(p: LocalProject): ProjectDoc {
  return isOpen(p.id) ? useDoc.getState().doc : p.doc;
}

async function report(e: unknown): Promise<void> {
  if (e instanceof OfflineError) return status('offline');
  if (e instanceof ApiError) {
    if (e.code === 'email_unverified') return status('unverified');
    if (e.status === 402) return status('limit', e.message);
    if (e.status === 401) return status('local');
    return status('error', e.message);
  }
  status('error', (e as Error).message);
}

/** Upload one design's pending changes (create the cloud project the first time). */
export function push(id: string): Promise<void> {
  return serial(id, async () => {
    const s = useSession.getState();
    if (!canSync(s)) return status(s.status === 'signedIn' ? 'unverified' : 'local');
    let p = await library.get(id);
    if (!p || p.deleted || !p.dirty) return;
    if (p.ownerId && p.ownerId !== s.user!.id) return; // another account's design on a shared device
    // A gesture in progress (drag, typing) is pushed when it ends.
    if (isOpen(id) && useDoc.getState().txn) return afterGesture(() => void push(id));
    status('syncing');
    try {
      const doc = latestLocal(p);
      await uploadDocAssets(doc);
      let revision: number;
      if (!p.cloud) {
        try {
          const created = await api<CloudProject>('/projects', {
            method: 'POST',
            body: { id, name: doc.name || 'Untitled design', doc, ...(p.conflictOf ? { conflictOf: p.conflictOf } : {}) },
          });
          revision = created.headRevision;
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'project_exists')) throw e;
          // Created by an earlier attempt whose reply was lost: carry on from the cloud head.
          const head = await fetchProject(id);
          if (head && head.head.docSha256 === (await docSha256(doc))) revision = head.headRevision;
          else if (head) return void (await reconcile({ ...p, cloud: { revision: 0, base: head.head.doc } }, head.head));
          else throw e;
        }
      } else {
        try {
          const v = await api<{ revision: number }>(`/projects/${id}/versions`, {
            method: 'POST',
            body: { baseRevision: p.cloud.revision, doc, docSha256: await docSha256(doc), platform: 'web', deviceId: deviceId() },
          });
          revision = v.revision;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'stale_revision') {
            return void (await reconcile(p, e.body.head as Version));
          }
          throw e;
        }
        if (p.doc.name !== doc.name || p.cloud.base.name !== doc.name) {
          await api(`/projects/${id}`, { method: 'PATCH', body: { name: doc.name || 'Untitled design' } }).catch(() => undefined);
        }
      }
      p = (await library.update(id, (r) => ({
        ...r,
        cloud: { revision, base: doc },
        ownerId: s.user!.id,
        // Changes made while uploading stay pending for the next push.
        dirty: JSON.stringify(latestLocal(r)) !== JSON.stringify(doc),
      })))!;
      status('synced');
      void updateThumbnail(id);
      if (p.dirty) void push(id);
    } catch (e) {
      await report(e);
    }
  });
}

/**
 * A newer cloud head exists. Merge it with this device's version: clean merges are applied (and pushed
 * if they include local changes); conflicts keep the cloud version and save ours as a conflicted copy.
 */
async function reconcile(p: LocalProject, head: Version): Promise<void> {
  const local = latestLocal(p);
  await downloadDocAssets(head.doc).catch(() => []);
  const base = p.cloud?.base ?? head.doc;
  if (!p.dirty || JSON.stringify(local) === JSON.stringify(base)) {
    await library.update(p.id, (r) => ({ ...r, doc: head.doc, cloud: { revision: head.revision, base: head.doc }, dirty: false }));
    showInEditor(p.id, head.doc, 'Changes from another device');
    return status('synced');
  }
  const m = mergeDocs(base, local, head.doc);
  if (m.ok) {
    await library.update(p.id, (r) => ({ ...r, doc: m.doc, cloud: { revision: head.revision, base: head.doc }, dirty: m.changed }));
    showInEditor(p.id, m.doc, 'Merged changes from another device');
    // The merged result includes local changes: push it (queued behind this operation).
    if (m.changed) void push(p.id);
    else status('synced');
    return;
  }
  // Conflict: our version becomes a new design; this one follows the cloud.
  const copyId = newId();
  const copy: ProjectDoc = { ...local, id: copyId, name: `${local.name || 'Untitled design'} (conflicted copy)`.slice(0, 120) };
  await library.put({ id: copyId, doc: copy, cloud: null, dirty: true, ownerId: p.ownerId, conflictOf: p.id, updatedAt: copy.updatedAt });
  await library.update(p.id, (r) => ({ ...r, doc: head.doc, cloud: { revision: head.revision, base: head.doc }, dirty: false }));
  showInEditor(p.id, head.doc, 'Newer version from another device');
  status('conflict', copy.name);
  toast(`This design was changed on another device at the same time. Your version was saved as “${copy.name}”.`);
  void push(copyId);
}

async function fetchProject(id: string, ifRevision?: number): Promise<CloudProject | null> {
  const res = await apiResponse(`/projects/${id}`, ifRevision ? { 'if-none-match': `"r${ifRevision}"` } : {});
  if (res.status === 304 || res.status === 404) return null;
  return parseResponse<CloudProject>(res);
}

/** Check the cloud for a newer version of a design (focus, live notice, timer). */
export function pull(id: string): Promise<void> {
  return serial(id, async () => {
    if (!canSync(useSession.getState())) return;
    const p = await library.get(id);
    if (!p?.cloud || p.deleted) return;
    if (isOpen(id) && useDoc.getState().txn) return afterGesture(() => void pull(id));
    try {
      const head = await fetchProject(id, p.cloud.revision);
      if (!head || head.headRevision <= p.cloud.revision) return;
      await reconcile(p, head.head);
    } catch (e) {
      await report(e);
    }
  });
}

/** Open a cloud design on this device (from the project browser). */
export async function fetchForOpen(id: string): Promise<ProjectDoc> {
  const head = await fetchProject(id);
  if (!head) throw new Error('This design is no longer in your account');
  const failed = await downloadDocAssets(head.head.doc);
  if (failed.length) toast(`${failed.length} image(s) could not be downloaded.`, 'error');
  const existing = await library.get(id);
  if (!existing || !existing.dirty) {
    await library.put({
      id,
      doc: head.head.doc,
      cloud: { revision: head.headRevision, base: head.head.doc },
      dirty: false,
      ownerId: useSession.getState().user?.id ?? null,
      updatedAt: head.head.doc.updatedAt,
      thumb: existing?.thumb ?? null,
    });
    return head.head.doc;
  }
  // Local edits that never reached the cloud: open them, then merge with the cloud head.
  void pull(id);
  return existing.doc;
}

const lastThumb = new Map<string, number>();
function pngOf(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('PNG encoding failed'))), 'image/png'));
}

/** A small picture of the design: the live 3D view when open, otherwise the front pattern piece. */
async function thumbnailBlob(): Promise<Blob> {
  const studio = getStudio();
  if (studio) return studio.snapshot(360, 'image/png');
  const { doc, garment } = useDoc.getState();
  const canvas = bakePiece(
    { garment, layers: doc.layers, side: 'outside', fabric: doc.look.fabric, markings: false, unit: 'mm', env: { asset: assetSource, fxMaxSide: 1024 } },
    { pieceId: garment.pieces[0]!.id, side: 'outside', pxPerMm: 0.5, background: true },
  );
  return pngOf(canvas);
}

/** Project-browser thumbnail, at most once a minute per design. */
async function updateThumbnail(id: string): Promise<void> {
  if (!isOpen(id) || Date.now() - (lastThumb.get(id) ?? 0) < 60_000) return;
  lastThumb.set(id, Date.now());
  try {
    const blob = await thumbnailBlob();
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const assetId = await uploadBlob(blob, sha, 'thumbnail');
    await api(`/projects/${id}/thumbnail`, { method: 'PUT', body: { assetId } });
    const dataUrl = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(blob);
    });
    await library.update(id, (r) => ({ ...r, thumb: dataUrl }));
  } catch (e) {
    // Thumbnails are a convenience; the next save tries again (after the 1-minute spacing).
    lastThumb.delete(id);
    if (import.meta.env.DEV) console.warn('thumbnail update failed', e);
  }
}

/** Starts background sync: push after local saves, pull on focus / reconnect / every minute. */
export function startSync(): () => void {
  const offSaved = onSaved((p) => {
    if (p.dirty) void push(p.id);
  });
  const current = () => useDoc.getState().doc.id;
  const catchUp = async () => {
    if (!canSync(useSession.getState())) return;
    const id = current();
    const p = await library.get(id);
    if (p?.dirty) await push(id);
    else if (p) await pull(id);
    // A new design nobody has edited yet: nothing to save anywhere.
    if (!p) status('synced');
    await flushExportOutbox();
  };
  const onFocus = () => void catchUp();
  const onOnline = () => void catchUp();
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => void catchUp(), 60_000);
  // Re-check when the account changes (sign-in, verification).
  const offSession = useSession.subscribe((s, prev) => {
    if (canSync(s) && !canSync(prev)) void catchUp();
    if (!canSync(s)) status(s.status === 'signedIn' ? 'unverified' : 'local');
  });
  void catchUp();
  return () => {
    offSaved();
    offSession();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
}

/** After signing in: designs on this device that belong to no account yet. */
export async function unclaimedProjects(): Promise<LocalProject[]> {
  return (await library.all()).filter((p) => !p.ownerId && !p.deleted && p.doc.layers.length > 0);
}

/** Upload designs made while signed out to the signed-in account. */
export async function claimProjects(ids: string[]): Promise<void> {
  for (const id of ids) {
    await library.update(id, (r) => ({ ...r, ownerId: useSession.getState().user!.id, dirty: true }));
    await push(id);
  }
}
