import { useEffect } from 'react';
import {
  addImageFiles,
  copySelection,
  deleteLayer,
  duplicateLayer,
  fit,
  moveInStack,
  nudge,
  pasteLayer,
  rotateBy,
} from './actions';
import { pickImages } from './filePicker';
import { useDoc } from '../store/doc';
import { useWorkspace } from '../store/workspace';

function typing(target: EventTarget | null): boolean {
  // Events can target window/document (not Elements); those are never text fields.
  if (!(target instanceof Element)) return false;
  const el = target;
  return (
    !!el.closest('input, textarea, select, [contenteditable="true"]') || el.getAttribute('role') === 'slider'
  );
}

/**
 * Editor shortcuts (INTERACTION_SPECIFICATION.md, ACCESSIBILITY_AND_COMPATIBILITY.md §2).
 * Ignored while typing in a field.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const d = useDoc.getState();
      const ws = useWorkspace.getState();

      // History works everywhere except inside text fields (they have their own undo).
      if (mod && key === 'z' && !typing(e.target)) {
        e.preventDefault();
        if (e.shiftKey) d.redo();
        else d.undo();
        return;
      }
      if (mod && key === 'y' && !typing(e.target)) {
        e.preventDefault();
        d.redo();
        return;
      }
      if (typing(e.target)) return;

      const id = d.selectedId;
      if (mod && key === 'c' && copySelection()) return e.preventDefault();
      if (mod && key === 'd' && id) {
        e.preventDefault();
        duplicateLayer(id);
        return;
      }
      if (mod && (key === '0' || key === '1')) {
        e.preventDefault();
        fit();
        return;
      }
      if (mod) return;

      if ((key === 'delete' || key === 'backspace') && id) {
        e.preventDefault();
        deleteLayer(id);
        return;
      }
      if (key.startsWith('arrow') && id) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        nudge(id, dx, dy);
        return;
      }
      if (key === 'escape') {
        if (ws.cropMode) ws.setCropMode(false);
        else if (ws.tool !== 'select') ws.setTool('select');
        else d.select(null);
        return;
      }
      if (key === 'tab') {
        // Cycle through the layers on the visible side.
        const onSide = d.doc.layers.filter((l) => l.side === ws.side && l.visible);
        if (!onSide.length) return;
        e.preventDefault();
        const i = onSide.findIndex((l) => l.id === id);
        const next = onSide[(i + (e.shiftKey ? -1 : 1) + onSide.length) % onSide.length]!;
        d.select(next.id);
        return;
      }
      if (id && (key === '[' || key === ']')) {
        const i = d.doc.layers.findIndex((l) => l.id === id);
        moveInStack(id, key === ']' ? i - 1 : i + 1);
        return;
      }
      if (id && key === 'r' && e.shiftKey) {
        rotateBy(id, 15);
        return;
      }
      const tools: Record<string, () => void> = {
        v: () => ws.setTool('select'),
        h: () => ws.setTool('hand'),
        t: () => ws.setTool('text'),
        i: () => pickImages(),
        r: () => ws.setShapeKind('rect'),
        o: () => ws.setShapeKind('circle'),
        l: () => ws.setShapeKind('line'),
      };
      tools[key]?.();
    };

    // Paste: an image on the system clipboard wins; otherwise paste a copied layer.
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addImageFiles(files);
        return;
      }
      if (pasteLayer()) e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}
