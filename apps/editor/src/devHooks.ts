// Dev-server-only hooks for end-to-end tests (never included in production builds).
import { createBakeCanvas, frameFor, toScreen } from '@gs/engine-2d';
import type { Vec } from '@gs/core';
import { useDoc } from './store/doc';
import { useWorkspace } from './store/workspace';
import { getStudio } from './viewer/studioRef';
import type { Studio } from '@gs/engine-3d';

export interface DevHooks {
  /** Page (client) coordinates of a point given in a piece's own frame (mm). */
  piecePointToPage: (pieceId: string, p: Vec) => Vec | null;
  layers: () => { id: string; pieceId: string; side: string; x: number; y: number; w: number; h: number; type: string; wrap: boolean }[];
  zoom: () => number;
  /** 3D studio diagnostics (null when the 3D view is hidden). */
  studio: () => ReturnType<Studio['info']> | null;
  /**
   * Renders a 3D snapshot and returns simple pixel statistics: mean RGB of the centre region and of
   * the whole frame, plus the share of pixels that differ from the corner colour (non-blank check).
   */
  snapshotStats: () => Promise<{ width: number; height: number; centre: number[]; mean: number[]; varied: number } | null>;
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
    async snapshotStats() {
      const s = getStudio();
      if (!s) return null;
      const blob = await s.snapshot(600);
      const bmp = await createImageBitmap(blob);
      const c = createBakeCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const px = (x: number, y: number) => {
        const i = (y * bmp.width + x) * 4;
        return [data[i]!, data[i + 1]!, data[i + 2]!];
      };
      const corner = px(2, 2);
      const mean = [0, 0, 0];
      const centre = [0, 0, 0];
      let varied = 0;
      let nc = 0;
      for (let y = 0; y < bmp.height; y += 2) {
        for (let x = 0; x < bmp.width; x += 2) {
          const p = px(x, y);
          mean[0]! += p[0]!;
          mean[1]! += p[1]!;
          mean[2]! += p[2]!;
          if (Math.abs(p[0]! - corner[0]!) + Math.abs(p[1]! - corner[1]!) + Math.abs(p[2]! - corner[2]!) > 30) varied++;
          if (Math.abs(x - bmp.width / 2) < bmp.width * 0.08 && Math.abs(y - bmp.height * 0.45) < bmp.height * 0.08) {
            centre[0]! += p[0]!;
            centre[1]! += p[1]!;
            centre[2]! += p[2]!;
            nc++;
          }
        }
      }
      const n = (bmp.width / 2) * (bmp.height / 2);
      return {
        width: bmp.width,
        height: bmp.height,
        mean: mean.map((v) => v / n),
        centre: centre.map((v) => v / Math.max(1, nc)),
        varied: varied / n,
      };
    },
  };
  (window as unknown as { __gs: DevHooks }).__gs = hooks;
}
