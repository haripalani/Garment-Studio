// Dev-server-only hooks for end-to-end tests (never included in production builds).
import { createBakeCanvas, frameFor, toScreen } from '@gs/engine-2d';
import type { Vec } from '@gs/core';
import { useDoc } from './store/doc';
import { useWorkspace } from './store/workspace';
import { getStudio } from './viewer/studioRef';
import { canvasBlob, pathTrace, type Studio } from '@gs/engine-3d';

export interface DevHooks {
  /** Page (client) coordinates of a point given in a piece's own frame (mm). */
  piecePointToPage: (pieceId: string, p: Vec) => Vec | null;
  layers: () => { id: string; pieceId: string; side: string; x: number; y: number; w: number; h: number; type: string; wrap: boolean }[];
  zoom: () => number;
  /** 3D studio diagnostics (null when the 3D view is hidden). */
  studio: () => ReturnType<Studio['info']> | null;
  /** The live studio itself (debugging in the dev server only). */
  studioInstance: () => Studio | null;
  /**
   * Renders a 3D snapshot and returns simple pixel statistics: mean RGB of the centre region and of
   * the whole frame, plus the share of pixels that differ from the corner colour (non-blank check).
   */
  snapshotStats: () => Promise<Stats | null>;
  /** Path-traces the current scene (default: front, opaque) and returns the same statistics. */
  pathTraceStats: (o: { width: number; height: number; samples: number; transparent?: boolean }) => Promise<(Stats & { ms: number; samples: number; firstSampleMs: number }) | null>;
}

type Stats = { width: number; height: number; centre: number[]; mean: number[]; varied: number; alpha: number };

/** Mean RGB of the centre region and the whole frame, mean alpha, and the share of pixels unlike the corner. */
async function imageStats(blob: Blob): Promise<Stats> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const c = createBakeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const px = (x: number, y: number) => {
    const i = (y * bmp.width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  };
  const corner = px(2, 2);
  const mean = [0, 0, 0];
  const centre = [0, 0, 0];
  let alpha = 0;
  let varied = 0;
  let nc = 0;
  for (let y = 0; y < bmp.height; y += 2) {
    for (let x = 0; x < bmp.width; x += 2) {
      const p = px(x, y);
      for (let k = 0; k < 3; k++) mean[k]! += p[k]!;
      alpha += p[3]!;
      if (Math.abs(p[0]! - corner[0]!) + Math.abs(p[1]! - corner[1]!) + Math.abs(p[2]! - corner[2]!) > 30) varied++;
      if (Math.abs(x - bmp.width / 2) < bmp.width * 0.08 && Math.abs(y - bmp.height * 0.45) < bmp.height * 0.08) {
        for (let k = 0; k < 3; k++) centre[k]! += p[k]!;
        nc++;
      }
    }
  }
  const n = Math.ceil(bmp.width / 2) * Math.ceil(bmp.height / 2);
  return {
    width: bmp.width,
    height: bmp.height,
    mean: mean.map((v) => v / n),
    centre: centre.map((v) => v / Math.max(1, nc)),
    varied: varied / n,
    alpha: alpha / n / 255,
  };
}

export function installDevHooks(): void {
  const hooks: DevHooks = {
    piecePointToPage(pieceId, p) {
      const ws = useWorkspace.getState();
      const frame = frameFor(useDoc.getState().garment, ws.side, pieceId);
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="pattern-canvas"]');
      if (!frame || !canvas) return null;
      const r = canvas.getBoundingClientRect();
      const [sx, sy] = toScreen(ws.view, [frame.toSheet[4] + p[0], frame.toSheet[5] + p[1]]);
      return [r.left + sx, r.top + sy];
    },
    layers: () =>
      useDoc.getState().doc.layers.map((l) => ({
        id: l.id,
        pieceId: l.pieceId,
        side: l.side,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        type: l.type,
        wrap: l.wrap.on,
      })),
    zoom: () => useWorkspace.getState().view.zoom,
    studio: () => getStudio()?.info() ?? null,
    studioInstance: () => getStudio(),
    async snapshotStats() {
      const s = getStudio();
      return s ? imageStats(await s.snapshot(600)) : null;
    },
    async pathTraceStats(o) {
      const s = getStudio();
      if (!s) return null;
      const r = await pathTrace(s, { frame: 'front', transparent: false, ...o });
      return { ...(await imageStats(await canvasBlob(r.canvas, 'image/png'))), ms: r.ms, samples: r.samples, firstSampleMs: r.firstSampleMs };
    },
  };
  (window as unknown as { __gs: DevHooks }).__gs = hooks;
}
