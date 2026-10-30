import type { Studio } from '@gs/engine-3d';
import { toast } from '../store/toast';
import { useDoc } from '../store/doc';

// The single live 3D studio (owned by ViewerCanvas), for header actions like the snapshot.
let current: Studio | null = null;

export function setStudio(s: Studio | null): void {
  current = s;
}

export function getStudio(): Studio | null {
  return current;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'design';
}

/** PNG of the current 3D view, 2400 px on the long side. */
export async function takeSnapshot(): Promise<void> {
  const s = current;
  if (!s) {
    toast('Open the 3D view to take a snapshot.');
    return;
  }
  try {
    const blob = await s.snapshot(2400, 'image/png');
    download(blob, `${safeFileName(useDoc.getState().doc.name)}-3d.png`);
  } catch {
    toast('The snapshot could not be created.', 'error');
  }
}
