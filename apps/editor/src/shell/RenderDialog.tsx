import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Cpu, Download } from 'lucide-react';
import { Button, FieldRow, Modal, Segmented, Select, StageNotice } from '@gs/ui';
import { useWorkspace, type CameraPreset } from '../store/workspace';

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

function ratio(size: Size): string {
  const [w, h] = size.split('x').map(Number) as [number, number];
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

type Frame = 'preview' | 'front' | 'back' | 'side';
type Quality = 'draft' | 'good' | 'high' | 'max';

export function RenderDialog() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.dialog === 'render');
  const openDialog = useWorkspace((s) => s.openDialog);
  const [size, setSize] = useState<Size>('2000x2500');
  const [frame, setFrame] = useState<Frame>('preview');
  const [quality, setQuality] = useState<Quality>('good');
  const [transparent, setTransparent] = useState(false);
  const [cam, setCam] = useState<CameraPreset>('front');
  const [w, h] = size.split('x').map(Number) as [number, number];

  return (
    <Modal open={open} onOpenChange={(o) => !o && openDialog(null)} title={t('render.title')} width={940}>
      <div className="grid grid-cols-[1fr_300px] gap-5">
        <div className="flex flex-col items-center gap-3">
          <Segmented<CameraPreset>
            label={t('viewer.camera')}
            size="sm"
            surface="outlined"
            value={cam}
            onChange={setCam}
            options={(['front', 'back', 'side'] as const).map((c) => ({ value: c, label: t(`viewer.${c}`) }))}
          />
          <div className="flex h-[440px] w-full items-center justify-center rounded-xl bg-mat-in">
            <div
              className="flex items-center justify-center rounded-md border border-line-strong p-6 text-center"
              style={{
                aspectRatio: `${w} / ${h}`,
                height: w >= h ? undefined : '100%',
                width: w >= h ? '100%' : undefined,
                maxHeight: '100%',
                maxWidth: '100%',
                background: transparent
                  ? 'repeating-conic-gradient(var(--mat-in) 0 25%, var(--panel) 0 50%) 0 0 / 16px 16px'
                  : 'var(--stage)',
              }}
            >
              <span className="text-xs text-muted">
                {t('render.preview')} · {w} × {h}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <FieldRow label={t('render.size')}>
            <Select<Size>
              label={t('render.size')}
              value={size}
              onChange={setSize}
              className="w-[180px]"
              options={SIZES.map((s) => ({ value: s, label: `${s.replace('x', ' × ')} · ${ratio(s)}` }))}
            />
          </FieldRow>
          <FieldRow label={t('render.frame')}>
            <Select<Frame>
              label={t('render.frame')}
              value={frame}
              onChange={setFrame}
              className="w-[180px]"
              options={(['preview', 'front', 'back', 'side'] as const).map((f) => ({
                value: f,
                label: t(`render.frames.${f}`),
              }))}
            />
          </FieldRow>
          <FieldRow label={t('render.quality')}>
            <Select<Quality>
              label={t('render.quality')}
              value={quality}
              onChange={setQuality}
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
              onChange={(e) => setTransparent(e.target.checked)}
              className="mt-0.5 size-4 accent-(--accent)"
            />
            {t('render.transparent')}
          </label>
          <StageNotice stage={7}>{t('render.stage')}</StageNotice>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <Button size="lg" variant="primary" icon={<Cloud />} disabled className="col-span-2">
              {t('render.cloud')}
            </Button>
            <Button size="lg" icon={<Cpu />} disabled className="col-span-2">
              {t('render.local')}
            </Button>
            <Button icon={<Download />} disabled>
              {t('render.savePng')}
            </Button>
            <Button icon={<Download />} disabled>
              {t('render.saveWebp')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
