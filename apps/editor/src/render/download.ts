import { useDoc } from '../store/doc';

/** Save a file through the browser (the desktop app swaps in a native dialog in Stage 10). */
export function download(blob: Blob, filename: string): void {
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
  return (
    name
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'design'
  );
}

/** "<design-name>-<suffix>.<ext>" for the current document. */
export function outputName(suffix: string, ext: string): string {
  return `${safeFileName(useDoc.getState().doc.name)}-${suffix}.${ext}`;
}

/** "45 s", "2 min", "3 min 20 s". */
export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
