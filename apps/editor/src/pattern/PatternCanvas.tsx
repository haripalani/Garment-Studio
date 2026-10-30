import {
  useEffect,
  useRef,
  type DragEvent,
  type PointerEvent as RPointerEvent,
  type WheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { pointInPolygon, type ImageLayer, type Layer, type Vec } from '@gs/core';
import {
  cropEdges,
  cropPan,
  edgeMids,
  frameFor,
  hitLayer,
  pieceAt,
  renderDraft,
  renderRulers,
  renderSelection,
  renderSheet,
  reparent,
  rotateTo,
  scaleFromCorner,
  selectionGeometry,
  sheetToPiece,
  toSheet,
  zoomAt,
  type Corner,
  type Edge,
  type SheetScene,
  type SheetStyle,
  type View,
} from '@gs/engine-2d';
import { addImageFiles, addShapeFromDrag, addText, fit, targetAtSheetPoint } from '../editor/actions';
import { pickImages } from '../editor/filePicker';
import { assetSource, useAssets } from '../store/assets';
import { selectedLayer, useDoc } from '../store/doc';
import { look as lookStore } from '../store/look';
import { usePrefs } from '../store/prefs';
import { useWorkspace } from '../store/workspace';

type Gesture =
  | { kind: 'pan'; start: Vec; view0: View }
  | { kind: 'move'; start: Vec; layer0: Layer }
  | { kind: 'scale'; corner: Corner; layer0: Layer }
  | { kind: 'rotate'; from: Vec; layer0: Layer }
  | { kind: 'crop'; edges: Edge[]; layer0: ImageLayer }
  | { kind: 'cropPan'; from: Vec; layer0: ImageLayer }
  | { kind: 'draft'; a: Vec; b: Vec };

type Hit =
  | { kind: 'corner'; corner: Corner }
  | { kind: 'rotate' }
  | { kind: 'cropEdge'; edges: Edge[] }
  | { kind: 'body' }
  | null;

const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];
const EDGES: Edge[] = ['n', 'e', 's', 'w'];
const CROP_CORNERS: Record<Corner, Edge[]> = {
  nw: ['n', 'w'],
  ne: ['n', 'e'],
  se: ['s', 'e'],
  sw: ['s', 'w'],
};
const near = (a: Vec, b: Vec, r: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;

function readStyle(): SheetStyle {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    mat: v('--mat-bg'),
    dot: v('--dot'),
    pieceLine: v('--line-strong'),
    label: v('--ink'),
    labelMuted: v('--muted'),
    accent: v('--accent'),
    accentInk: v('--accent-ink'),
    rulerBg: v('--panel'),
    rulerLine: v('--line-strong'),
    rulerText: v('--muted'),
  };
}

