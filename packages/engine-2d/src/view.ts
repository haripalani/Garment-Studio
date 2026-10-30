import { type Box, type Mat, type Vec } from '@gs/core';

/** Screen pixels per millimetre at 100 % zoom (matches the reference: 3.75 px per cm). */
export const BASE_PX_PER_MM = 0.375;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/** Sheet (mm) → screen (CSS px): screen = sheet × BASE × zoom + pan. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export function pxPerMm(v: View): number {
  return BASE_PX_PER_MM * v.zoom;
}

export function viewMatrix(v: View): Mat {
  const k = pxPerMm(v);
  return [k, 0, 0, k, v.panX, v.panY];
}

export function toScreen(v: View, p: Vec): Vec {
  const k = pxPerMm(v);
  return [p[0] * k + v.panX, p[1] * k + v.panY];
}

export function toSheet(v: View, p: Vec): Vec {
  const k = pxPerMm(v);
  return [(p[0] - v.panX) / k, (p[1] - v.panY) / k];
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoom by `factor` keeping the screen point `at` fixed. */
export function zoomAt(v: View, factor: number, at: Vec): View {
  const zoom = clampZoom(v.zoom * factor);
  const sheet = toSheet(v, at);
  const k = BASE_PX_PER_MM * zoom;
  return { zoom, panX: at[0] - sheet[0] * k, panY: at[1] - sheet[1] * k };
}

/** Set an absolute zoom around the viewport centre. */
export function zoomTo(v: View, zoom: number, width: number, height: number): View {
  return zoomAt(v, clampZoom(zoom) / v.zoom, [width / 2, height / 2]);
}

/**
 * View that fits `box` (sheet mm) into the viewport with `margin` px on every side.
 * `insets` reserve room for floating UI (left tool rail, bottom zoom bar).
 */
export function fitView(
  box: Box,
  width: number,
  height: number,
  margin = 40,
  insets: { left?: number; top?: number; right?: number; bottom?: number } = {},
): View {
  const l = (insets.left ?? 0) + margin;
  const t = (insets.top ?? 0) + margin;
  const r = (insets.right ?? 0) + margin;
  const b = (insets.bottom ?? 0) + margin;
  const aw = Math.max(1, width - l - r);
  const ah = Math.max(1, height - t - b);
  const k = Math.min(aw / Math.max(box.w, 1), ah / Math.max(box.h, 1));
  const zoom = clampZoom(k / BASE_PX_PER_MM);
  const kk = BASE_PX_PER_MM * zoom;
  return {
    zoom,
    panX: l + (aw - box.w * kk) / 2 - box.x * kk,
    panY: t + (ah - box.h * kk) / 2 - box.y * kk,
  };
}
