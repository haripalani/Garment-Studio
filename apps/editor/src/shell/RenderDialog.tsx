import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Cpu, Download, X } from 'lucide-react';
import { Button, FieldRow, Modal, Segmented, Select, Tip } from '@gs/ui';
import type { RenderFrame, RenderQuality } from '@gs/engine-3d';
import { useDoc } from '../store/doc';
import { toast } from '../store/toast';
import { useWorkspace } from '../store/workspace';
import { download, formatDuration, outputName } from '../render/download';
import { PREVIEW_PX_PER_MM } from '../viewer/baker';
import { getStudio } from '../viewer/studioRef';
import { ApiError, api } from '../cloud/api';
import { ExportBlocked, needsWatermark, recordExport, watermark } from '../cloud/exports';
import { useRenderEvents } from '../cloud/live';
import { canSync, useSession } from '../cloud/session';
import { push, useSync } from '../cloud/sync';
import { library } from '../store/persist';

// Sizes per aspect ratio (independent list; plan gating comes from entitlements, ADR-0012).
const SIZES = [
  '1200x1500',
  '1600x2000',
  '2000x2500',
  '3000x3750',
  '2000x2000',
  '3000x3000',
  '1500x2000',
  '2250x3000',
  '2000x1500',
  '3000x2250',
  '1080x1920',
  '2160x3840',
  '1920x1080',
  '3840x2160',
] as const;
type Size = (typeof SIZES)[number];

/** Preview box (CSS px) and the frame preview's sample count. */
const PREVIEW_BOX = { w: 600, h: 440 };
const PREVIEW_SAMPLES = 48;

function ratio(size: Size): string {
  const [w, h] = size.split('x').map(Number) as [number, number];
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'preview' }
  | { kind: 'rendering'; done: number; total: number; started: number; firstAt: number | null }
  | { kind: 'done'; ms: number }
  | { kind: 'cloud'; jobId: string | null; progress: number; samples: number; status: string }
  | { kind: 'cloudDone'; outputs: { format: 'png' | 'webp'; url: string | null }[] }
  | { kind: 'error'; message: string };

interface RenderJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  samplesDone: number;
  error: { message: string } | null;
  outputs: { format: 'png' | 'webp'; url: string | null }[];
}