export function PatternCanvas() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const cursorSheet = useRef<Vec | undefined>(undefined);
  const space = useRef(false);
  const style = useRef<SheetStyle | null>(null);
  const raf = useRef(0);
  const fitted = useRef(false);

  /* ───────────── drawing ───────────── */

  const scene = (): SheetScene => {
    const d = useDoc.getState();
    const look = lookStore.get();
    return {
      garment: d.garment,
      layers: d.doc.layers,
      side: useWorkspace.getState().side,
      fabric: look.fabric,
      markings: look.scene.patternMarkings,
      unit: usePrefs.getState().unit,
      env: { asset: assetSource },
    };
  };

  const draw = () => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ws = useWorkspace.getState();
    const { width, height } = ws.viewport;
    if (width < 1 || height < 1) return;
    style.current ??= readStyle();
    const target = {
      ctx,
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      view: ws.view,
      style: style.current,
    };
    const s = scene();
    renderSheet(target, s);
    const sel = selectedLayer(useDoc.getState());
    if (sel && sel.visible && sel.side === s.side)
      renderSelection(target, s, sel, { crop: ws.cropMode && sel.type === 'image' });
    const g = gesture.current;
    if (g?.kind === 'draft') renderDraft(target, g.a, g.b);
    renderRulers(target, s.unit, cursorSheet.current);
  };

  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    const subs = [
      useDoc.subscribe(schedule),
      useWorkspace.subscribe(schedule),
      usePrefs.subscribe((s, prev) => {
        if (s.theme !== prev.theme) style.current = null;
        schedule();
      }),
      useAssets.subscribe(schedule),
    ];
    const onFonts = () => schedule();
    document.fonts?.addEventListener('loadingdone', onFonts);
    return () => {
      subs.forEach((u) => u());
      document.fonts?.removeEventListener('loadingdone', onFonts);
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Size the canvas to its box (device pixels) and fit the sheet the first time.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      useWorkspace.getState().setViewport(width, height);
      if (!fitted.current && width > 10) {
        fitted.current = true;
        fit();
      }
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit on request (side change, New design, Fit button).
  const fitToken = useWorkspace((s) => s.fitToken);
  useEffect(() => {
    if (fitted.current) fit();
  }, [fitToken]);

  // Space bar = temporary hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (e.code === 'Space' && !el?.closest('input, textarea, button, [contenteditable]')) {
        space.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* ───────────── hit testing ───────────── */

  const localPoint = (e: { clientX: number; clientY: number }): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const hitSelection = (screen: Vec, sel: Layer | undefined): Hit => {
    const ws = useWorkspace.getState();
    if (!sel || sel.side !== ws.side || !sel.visible) return null;
    const g = selectionGeometry(ws.view, useDoc.getState().garment, sel);
    if (!g) return null;
    const crop = ws.cropMode && sel.type === 'image';
    if (crop) {
      for (let i = 0; i < 4; i++)
        if (near(screen, g.corners[i]!, 8)) return { kind: 'cropEdge', edges: CROP_CORNERS[CORNERS[i]!] };
      const mids = edgeMids(g.corners);
      for (let i = 0; i < 4; i++)
        if (near(screen, mids[i]!, 8)) return { kind: 'cropEdge', edges: [EDGES[i]!] };
      return pointInPolygon(screen, g.corners) ? { kind: 'body' } : null;
    }
    if (near(screen, g.rotateHandle, 10)) return { kind: 'rotate' };
    for (let i = 0; i < 4; i++)
      if (near(screen, g.corners[i]!, 7)) return { kind: 'corner', corner: CORNERS[i]! };
    // Just outside a corner rotates ("or drag outside a corner").
    for (let i = 0; i < 4; i++)
      if (near(screen, g.corners[i]!, 22) && !pointInPolygon(screen, g.corners)) return { kind: 'rotate' };
    return pointInPolygon(screen, g.corners) ? { kind: 'body' } : null;
  };

  const cursorFor = (hit: Hit): string => {
    const tool = useWorkspace.getState().tool;
    if (space.current || tool === 'hand') return gesture.current?.kind === 'pan' ? 'grabbing' : 'grab';
    if (tool === 'shape') return 'crosshair';
    if (tool === 'text') return 'text';
    if (tool === 'image') return 'copy';
    if (!hit) return 'default';
    if (hit.kind === 'rotate') return 'grab';
    if (hit.kind === 'corner')
      return hit.corner === 'nw' || hit.corner === 'se' ? 'nwse-resize' : 'nesw-resize';
    if (hit.kind === 'cropEdge') {
      const e = hit.edges;
      if (e.length === 2)
        return (e.includes('n') && e.includes('w')) || (e.includes('s') && e.includes('e'))
          ? 'nwse-resize'
          : 'nesw-resize';
      return e[0] === 'n' || e[0] === 's' ? 'ns-resize' : 'ew-resize';
    }
    return 'move';
  };

  /* ───────────── pointer ───────────── */

  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    const ws = useWorkspace.getState();
    const d = useDoc.getState();
    const screen = localPoint(e);
    const p = toSheet(ws.view, screen);
    canvasRef.current!.setPointerCapture(e.pointerId);
    canvasRef.current!.focus();

    if (e.button === 1 || space.current || ws.tool === 'hand') {
      gesture.current = { kind: 'pan', start: screen, view0: ws.view };
      return;
    }
    if (e.button !== 0) return;

    if (ws.tool === 'shape') {
      gesture.current = { kind: 'draft', a: p, b: p };
      return;
    }
    if (ws.tool === 'text') {
      void addText(targetAtSheetPoint(p));
      return;
    }
    if (ws.tool === 'image') {
      pickImages(targetAtSheetPoint(p));
      ws.setTool('select');
      return;
    }

    const sel = selectedLayer(d);
    const hit = hitSelection(screen, sel);
    if (sel && hit) {
      if (hit.kind === 'rotate') {
        d.begin('Rotate');
        gesture.current = { kind: 'rotate', from: p, layer0: sel };
      } else if (hit.kind === 'corner') {
        d.begin('Resize');
        gesture.current = { kind: 'scale', corner: hit.corner, layer0: sel };
      } else if (hit.kind === 'cropEdge' && sel.type === 'image') {
        d.begin('Crop');
        gesture.current = { kind: 'crop', edges: hit.edges, layer0: sel };
      } else if (hit.kind === 'body' && ws.cropMode && sel.type === 'image') {
        d.begin('Crop');
        gesture.current = { kind: 'cropPan', from: p, layer0: sel };
      } else {
        d.begin('Move');
        gesture.current = { kind: 'move', start: p, layer0: sel };
      }
      return;
    }
    if (ws.cropMode) ws.setCropMode(false);
    const target = hitLayer(d.garment, d.doc.layers, ws.side, p);
    d.select(target?.id ?? null);
    if (target) {
      d.begin('Move');
      gesture.current = { kind: 'move', start: p, layer0: target };
    }
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    const ws = useWorkspace.getState();
    const d = useDoc.getState();
    const screen = localPoint(e);
    const p = toSheet(ws.view, screen);
    cursorSheet.current = p;
    const g = gesture.current;

    if (!g) {
      const frame = pieceAt(d.garment, ws.side, p);
      if (frame) {
        const [x, y] = sheetToPiece(frame, p);
        ws.setCursor({ piece: frame.piece.name.en ?? frame.piece.id, x, y });
      } else if (ws.cursor) ws.setCursor(null);
      canvasRef.current!.style.cursor = cursorFor(hitSelection(screen, selectedLayer(d)));
      schedule();
      return;
    }

    if (g.kind === 'pan') {
      ws.setView({
        ...g.view0,
        panX: g.view0.panX + screen[0] - g.start[0],
        panY: g.view0.panY + screen[1] - g.start[1],
      });
      return;
    }
    if (g.kind === 'draft') {
      g.b = p;
      schedule();
      return;
    }
    const l0 = g.layer0;
    const frame0 = frameFor(d.garment, l0.side, l0.pieceId);
    if (!frame0) return;
    const set = (patch: Partial<Layer>) =>
      d.edit('Edit', (draft) => {
        const l = draft.layers.find((x) => x.id === l0.id);
        if (l) Object.assign(l, patch);
      });

    if (g.kind === 'move') {
      const moved = { ...l0, x: l0.x + p[0] - g.start[0], y: l0.y + p[1] - g.start[1] };
      const centre = frame0.toSheet;
      const sheetCentre: Vec = [moved.x + centre[4], moved.y + centre[5]];
      const over = pieceAt(d.garment, l0.side, sheetCentre);
      set(
        over && over.piece.id !== l0.pieceId
          ? reparent(moved, frame0, over)
          : { x: moved.x, y: moved.y, pieceId: l0.pieceId },
      );
    } else if (g.kind === 'scale') {
      set(scaleFromCorner(l0, frame0, g.corner, p, e.shiftKey && l0.type !== 'text'));
    } else if (g.kind === 'rotate') {
      set({ rotationDeg: rotateTo(l0, frame0, g.from, p, e.shiftKey) });
    } else if (g.kind === 'crop') {
      set(cropEdges(g.layer0, frame0, g.edges, p));
    } else if (g.kind === 'cropPan') {
      set({ crop: cropPan(g.layer0, frame0, g.from, p) });
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    // Apply the release position too, so a press-and-release without intermediate moves still lands.
    if (gesture.current && e.type === 'pointerup') onPointerMove(e);
    const g = gesture.current;
    gesture.current = null;
    if (canvasRef.current?.hasPointerCapture(e.pointerId))
      canvasRef.current.releasePointerCapture(e.pointerId);
    if (!g) return;
    if (g.kind === 'draft') {
      const ws = useWorkspace.getState();
      addShapeFromDrag(ws.shapeKind, g.a, g.b, e.shiftKey);
      schedule();
      return;
    }
    if (g.kind !== 'pan') useDoc.getState().commit();
  }

  function onPointerLeave() {
    if (!gesture.current) {
      cursorSheet.current = undefined;
      useWorkspace.getState().setCursor(null);
      schedule();
    }
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const ws = useWorkspace.getState();
    const d = useDoc.getState();
    const p = toSheet(ws.view, localPoint(e));
    const l = hitLayer(d.garment, d.doc.layers, ws.side, p);
    if (!l) return;
    d.select(l.id);
    if (l.type === 'text') ws.focusText();
    if (l.type === 'image') ws.setCropMode(!ws.cropMode);
  }

  function onWheel(e: WheelEvent<HTMLCanvasElement>) {
    const ws = useWorkspace.getState();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    ws.setView(zoomAt(ws.view, factor, localPoint(e)));
  }

  /* ───────────── drag & drop ───────────── */

  function onDragOver(e: DragEvent) {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function onDrop(e: DragEvent) {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const p = toSheet(useWorkspace.getState().view, localPoint(e));
    void addImageFiles(files, targetAtSheetPoint(p));
  }

  return (
    <div ref={wrapRef} className="absolute inset-0" onDragOver={onDragOver} onDrop={onDrop}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('pattern.canvasLabel')}
        data-testid="pattern-canvas"
        tabIndex={0}
        className="block h-full w-full touch-none outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
