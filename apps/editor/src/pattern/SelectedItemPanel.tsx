import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Copy,
  Crop,
  FlipHorizontal2,
  Info,
  Trash2,
} from 'lucide-react';
import {
  PRESET_IDS,
  SHAPE_KINDS,
  type ImageLayer,
  type Layer,
  type Paint,
  type ShapeKind,
  type ShapeLayer,
  type TextLayer,
} from '@gs/core';
import {
  Button,
  ColourField,
  FieldRow,
  NumberField,
  Segmented,
  Select,
  SliderRow,
  Switch,
  ToggleRow,
  cn,
} from '@gs/ui';
import {
  applyPreset,
  deleteLayer,
  duplicateLayer,
  endLive,
  flip,
  live,
  resetCrop,
  trimEmptyEdges,
  update,
  updateText,
} from '../editor/actions';
import { FONTS } from '../fonts';
import { useSelected } from '../store/doc';
import { usePrefs } from '../store/prefs';
import { useWorkspace } from '../store/workspace';
import { PaintEditor } from './PaintEditor';

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Floating panel with the selected layer's own properties (text, shape or image). */
export function SelectedItemPanel() {
  const { t } = useTranslation();
  const layer = useSelected();
  const side = useWorkspace((s) => s.side);
  const viewMode = usePrefs((s) => s.viewMode);
  const [open, setOpen] = useState(true);
  if (!layer || layer.side !== side) return null;

  // Positioned within <main>: over the 3D stage's left edge in split view (keeps the pattern visible),
  // against the inspector otherwise.
  const position =
    viewMode === 'split' ? { left: 'calc((100% - 320px) / 2 + 12px)' } : { right: 'calc(320px + 12px)' };

  return (
    <div
      role="region"
      aria-label={t('item.title')}
      style={position}
      className="absolute top-[64px] z-10 flex max-h-[calc(100%-136px)] w-[292px] flex-col overflow-hidden rounded-xl border border-glass-line bg-glass-strong shadow-panel backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 shrink-0 items-center justify-between px-3 text-[13px] font-semibold text-ink"
      >
        {t('item.title')}
        <ChevronDown className={cn('size-4 text-muted transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="flex flex-col gap-3 overflow-x-hidden overflow-y-auto px-3 pb-3">
          {layer.type === 'text' && <TextProps layer={layer} />}
          {layer.type === 'shape' && <ShapeProps layer={layer} />}
          <Actions layer={layer} />
          {layer.type === 'image' && <ImageAdjust layer={layer} />}
          <Wrap layer={layer} />
          <Presets layer={layer} />
        </div>
      )}
    </div>
  );
}

function setPaint(layer: TextLayer | ShapeLayer, paint: Paint, done: boolean) {
  if (done) {
    endLive();
    update(layer.id, { paint }, 'Colour');
  } else live(layer.id, { paint }, 'Colour');
}

/* ───────────── text ───────────── */

function TextProps({ layer }: { layer: TextLayer }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const focusToken = useWorkspace((s) => s.focusTextToken);
  useEffect(() => {
    if (focusToken) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [focusToken]);

  return (
    <>
      <textarea
        ref={ref}
        aria-label={t('item.text')}
        value={layer.text}
        rows={2}
        onChange={(e) =>
          void updateText(
            layer.id,
            { text: e.target.value, name: e.target.value.split('\n')[0]?.slice(0, 60) || 'Text' },
            true,
          )
        }
        onBlur={endLive}
        className="min-h-14 w-full resize-y rounded-lg border border-line-strong bg-field px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
      />
      <Select
        label={t('item.font')}
        value={layer.font}
        onChange={(font) => void updateText(layer.id, { font })}
        options={FONTS.map((f) => ({
          value: f.css,
          label: <span style={{ fontFamily: `"${f.css}"` }}>{f.label}</span>,
        }))}
        className="w-full"
      />
      <Select
        label={t('item.weight')}
        value={String(layer.weight)}
        onChange={(w) => void updateText(layer.id, { weight: Number(w) })}
        options={WEIGHTS.map((w) => ({ value: String(w), label: `${w} · ${t(`item.weights.w${w}`)}` }))}
        className="w-full"
      />
      <FieldRow label={t('item.style')}>
        <span className="flex gap-1">
          <StyleToggle
            label={t('item.bold')}
            on={layer.weight >= 600}
            onClick={() => void updateText(layer.id, { weight: layer.weight >= 600 ? 400 : 700 })}
          >
            <b>B</b>
          </StyleToggle>
          <StyleToggle
            label={t('item.italic')}
            on={layer.italic}
            onClick={() => void updateText(layer.id, { italic: !layer.italic })}
          >
            <i className="font-serif">I</i>
          </StyleToggle>
          <StyleToggle
            label={t('item.caps')}
            on={layer.caps}
            onClick={() => void updateText(layer.id, { caps: !layer.caps })}
          >
            <span className="text-[11px] font-bold">AA</span>
          </StyleToggle>
        </span>
      </FieldRow>
      <FieldRow label={t('item.paragraph')}>
        <Segmented<TextLayer['align']>
          label={t('item.paragraph')}
          size="sm"
          surface="outlined"
          value={layer.align}
          onChange={(align) => update(layer.id, { align }, 'Align text')}
          options={[
            { value: 'left', label: <AlignLeft />, ariaLabel: t('item.alignLeft') },
            { value: 'center', label: <AlignCenter />, ariaLabel: t('item.alignCentre') },
            { value: 'right', label: <AlignRight />, ariaLabel: t('item.alignRight') },
          ]}
        />
      </FieldRow>
      <SliderRow
        label={t('item.lineHeight')}
        value={layer.lineHeight}
        min={0.6}
        max={2.5}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(lineHeight) => void updateText(layer.id, { lineHeight }, true)}
        onCommit={endLive}
      />
      <SliderRow
        label={t('item.letterSpacing')}
        value={layer.letterSpacing}
        min={-0.1}
        max={0.6}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(letterSpacing) => void updateText(layer.id, { letterSpacing }, true)}
        onCommit={endLive}
      />
      <PaintEditor paint={layer.paint} onChange={(p, done) => setPaint(layer, p, done)} />
    </>
  );
}

