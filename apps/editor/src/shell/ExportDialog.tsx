import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { Button, FieldRow, Modal, Segmented, Select } from '@gs/ui';
import type { Unit } from '@gs/core';
import { useDoc } from '../store/doc';
import { usePrefs } from '../store/prefs';
import { toast } from '../store/toast';
import { useWorkspace } from '../store/workspace';
import { download, outputName } from '../render/download';
import { VIDEO_SIZES, type Dpi, type VideoSize } from '../export/options';
import { ExportBlocked, needsWatermark, recordExport } from '../cloud/exports';

type Kind = 'print' | 'panels' | 'spec' | 'video';
const KINDS: readonly Kind[] = ['print', 'panels', 'spec', 'video'];
const TITLE: Record<Kind, 'export.print' | 'export.panels' | 'export.spec' | 'export.video'> = {
  print: 'export.print',
  panels: 'export.panels',
  spec: 'export.spec',
  video: 'export.video',
};
const BLEEDS = [0, 3, 5, 10, 20] as const;
const SECONDS = [4, 8, 12, 20] as const;

type Phase = { kind: 'idle' } | { kind: 'working'; done: number; total: number } | { kind: 'error'; message: string };

/** Options and progress for the file exports (print ZIP, sublimation ZIP, spec PDF, turntable video). */
export function ExportDialog() {
  const { t } = useTranslation();
  const dialog = useWorkspace((s) => s.dialog);
  const openDialog = useWorkspace((s) => s.openDialog);
  const kind = (KINDS as readonly string[]).includes(dialog ?? '') ? (dialog as Kind) : null;
  const prefUnit = usePrefs((s) => s.unit);
  const [dpi, setDpi] = useState<Dpi>(300);
  const [bleed, setBleed] = useState<number>(5);
  const [cutLine, setCutLine] = useState(true);
  const [size, setSize] = useState<VideoSize>('1080x1080');
  const [seconds, setSeconds] = useState<number>(8);
  const [unit, setUnit] = useState<Unit>(prefUnit);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!kind) {
      abort.current?.abort();
      setPhase({ kind: 'idle' });
    } else if (kind === 'panels') setBleed(10);
    else if (kind === 'print') setBleed(5);
  }, [kind]);

  const working = phase.kind === 'working';
  const progress = (done: number, total: number) => setPhase({ kind: 'working', done, total });

  const create = async () => {
    if (!kind) return;
    const { doc, garment } = useDoc.getState();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ kind: 'working', done: 0, total: 0 });
    try {
      // Counted against the plan first (signed in): a used-up quota stops the export here.
      await recordExport(
        { print: 'print_zip', panels: 'sublimation_zip', spec: 'spec_pdf', video: 'turntable_video' }[kind] as 'print_zip',
        kind === 'video' ? { durationSec: seconds, resolution: size } : kind === 'spec' ? {} : { dpi, bleedMm: bleed },
      );
      let blob: Blob;
      let name: string;
      if (kind === 'print' || kind === 'panels') {
        // Export code (zip, PDF, video encoders) loads on demand, keeping it out of the editor's start-up.
        const { buildPrintZip, buildSublimationZip } = await import('../export/printFiles');
        const r =
          kind === 'print'
            ? await buildPrintZip(garment, doc, { dpi, bleedMm: bleed, onProgress: progress })
            : await buildSublimationZip(garment, doc, { dpi, bleedMm: bleed, cutLine, onProgress: progress });
        blob = new Blob([r.zip as BlobPart], { type: 'application/zip' });
        name = outputName(kind === 'print' ? `print-files-${dpi}dpi` : `sublimation-${dpi}dpi`, 'zip');
      } else if (kind === 'spec') {
        const { buildSpecSheet } = await import('../export/specSheet');
        blob = new Blob([(await buildSpecSheet(garment, doc, unit)) as BlobPart], { type: 'application/pdf' });
        name = outputName('spec-sheet', 'pdf');
      } else {
        const { buildTurntable } = await import('../export/turntable');
        const v = await buildTurntable(garment, doc, { size, seconds, onProgress: progress, signal: ctl.signal, watermark: needsWatermark() });
        blob = v.blob;
        name = outputName(`turntable-${size}`, v.ext);
      }
      if (ctl.signal.aborted) return;
      download(blob, name);
      toast(t('exportDialog.done', { file: name }));
      setPhase({ kind: 'idle' });
      openDialog(null);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return setPhase({ kind: 'idle' });
      if (e instanceof ExportBlocked) return setPhase({ kind: 'error', message: e.message });
      console.error('export failed', e);
      setPhase({ kind: 'error', message: (e as Error).message });
    } finally {
      if (abort.current === ctl) abort.current = null;
    }
  };

  return (
    <Modal open={kind !== null} onOpenChange={(o) => !o && openDialog(null)} title={kind ? t(TITLE[kind]) : ''} width={460}>
      {kind && (
        <div className="flex flex-col gap-3.5">
          <p className="m-0 text-[13px] text-muted">{t(`exportDialog.${kind}Help`)}</p>
          {(kind === 'print' || kind === 'panels') && (
            <>
              <FieldRow label={t('exportDialog.dpi')}>
                <Segmented<string>
                  label={t('exportDialog.dpi')}
                  size="sm"
                  value={String(dpi)}
                  onChange={(v) => setDpi(Number(v) as Dpi)}
                  options={[150, 300].map((d) => ({ value: String(d), label: t('exportDialog.dpiValue', { dpi: d }) }))}
                />
              </FieldRow>
              <FieldRow label={t('exportDialog.bleed')}>
                <Select<string>
                  label={t('exportDialog.bleed')}
                  value={String(bleed)}
                  onChange={(v) => setBleed(Number(v))}
                  className="w-[140px]"
                  options={BLEEDS.map((b) => ({ value: String(b), label: `${b} mm` }))}
                />
              </FieldRow>
            </>
          )}
          {kind === 'panels' && (
            <label className="flex items-center gap-2 text-[13px] text-label">
              <input type="checkbox" checked={cutLine} onChange={(e) => setCutLine(e.target.checked)} className="size-4 accent-(--accent)" />
              {t('exportDialog.cutLine')}
            </label>
          )}
          {kind === 'spec' && (
            <FieldRow label={t('exportDialog.unit')}>
              <Segmented<Unit>
                label={t('exportDialog.unit')}
                size="sm"
                value={unit}
                onChange={setUnit}
                options={(['mm', 'cm', 'in'] as const).map((u) => ({ value: u, label: u }))}
              />
            </FieldRow>
          )}
          {kind === 'video' && (
            <>
              <FieldRow label={t('exportDialog.videoSize')}>
                <Select<VideoSize>
                  label={t('exportDialog.videoSize')}
                  value={size}
                  onChange={setSize}
                  className="w-[160px]"
                  options={VIDEO_SIZES.map((s) => ({ value: s, label: s.replace('x', ' × ') }))}
                />
              </FieldRow>
              <FieldRow label={t('exportDialog.videoLength')}>
                <Segmented<string>
                  label={t('exportDialog.videoLength')}
                  size="sm"
                  value={String(seconds)}
                  onChange={(v) => setSeconds(Number(v))}
                  options={SECONDS.map((n) => ({ value: String(n), label: t('exportDialog.seconds', { n }) }))}
                />
              </FieldRow>
            </>
          )}
          <div aria-live="polite" className="min-h-[36px] text-[13px] text-muted">
            {working && (
              <div className="flex flex-col gap-1.5">
                <div
                  role="progressbar"
                  aria-label={t(TITLE[kind])}
                  aria-valuemin={0}
                  aria-valuemax={phase.total || 1}
                  aria-valuenow={phase.done}
                  className="h-1.5 overflow-hidden rounded-full bg-mat-in"
                >
                  <div className="h-full bg-(--accent)" style={{ width: `${phase.total ? (phase.done / phase.total) * 100 : 4}%` }} />
                </div>
                <span>
                  {phase.total ? t('exportDialog.working', { done: phase.done, total: phase.total }) : t('exportDialog.preparing')}
                </span>
              </div>
            )}
            {phase.kind === 'error' && <span className="text-danger">{t('exportDialog.failed', { message: phase.message })}</span>}
          </div>
          <div className="flex justify-end gap-2">
            {working && kind === 'video' && (
              <Button icon={<X />} onClick={() => abort.current?.abort()}>
                {t('exportDialog.cancel')}
              </Button>
            )}
            <Button variant="primary" icon={<Download />} disabled={working} onClick={() => void create()}>
              {t('exportDialog.create')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
