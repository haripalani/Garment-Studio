import { create } from 'zustand';
import type { ShapeKind, Side } from '@gs/core';
import { zoomTo, type View } from '@gs/engine-2d';

export type { ShapeKind, Side };
export type Tool = 'select' | 'hand' | 'image' | 'text' | 'shape';
export type Quality = 'adaptive' | 'full' | 'half' | 'quarter';
export type CameraPreset = 'front' | 'back' | 'side';
export type InspectorTab = 'design' | 'scene';
export type Dialog = 'auth' | 'render' | 'new' | 'print' | 'panels' | 'spec' | 'video' | 'projects' | 'claim' | null;

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

/** Next zoom stop in the given direction (the zoom bar's − / + buttons). */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? ZOOM_MIN;
}

export interface CursorReadout {
  piece: string;
  x: number;
  y: number;
}

interface Workspace {
  tool: Tool;
  shapeKind: ShapeKind;
  side: Side;
  view: View;
  viewport: { width: number; height: number };
  /** Bumped to ask the pattern canvas to fit the sheet. */
  fitToken: number;
  cursor: CursorReadout | null;
  cropMode: boolean;
  /** Bumped to focus the text field of the selected text layer (double-click on canvas). */
  focusTextToken: number;
  quality: Quality;
  camera: CameraPreset;
  /** Bumped on every preset click (re-applies the same preset after orbiting). */
  cameraToken: number;
  resetViewToken: number;
  tab: InspectorTab;
  garmentPanelOpen: boolean;
  dialog: Dialog;
  tourStep: number | null;
  setTool: (t: Tool) => void;
  setShapeKind: (k: ShapeKind) => void;
  setSide: (s: Side) => void;
  setView: (v: View) => void;
  setViewport: (width: number, height: number) => void;
  zoomBy: (dir: 1 | -1) => void;
  requestFit: () => void;
  setCursor: (c: CursorReadout | null) => void;
  setCropMode: (on: boolean) => void;
  focusText: () => void;
  setQuality: (q: Quality) => void;
  setCamera: (c: CameraPreset) => void;
  resetView: () => void;
  setTab: (t: InspectorTab) => void;
  setGarmentPanelOpen: (o: boolean) => void;
  openDialog: (d: Dialog) => void;
  setTourStep: (s: number | null) => void;
}

// Session-only UI state; the design itself lives in the document store.
export const useWorkspace = create<Workspace>()((set) => ({
  tool: 'select',
  shapeKind: 'rect',
  side: 'outside',
  view: { zoom: 1, panX: 0, panY: 0 },
  viewport: { width: 0, height: 0 },
  fitToken: 0,
  cursor: null,
  cropMode: false,
  focusTextToken: 0,
  quality: 'adaptive',
  camera: 'front',
  cameraToken: 0,
  resetViewToken: 0,
  tab: 'design',
  garmentPanelOpen: false,
  dialog: null,
  tourStep: null,
  setTool: (tool) => set({ tool, cropMode: false }),
  setShapeKind: (shapeKind) => set({ shapeKind, tool: 'shape', cropMode: false }),
  setSide: (side) => set((s) => ({ side, cropMode: false, fitToken: s.fitToken + 1 })),
  setView: (view) => set({ view }),
  setViewport: (width, height) => set({ viewport: { width, height } }),
  zoomBy: (dir) =>
    set((s) => ({
      view: zoomTo(s.view, stepZoom(s.view.zoom, dir), s.viewport.width, s.viewport.height),
    })),
  requestFit: () => set((s) => ({ fitToken: s.fitToken + 1 })),
  setCursor: (cursor) => set({ cursor }),
  setCropMode: (cropMode) => set({ cropMode }),
  focusText: () => set((s) => ({ focusTextToken: s.focusTextToken + 1 })),
  setQuality: (quality) => set({ quality }),
  setCamera: (camera) => set((s) => ({ camera, cameraToken: s.cameraToken + 1 })),
  resetView: () => set((s) => ({ camera: 'front', resetViewToken: s.resetViewToken + 1 })),
  setTab: (tab) => set({ tab }),
  setGarmentPanelOpen: (garmentPanelOpen) => set({ garmentPanelOpen }),
  openDialog: (dialog) => set({ dialog }),
  setTourStep: (tourStep) => set({ tourStep }),
}));