function StyleToggle({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg border text-[13px]',
        on ? 'border-accent bg-accent-soft text-accent-fg' : 'border-line-strong text-ink hover:bg-hover',
      )}
    >
      {children}
    </button>
  );
}

/* ───────────── shape ───────────── */

function ShapeProps({ layer }: { layer: ShapeLayer }) {
  const { t } = useTranslation();
  const isLine = layer.kind === 'line' || layer.kind === 'dashed-line';
  return (
    <>
      <Select<ShapeKind>
        label={t('item.shape')}
        value={layer.kind}
        onChange={(kind) =>
          update(
            layer.id,
            {
              kind,
              outline: {
                ...layer.outline,
                on: kind === 'line' || kind === 'dashed-line' ? true : layer.outline.on,
                dashed: kind === 'dashed-line',
              },
            } as Partial<Layer>,
            'Shape',
          )
        }
        options={SHAPE_KINDS.map((k) => ({ value: k, label: t(`pattern.shapeKinds.${k}`) }))}
        className="w-full"
      />
      <PaintEditor paint={layer.paint} onChange={(p, done) => setPaint(layer, p, done)} />
      {!isLine && (
        <ToggleRow
          label={t('item.outlineOnly')}
          checked={layer.outline.on}
          onChange={(on) =>
            update(layer.id, { outline: { ...layer.outline, on } } as Partial<Layer>, 'Outline')
          }
        />
      )}
      {(isLine || layer.outline.on) && (
        <>
          {!isLine && (
            <ToggleRow
              label={t('item.dashed')}
              checked={layer.outline.dashed}
              onChange={(dashed) =>
                update(layer.id, { outline: { ...layer.outline, dashed } } as Partial<Layer>, 'Dashed')
              }
            />
          )}
          <SliderRow
            label={t('item.thickness')}
            value={layer.outline.thicknessMm}
            min={0.5}
            max={30}
            step={0.5}
            format={(v) => v.toFixed(1)}
            onChange={(thicknessMm) =>
              live(layer.id, { outline: { ...layer.outline, thicknessMm } } as Partial<Layer>, 'Thickness')
            }
            onCommit={endLive}
          />
        </>
      )}
    </>
  );
}

/* ───────────── common actions ───────────── */

function Actions({ layer }: { layer: Layer }) {
  const { t } = useTranslation();
  const cropMode = useWorkspace((s) => s.cropMode);
  const setCropMode = useWorkspace((s) => s.setCropMode);
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('grid gap-1.5', layer.type === 'image' ? 'grid-cols-4' : 'grid-cols-2')}>
        <Button
          size="sm"
          icon={<FlipHorizontal2 />}
          onClick={() => flip(layer.id)}
          aria-pressed={layer.flipX}
        >
          {t('item.mirror')}
        </Button>
        {layer.type === 'image' && (
          <>
            <Button
              size="sm"
              aria-pressed={layer.adjust.invert}
              className={cn(layer.adjust.invert && 'border-accent text-accent-fg')}
              onClick={() =>
                update(
                  layer.id,
                  { adjust: { ...layer.adjust, invert: !layer.adjust.invert } } as Partial<Layer>,
                  'Invert',
                )
              }
            >
              {t('item.invert')}
            </Button>
            <Button
              size="sm"
              icon={<Crop />}
              aria-pressed={cropMode}
              className={cn(cropMode && 'border-accent text-accent-fg')}
              onClick={() => setCropMode(!cropMode)}
            >
              {t('item.crop')}
            </Button>
          </>
        )}
        <Button size="sm" icon={<Copy />} onClick={() => duplicateLayer(layer.id)}>
          {t('item.copy')}
        </Button>
      </div>
      {layer.type === 'image' && cropMode && <CropBar layer={layer} />}
      <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => deleteLayer(layer.id)}>
        {t('item.delete')}
      </Button>
    </div>
  );
}