export function RenderDialog() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.dialog === 'render');
  const openDialog = useWorkspace((s) => s.openDialog);
  const [size, setSize] = useState<Size>('2000x2500');
  const [frame, setFrame] = useState<RenderFrame>('preview');
  const [quality, setQuality] = useState<RenderQuality>('good');
  const [transparent, setTransparent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** A full render owns the canvas: previews (scheduled after setting changes) must not replace it. */
  const fullActive = useRef(false);
  const previewTimer = useRef<number | undefined>(undefined);
  const cloudJob = useRef<string | null>(null);
  const cloudOk = useSession((s) => canSync(s));
  const [w, h] = size.split('x').map(Number) as [number, number];
  const fit = Math.min(PREVIEW_BOX.w / w, PREVIEW_BOX.h / h);

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
  };

  /** Progressive path trace into the dialog's canvas: a small preview, or the full-size render. */
  const run = async (full: boolean) => {
    const canvas = canvasEl;
    if (!canvas || (!full && fullActive.current)) return;
    if (full) {
      window.clearTimeout(previewTimer.current);
      fullActive.current = true;
    }
    stop();
    const ctl = new AbortController();
    abort.current = ctl;
    // The path tracer and three.js load only when a render is made (they're not needed to edit).
    const [{ pathTrace, renderPlan }, { withStudio }] = await Promise.all([import('@gs/engine-3d'), import('../render/scene')]);
    if (ctl.signal.aborted) {
      if (full) fullActive.current = false;
      return;
    }
    const plan = renderPlan(w, h, quality);
    const width = full ? w : Math.max(64, Math.round(w * fit));
    const height = full ? h : Math.max(64, Math.round(h * fit));
    const started = performance.now();
    setPhase(full ? { kind: 'rendering', done: 0, total: plan.samples, started, firstAt: null } : { kind: 'preview' });
    const { doc, garment } = useDoc.getState();
    try {
      const r = await withStudio(garment, doc, full ? plan.bakePxPerMm : PREVIEW_PX_PER_MM, (studio) =>
        pathTrace(studio, {
          canvas,
          width,
          height,
          frame,
          transparent,
          samples: full ? plan.samples : PREVIEW_SAMPLES,
          bounces: full ? plan.bounces : 3,
          tiles: full ? plan.tiles : 1,
          textureSize: full ? plan.textureSize : 1024,
          signal: ctl.signal,
          onProgress: (done, total) => {
            if (!full) return;
            setPhase((p) =>
              p.kind === 'rendering'
                ? { ...p, done, total, firstAt: p.firstAt ?? (done > 0 ? performance.now() : null) }
                : p,
            );
          },
        }),
      );
      if (abort.current === ctl) abort.current = null;
      if (full) fullActive.current = false;
      setPhase(full ? { kind: 'done', ms: r.ms } : { kind: 'idle' });
    } catch (e) {
      if (abort.current === ctl) abort.current = null;
      if (full) fullActive.current = false;
      if ((e as Error).name === 'AbortError') {
        if (full) {
          toast(t('render.cancelled'));
          setPhase({ kind: 'idle' });
        }
        return;
      }
      console.error('render failed', e);
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  };

  // Frame preview whenever the dialog opens or a setting that changes the picture changes.
  useEffect(() => {
    if (!open || !canvasEl) return;
    previewTimer.current = window.setTimeout(() => void run(false), 150);
    return () => {
      window.clearTimeout(previewTimer.current);
      if (!fullActive.current) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvasEl, size, frame, transparent]);

  useEffect(() => {
    if (!open) stop();
  }, [open]);

  const save = async (type: 'image/png' | 'image/webp') => {
    const name = (ext: string) => outputName(`${frame}-${w}x${h}`, ext);
    try {
      if (phase.kind === 'cloudDone') {
        // Cloud outputs are already watermarked by the server when the plan requires it.
        const out = phase.outputs.find((o) => o.format === (type === 'image/png' ? 'png' : 'webp'));
        if (!out?.url) return;
        download(await (await fetch(out.url)).blob(), name(out.format));
        return;
      }
      if (!canvasEl) return;
      await recordExport('snapshot');
      const { canvasBlob } = await import('@gs/engine-3d');
      const src = needsWatermark() ? watermark(canvasEl) : canvasEl;
      const blob = await canvasBlob(src, type, 0.95);
      if (type === 'image/webp' && blob.type !== 'image/webp') toast(t('render.webpUnsupported'));
      download(blob, name(blob.type === 'image/webp' ? 'webp' : 'png'));
    } catch (e) {
      toast(e instanceof ExportBlocked ? e.message : t('render.failed', { message: (e as Error).message }), 'error');
    }
  };

  /** Cloud render (ADR-0013): sync the design, queue the job, follow live progress, show the result. */
  const runCloud = async () => {
    stop();
    window.clearTimeout(previewTimer.current);
    setPhase({ kind: 'cloud', jobId: null, progress: 0, samples: 0, status: 'syncing' });
    try {
      const id = useDoc.getState().doc.id;
      await push(id);
      const rec = await library.get(id);
      if (!rec?.cloud || rec.dirty) throw new Error(useSync.getState().message ?? t('render.cloudNotSaved'));
      const orbit = frame === 'preview' ? getStudio()?.orbit() : undefined;
      const job = await api<RenderJob>('/renders', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: {
          projectId: id,
          revision: rec.cloud.revision,
          width: w,
          height: h,
          quality,
          frame: frame === 'preview' && !orbit ? 'front' : frame,
          ...(orbit ? { camera: orbit } : {}),
          transparent,
          formats: ['png', 'webp'],
        },
      });
      cloudJob.current = job.id;
      // Live events update the store; polling is the fallback when the socket is down.
      for (;;) {
        const live = useRenderEvents.getState().jobs[job.id];
        const now = await api<RenderJob>(`/renders/${job.id}`);
        if (cloudJob.current !== job.id) return;
        const progress = Math.max(now.progress, live?.progress ?? 0);
        const samples = Math.max(now.samplesDone, live?.samplesDone ?? 0);
        setPhase({ kind: 'cloud', jobId: job.id, progress, samples, status: now.status });
        if (now.status === 'succeeded') return setPhase({ kind: 'cloudDone', outputs: now.outputs });
        if (now.status === 'failed') throw new Error(now.error?.message ?? 'failed');
        if (now.status === 'cancelled') return setPhase({ kind: 'idle' });
        await new Promise((r) => setTimeout(r, live ? 1000 : 2500));
      }
    } catch (e) {
      cloudJob.current = null;
      setPhase({ kind: 'error', message: e instanceof ApiError ? e.message : (e as Error).message });
    }
  };

  const cancelCloud = async () => {
    const id = cloudJob.current;
    cloudJob.current = null;
    setPhase({ kind: 'idle' });
    if (id) await api(`/renders/${id}/cancel`, { method: 'POST' }).catch(() => undefined);
  };

  const rendering = phase.kind === 'rendering' || phase.kind === 'cloud';
  const eta =
    phase.kind === 'rendering' && phase.firstAt && phase.done > 2
      ? ((performance.now() - phase.firstAt) / phase.done) * (phase.total - phase.done)
      : null;

  return (
    <Modal open={open} onOpenChange={(o) => !o && openDialog(null)} title={t('render.title')} width={940}>
      <div className="grid grid-cols-[1fr_300px] gap-5">
        <div className="flex flex-col items-center gap-3">
          <Segmented<RenderFrame>
            label={t('render.frame')}
            size="sm"
            surface="outlined"
            value={frame}
            onChange={(f) => !rendering && setFrame(f)}
            options={(['preview', 'front', 'back', 'side'] as const).map((f) => ({
              value: f,
              label: f === 'preview' ? t('render.preview') : t(`viewer.${f}`),
            }))}
          />
          <div className="relative flex h-[440px] w-full items-center justify-center rounded-xl bg-mat-in">
            <canvas
              ref={setCanvasEl}
              data-testid="render-canvas"
              aria-label={t('render.preview')}
              className="block rounded-md border border-line-strong"
              style={{
                width: Math.round(w * fit),
                height: Math.round(h * fit),
                background: transparent
                  ? 'repeating-conic-gradient(var(--mat-in) 0 25%, var(--panel) 0 50%) 0 0 / 16px 16px'
                  : 'var(--stage)',
              }}
            />
            {phase.kind === 'cloudDone' && phase.outputs.some((o) => o.format === 'png' && o.url) && (
              <img
                alt={t('render.cloudResult')}
                src={phase.outputs.find((o) => o.format === 'png')!.url!}
                className="absolute rounded-md border border-line-strong object-contain"
                style={{ width: Math.round(w * fit), height: Math.round(h * fit) }}
              />
            )}
            {phase.kind === 'preview' && (
              <span className="absolute bottom-3 rounded bg-panel/90 px-2 py-0.5 text-xs text-muted">
                {t('render.previewing')} · {w} × {h}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <FieldRow label={t('render.size')}>
            <Select<Size>
              label={t('render.size')}
              value={size}
              onChange={(v) => !rendering && setSize(v)}
              className="w-[180px]"
              options={SIZES.map((s) => ({ value: s, label: `${s.replace('x', ' × ')} · ${ratio(s)}` }))}
            />
          </FieldRow>
          <FieldRow label={t('render.frame')}>
            <Select<RenderFrame>
              label={t('render.frame')}
              value={frame}
              onChange={(v) => !rendering && setFrame(v)}
              className="w-[180px]"
              options={(['preview', 'front', 'back', 'side'] as const).map((f) => ({
                value: f,
                label: t(`render.frames.${f}`),
              }))}
            />
          </FieldRow>
          <FieldRow label={t('render.quality')}>
            <Select<RenderQuality>
              label={t('render.quality')}
              value={quality}
              onChange={(v) => !rendering && setQuality(v)}
              className="w-[180px]"
              options={(['draft', 'good', 'high', 'max'] as const).map((q) => ({
                value: q,
                label: t(`render.qualities.${q}`),
              }))}
            />
          </FieldRow>
          <label className="flex items-start gap-2 text-[13px] text-label">
            <input
              type="checkbox"
              checked={transparent}
              disabled={rendering}
              onChange={(e) => setTransparent(e.target.checked)}
              className="mt-0.5 size-4 accent-(--accent)"
            />
            {t('render.transparent')}
          </label>

          <div aria-live="polite" className="min-h-[52px] text-[13px] text-muted">
            {phase.kind === 'cloud' && (
              <div className="flex flex-col gap-1.5">
                <div
                  role="progressbar"
                  aria-label={t('render.cloud')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(phase.progress * 100)}
                  className="h-1.5 overflow-hidden rounded-full bg-mat-in"
                >
                  <div className="h-full bg-(--accent) transition-[width]" style={{ width: `${Math.max(2, phase.progress * 100)}%` }} />
                </div>
                <span>{t(`render.cloudStatus.${phase.status}` as 'render.cloudStatus.queued', { samples: phase.samples })}</span>
              </div>
            )}
            {phase.kind === 'cloudDone' && <span className="text-success-fg">{t('render.cloudDone')}</span>}
            {phase.kind === 'rendering' && (
              <div className="flex flex-col gap-1.5">
                <div
                  role="progressbar"
                  aria-label={t('render.title')}
                  aria-valuemin={0}
                  aria-valuemax={phase.total}
                  aria-valuenow={phase.done}
                  className="h-1.5 overflow-hidden rounded-full bg-mat-in"
                >
                  <div className="h-full bg-(--accent) transition-[width]" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
                </div>
                <span>
                  {phase.done === 0
                    ? t('render.preparing')
                    : `${t('render.progress', { done: phase.done, total: phase.total })}${eta ? ` · ${t('render.eta', { time: formatDuration(eta) })}` : ''}`}
                </span>
              </div>
            )}
            {phase.kind === 'done' && <span className="text-success-fg">{t('render.done', { time: formatDuration(phase.ms) })}</span>}
            {phase.kind === 'error' && <span className="text-danger">{t('render.failed', { message: phase.message })}</span>}
          </div>

          <div className="mt-auto grid grid-cols-2 gap-2">
            {cloudOk ? (
              <Button size="lg" icon={<Cloud />} className="col-span-2" disabled={rendering} onClick={() => void runCloud()}>
                {t('render.cloud')}
              </Button>
            ) : (
              <Tip label={t('render.cloudSignIn')}>
                <span className="col-span-2 grid">
                  <Button size="lg" icon={<Cloud />} disabled>
                    {t('render.cloud')}
                  </Button>
                </span>
              </Tip>
            )}
            {rendering ? (
              <Button size="lg" icon={<X />} className="col-span-2" onClick={() => (phase.kind === 'cloud' ? void cancelCloud() : stop())}>
                {t('render.cancel')}
              </Button>
            ) : (
              <Button size="lg" variant="primary" icon={<Cpu />} className="col-span-2" onClick={() => void run(true)} disabled={!canvasEl}>
                {t('render.local')}
              </Button>
            )}
            <Button icon={<Download />} disabled={phase.kind !== 'done' && phase.kind !== 'cloudDone'} onClick={() => void save('image/png')}>
              {t('render.savePng')}
            </Button>
            <Button icon={<Download />} disabled={phase.kind !== 'done' && phase.kind !== 'cloudDone'} onClick={() => void save('image/webp')}>
              {t('render.saveWebp')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
