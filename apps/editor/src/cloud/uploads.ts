// Images go straight from the browser to storage with presigned part URLs (ADR-0014); the API only
// hands out tickets. Content-addressed: an image already in the account is never uploaded twice.
import type { AssetRef, ProjectDoc } from '@gs/core';
import { assetBlob, storeCloudAsset } from '../store/assets';
import { api } from './api';

interface Ticket {
  asset: { id: string };
  deduped: boolean;
  partSize?: number;
  parts?: { partNumber: number; url: string }[];
}

/** Hashes already confirmed in the cloud this session. */
const known = new Set<string>();

export async function uploadBlob(blob: Blob, sha256: string, kind: 'artwork' | 'thumbnail'): Promise<string> {
  const t = await api<Ticket>('/assets/uploads', { method: 'POST', body: { sha256, bytes: blob.size, mime: blob.type, kind } });
  if (t.deduped || !t.parts) return t.asset.id;
  const parts: { partNumber: number; etag: string }[] = [];
  for (const p of t.parts) {
    const slice = blob.slice((p.partNumber - 1) * t.partSize!, p.partNumber * t.partSize!);
    const res = await fetch(p.url, { method: 'PUT', body: slice });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    const etag = res.headers.get('etag');
    if (!etag) throw new Error('Storage did not return an ETag (check the bucket CORS policy)');
    parts.push({ partNumber: p.partNumber, etag });
  }
  await api(`/assets/${t.asset.id}/complete`, { method: 'POST', body: { parts } });
  return t.asset.id;
}

/** Uploads every image a design uses that the account doesn't have yet. */
export async function uploadDocAssets(doc: ProjectDoc): Promise<void> {
  for (const [id, ref] of Object.entries(doc.assets) as [string, AssetRef][]) {
    if (known.has(ref.sha256)) continue;
    const blob = await assetBlob(id);
    if (!blob) throw new Error(`The image "${ref.name}" is missing on this device`);
    await uploadBlob(blob.type ? blob : new Blob([blob], { type: ref.mime }), ref.sha256, 'artwork');
    known.add(ref.sha256);
  }
}

/** Downloads the images of a design that this device doesn't have (opening it from the cloud). */
export async function downloadDocAssets(doc: ProjectDoc): Promise<string[]> {
  const missing: [string, AssetRef][] = [];
  for (const [id, ref] of Object.entries(doc.assets) as [string, AssetRef][]) {
    if (!(await assetBlob(id))) missing.push([id, ref]);
  }
  if (!missing.length) return [];
  const qs = missing.map(([, r]) => `sha256=${r.sha256}`).join('&');
  const found = await api<{ items: { sha256: string; downloadUrl: string | null }[] }>(`/assets?${qs}`);
  const failed: string[] = [];
  for (const [id, ref] of missing) {
    const a = found.items.find((x) => x.sha256 === ref.sha256);
    if (!a?.downloadUrl) {
      failed.push(id);
      continue;
    }
    const res = await fetch(a.downloadUrl).catch(() => null);
    if (!res?.ok) {
      failed.push(id);
      continue;
    }
    const bytes = await res.arrayBuffer();
    await storeCloudAsset(id, new Blob([bytes], { type: ref.mime }));
    known.add(ref.sha256);
  }
  return failed;
}