function CropBar({ layer }: { layer: ImageLayer }) {
  const { t } = useTranslation();
  const setCropMode = useWorkspace((s) => s.setCropMode);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent-soft/50 p-2.5">
      <p className="m-0 text-xs text-muted">{t('item.cropHint')}</p>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" onClick={() => trimEmptyEdges(layer.id)}>
          {t('item.trim')}
        </Button>
        <Button size="sm" onClick={() => resetCrop(layer.id)} disabled={!layer.crop}>
          {t('item.resetCrop')}
        </Button>
      </div>
      <Button size="sm" variant="primary" onClick={() => setCropMode(false)}>
        {t('item.done')}
      </Button>
    </div>
  );
}

function ImageAdjust({ layer }: { layer: ImageLayer }) {
  const { t } = useTranslation();
  const a = layer.adjust;
  const set = (patch: Partial<ImageLayer['adjust']>, gesture: boolean) =>
    (gesture ? live : update)(layer.id, { adjust: { ...a, ...patch } } as Partial<Layer>, 'Colours');
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <SliderRow
        label={t('item.hue')}
        value={a.hueDeg}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(hueDeg) => set({ hueDeg }, true)}
        onCommit={endLive}
        disabled={a.fill !== null}
      />
      <SliderRow
        label={t('item.saturation')}
        value={a.saturation}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(saturation) => set({ saturation }, true)}
        onCommit={endLive}
        disabled={a.fill !== null}
      />
      <FieldRow label={t('item.fill')}>
        <span className="flex items-center gap-2">
          <Switch
            label={t('item.fill')}
            checked={a.fill !== null}
            onChange={(on) => set({ fill: on ? '#ffffff' : null }, false)}
          />
          {a.fill !== null && (
            <ColourField
              label={t('item.fillColour')}
              value={a.fill}
              onChange={(fill) => set({ fill }, false)}
            />
          )}
        </span>
      </FieldRow>
      <Button
        size="sm"
        variant="ghost"
        disabled={!a.invert && a.hueDeg === 0 && a.saturation === 1 && a.fill === null}
        onClick={() =>
          update(
            layer.id,
            { adjust: { invert: false, hueDeg: 0, saturation: 1, fill: null } } as Partial<Layer>,
            'Reset colours',
          )
        }
      >
        {t('item.resetColours')}
      </Button>
    </div>
  );
}

/* ───────────── wrap & presets ───────────── */

function Wrap({ layer }: { layer: Layer }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(false);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className={cn('flex-1', layer.wrap.on && 'border-accent bg-accent-soft text-accent-fg')}
          aria-pressed={layer.wrap.on}
          onClick={() => update(layer.id, { wrap: { ...layer.wrap, on: !layer.wrap.on } }, 'Wrap over seams')}
        >
          {t('item.wrap')}
        </Button>
        <button
          type="button"
          aria-label={t('item.wrapInfo')}
          aria-expanded={info}
          onClick={() => setInfo((v) => !v)}
          className="flex size-7 items-center justify-center rounded-full text-muted hover:text-ink [&_svg]:size-4"
        >
          <Info />
        </button>
      </div>
      {info && <p className="m-0 rounded-lg bg-seg p-2.5 text-xs text-muted">{t('item.wrapText')}</p>}
      {layer.wrap.on && (
        <FieldRow label={t('item.bleed')}>
          <NumberField
            label={t('item.bleed')}
            display={(layer.wrap.bleedMm / 10).toFixed(1)}
            suffix="cm"
            className="w-24"
            onCommit={(raw) => {
              const v = Number(raw.replace(',', '.'));
              if (!Number.isFinite(v) || v < 0 || v > 5) return false;
              update(layer.id, { wrap: { ...layer.wrap, bleedMm: v * 10 } }, 'Bleed');
              return true;
            }}
          />
        </FieldRow>
      )}
    </div>
  );
}

function Presets({ layer }: { layer: Layer }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <span className="text-xs text-muted">{t('item.placeAt')}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {PRESET_IDS.map((p) => (
          <Button
            key={p}
            size="sm"
            onClick={() => applyPreset(layer.id, p)}
            className={cn(p === 'printedLabel' && 'col-span-2')}
          >
            {t(`item.presets.${p}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
