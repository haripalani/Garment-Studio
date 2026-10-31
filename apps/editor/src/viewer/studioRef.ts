import type { Studio } from '@gs/engine-3d';
import { toast } from '../store/toast';
import { download, outputName } from '../render/download';
import { ExportBlocked, needsWatermark, recordExport, watermarkPng } from '../cloud/exports';

// The single live 3D studio (owned by ViewerCanvas), for header actions like the snapshot.
let current: Studio | null = null;

export function setStudio(s: Studio | null): void {
  current = s;
}

export function getStudio(): Studio | null {
  return current;
}

/** PNG of the current 3D view, 2400 px on the long side. */
export async function takeSnapshot(): Promise<void> {
  const s = current;
  if (!s) {
    toast('Open the 3D view to take a snapshot.');
    return;
  }
  try {
    await recordExport('snapshot');
    let blob = await s.snapshot(2400, 'image/png');
    if (needsWatermark()) blob = await watermarkPng(blob);
    download(blob, outputName('3d', 'png'));
  } catch (e) {
    toast(e instanceof ExportBlocked ? e.message : 'The snapshot could not be created.', 'error');
  }
}
