import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { AssetRef } from '@gs/core';
import type { AssetSource } from '@gs/engine-2d';

// Image assets: content-addressed (SHA-256), original bytes kept in IndexedDB for print export,
// decoded images held in memory for drawing. Cloud upload arrives with sync (Stage 8, ADR-0014).

export const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const;
export const MAX_BYTES = 50 * 1024 * 1024;
/** Longest side kept in memory for on-screen drawing. Originals stay untouched in storage. */
const DISPLAY_MAX = 4096;

const sources = new Map<string, AssetSource>();

/** Bumps whenever an asset finishes decoding, so canvases redraw. */
export const useAssets = create<{ version: number; bump: () => void }>()((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

export function assetSource(id: string): AssetSource | undefined {
  return sources.get(id);
}

export class AssetError extends Error {
  constructor(
    public code: 'type' | 'size' | 'decode',
    message: string,
  ) {
    super(message);
  }
}

async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function decode(blob: Blob): Promise<AssetSource> {
  if (blob.type === 'image/svg+xml') {
    // createImageBitmap does not take SVG everywhere; an <img> works and stays vector-sharp.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 1000;
      const h = img.naturalHeight || 1000;
      return { image: img, width: w, height: h };
    } catch {
      URL.revokeObjectURL(url);
      throw new AssetError('decode', 'This SVG could not be read.');
    }
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new AssetError('decode', 'This image could not be read.');
  }
  const k = Math.min(1, DISPLAY_MAX / Math.max(bmp.width, bmp.height));
  if (k < 1) {
    const scaled = await createImageBitmap(blob, {
      resizeWidth: Math.round(bmp.width * k),
      resizeHeight: Math.round(bmp.height * k),
      resizeQuality: 'high',
    });
    const full = { width: bmp.width, height: bmp.height };
    bmp.close();
    return { image: scaled, ...full };
  }
  return { image: bmp, width: bmp.width, height: bmp.height };
}

/** Validates, hashes, stores and decodes an image. Returns the asset id and its reference. */
export async function importImage(file: Blob, name: string): Promise<{ id: string; ref: AssetRef; stored: boolean }> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new AssetError('type', 'Use a PNG, JPEG, WebP, AVIF or SVG image.');
  }
  if (file.size > MAX_BYTES) throw new AssetError('size', 'Images can be up to 50 MB.');
  const hash = await sha256(file);
  const id = assetIdFor(hash);
  if (!sources.has(id)) {
    const src = await decode(file);
    sources.set(id, src);
    useAssets.getState().bump();
  }
  // If storing fails the image still works in this session; the caller warns that it will not survive a reload.
  const stored = await storeBytes(id, file).then(
    () => true,
    () => false,
  );
  const src = sources.get(id)!;
  return {
    id,
    stored,
    ref: {
      sha256: hash,
      mime: file.type,
      bytes: file.size,
      width: src.width,
      height: src.height,
      name: name.slice(0, 255),
    },
  };
}

/** Loads every asset of a document from IndexedDB (missing ones are skipped and reported). */
export async function restoreAssets(ids: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      if (sources.has(id)) return;
      const blob = await assetBlob(id).catch(() => undefined);
      if (!blob) return missing.push(id);
      try {
        sources.set(id, await decode(blob));
      } catch {
        missing.push(id);
      }
    }),
  );
  useAssets.getState().bump();
  return missing;
}

/**
 * Originals are stored as raw bytes + type rather than a Blob: Blob values in IndexedDB are not
 * supported by every engine (WebKit failed in the Stage 5 cross-browser run).
 */
interface StoredAsset {
  type: string;
  bytes: ArrayBuffer;
}

async function storeBytes(id: string, file: Blob): Promise<void> {
  const record: StoredAsset = { type: file.type, bytes: await file.arrayBuffer() };
  await idbSet(`asset:${id}`, record);
}

/** Original bytes (for print export). Reads both the current record and legacy Blob entries. */
export async function assetBlob(id: string): Promise<Blob | undefined> {
  const v = await idbGet<StoredAsset | Blob>(`asset:${id}`);
  if (!v) return undefined;
  if (v instanceof Blob) return v;
  return new Blob([v.bytes], { type: v.type });
}

/** The local id of an image: derived from its content, so it is the same on every device. */
export const assetIdFor = (sha256: string) => `a${sha256.slice(0, 24)}`;

/** Keep bytes fetched from the cloud (sync) on this device and decode them for drawing. */
export async function storeCloudAsset(id: string, blob: Blob): Promise<void> {
  await storeBytes(id, blob);
  sources.set(id, await decode(blob));
  useAssets.getState().bump();
}

/** Decode bytes received from elsewhere (the cloud render page) under an existing asset id. */
export async function registerAsset(id: string, blob: Blob): Promise<void> {
  sources.set(id, await decode(blob));
  useAssets.getState().bump();
}
