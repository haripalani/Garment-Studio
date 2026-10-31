import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Studio } from '@gs/engine-3d';
import { BRAND } from '@gs/core';
import { useAssets } from '../store/assets';
import { useDoc } from '../store/doc';
import { useWorkspace } from '../store/workspace';
import { SHOWN_PIECES, bakeSignature, bakeTargets, bakeTexture } from './baker';
import { setStudio } from './studioRef';
import { toast } from '../store/toast';

const BAKE_INTERVAL_MS = 120;
/** During drags and slider moves the bake runs less often; the final state always bakes. */
const GESTURE_BAKE_INTERVAL_MS = 250;

/** Hosts the three.js studio and keeps it in sync with the document and the workspace. */
export function ViewerCanvas() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let studio: Studio;
    try {
      studio = new Studio(canvas, { labelText: BRAND.name.toUpperCase() });
    } catch {
      setFailed(true);
      return;
    }
    setStudio(studio);
    const ws = useWorkspace.getState();
    studio.setQuality(ws.quality);
    const first = useDoc.getState();
    studio.setGarment(first.garment, first.doc.look);

    // Textures: rebake only pieces whose inputs changed, at most every BAKE_INTERVAL_MS.
    const signatures = new Map<string, string>();
    let timer: number | undefined;
    let lastBake = 0;
    let bakeFailed = false;
    const bake = () => {
      timer = undefined;
      lastBake = performance.now();
      const { doc, garment } = useDoc.getState();
      const assetsVersion = useAssets.getState().version;
      for (const target of bakeTargets(garment, SHOWN_PIECES)) {
        const key = `${target.pieceId}|${target.side}`;
        const sig = bakeSignature(garment, doc.layers, doc.look.fabric, assetsVersion, target);
        if (signatures.get(key) === sig) continue;
        signatures.set(key, sig);
        try {
          studio.setPieceTexture(target.pieceId, target.side, bakeTexture(garment, doc.layers, doc.look.fabric, target));
        } catch (err) {
          // A failed bake must never take the editor down; the piece keeps its previous texture.
          console.error('3D texture bake failed', target, err);
          if (!bakeFailed) {
            bakeFailed = true;
            toast(t('viewer.bakeFailed'), 'error');
          }
        }
      }
    };
    const scheduleBake = () => {
      if (timer !== undefined) return;
      const interval = useDoc.getState().txn ? GESTURE_BAKE_INTERVAL_MS : BAKE_INTERVAL_MS;
      const wait = Math.max(0, interval - (performance.now() - lastBake));
      timer = window.setTimeout(bake, wait);
    };
    bake();

    let lastLook = first.doc.look;
    const unsubDoc = useDoc.subscribe((s) => {
      if (s.doc.look !== lastLook) {
        lastLook = s.doc.look;
        studio.setLook(s.doc.look);
      }
      scheduleBake();
    });
    const unsubAssets = useAssets.subscribe(scheduleBake);
    const onFonts = () => {
      signatures.clear();
      scheduleBake();
    };
    document.fonts?.addEventListener('loadingdone', onFonts);

    let prev = useWorkspace.getState();
    const unsubWs = useWorkspace.subscribe((s) => {
      if (s.quality !== prev.quality) studio.setQuality(s.quality);
      if (s.camera !== prev.camera || s.cameraToken !== prev.cameraToken) studio.setCamera(s.camera);
      if (s.resetViewToken !== prev.resetViewToken) studio.resetView();
      prev = s;
    });

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      studio.resize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(wrap);

    return () => {
      window.clearTimeout(timer);
      unsubDoc();
      unsubAssets();
      unsubWs();
      document.fonts?.removeEventListener('loadingdone', onFonts);
      ro.disconnect();
      setStudio(null);
      studio.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('viewer.canvasLabel')}
        className="block h-full w-full touch-none outline-none"
        data-testid="viewer-canvas"
      />
      {failed && (
        <p role="alert" className="absolute inset-x-6 top-1/2 m-0 -translate-y-1/2 rounded-lg bg-panel p-3 text-center text-[13px] text-ink">
          {t('viewer.noWebgl')}
        </p>
      )}
    </div>
  );
}
