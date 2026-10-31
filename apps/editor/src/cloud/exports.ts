// Exports run in the browser; signed-in exports are recorded so the plan's monthly quota counts them
// (ADR-0012/0020). Recorded before the file is built, so a used-up quota stops the export. Offline
// exports are queued and reported when the connection is back.
import { useDoc } from '../store/doc';
import { library } from '../store/persist';
import { ApiError, OfflineError, api } from './api';
import { useSession } from './session';
import { push } from './sync';
import { watermark } from '../render/watermark';

export type ExportKind = 'snapshot' | 'print_zip' | 'sublimation_zip' | 'spec_pdf' | 'turntable_video';
type Params = { dpi?: number; bleedMm?: number; durationSec?: number; resolution?: string };

const OUTBOX = 'gs:export-outbox';

export class ExportBlocked extends Error {}


/** Throws ExportBlocked when the plan's export quota is used up; otherwise records the export. */
export async function recordExport(kind: ExportKind, params: Params = {}): Promise<void> {
  const s = useSession.getState();
  if (s.status !== 'signedIn' || !s.user?.emailVerified) return;
  const id = useDoc.getState().doc.id;
  await push(id);
  const p = await library.get(id);
  if (!p?.cloud) return; // not in the account yet (e.g. plan's project limit): nothing to count against
  const body = { key: `exp-${crypto.randomUUID()}`, projectId: id, revision: p.cloud.revision, kind, ranOn: 'client', params };
  try {
    const { key: _key, ...payload } = body;
    await api('/exports', { method: 'POST', body: payload, headers: { 'idempotency-key': body.key } });
    void useSession.getState().reloadEntitlements();
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) throw new ExportBlocked(e.message);
    if (e instanceof OfflineError) {
      const queue = JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as unknown[];
      queue.push({ ...body, performedAt: new Date().toISOString() });
      localStorage.setItem(OUTBOX, JSON.stringify(queue.slice(-200)));
      return;
    }
    throw e;
  }
}

/** Report exports made while offline (called when sync catches up). */
export async function flushExportOutbox(): Promise<void> {
  const queue = JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Record<string, unknown>[];
  const left: Record<string, unknown>[] = [];
  for (const item of queue) {
    try {
      const { key, ...payload } = item;
      await api('/exports', { method: 'POST', body: payload, headers: { 'idempotency-key': String(key) } });
    } catch (e) {
      if (e instanceof OfflineError) left.push(item);
      // Over quota or invalid later: the export already happened; drop the report.
    }
  }
  localStorage.setItem(OUTBOX, JSON.stringify(left));
}

/** True when the signed-in plan wants a watermark on pictures and videos. */
export const needsWatermark = () => useSession.getState().entitlements?.limits.watermark === true;

/** A PNG with the watermark added. */
export async function watermarkPng(png: Blob): Promise<Blob> {
  const c = watermark(await createImageBitmap(png));
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('PNG encoding failed'))), 'image/png'));
}

export { watermark };
