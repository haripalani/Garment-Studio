import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Plus,
  RotateCcw,
  RotateCw,
  Type,
} from 'lucide-react';
import { formatLength, parseLength, type Layer } from '@gs/core';
import { drawLayerContent, type AlignTo } from '@gs/engine-2d';
import { Button, IconButton, NumberField, Section, cn } from '@gs/ui';
import { addText, align, moveInStack, rename, rotateBy, setVisible, update } from '../editor/actions';
import { pickImages } from '../editor/filePicker';
import { assetSource, useAssets } from '../store/assets';
import { useDoc, useSelected } from '../store/doc';
import { usePrefs } from '../store/prefs';
import { useWorkspace } from '../store/workspace';

export function ArtworkSection() {
  const { t } = useTranslation();
  const selected = useSelected();
  return (
    <Section
      title={t('design.artwork')}
      subtitle={selected ? selected.name : t('design.artworkSub')}
      className="pt-4"
    >
      <div data-tour="artwork" className="grid grid-cols-2 gap-2">
        <Button size="lg" variant="primary" icon={<ImageIcon />} onClick={() => pickImages()}>
          {t('design.image')}
        </Button>
        <Button size="lg" variant="primary" icon={<Type />} onClick={() => void addText()}>
          {t('design.text')}
        </Button>
      </div>
    </Section>
  );
}

const ALIGN: { to: AlignTo; icon: React.ReactNode }[] = [
  { to: 'left', icon: <AlignStartVertical /> },
  { to: 'centre', icon: <AlignHorizontalJustifyCenter /> },
  { to: 'right', icon: <AlignEndVertical /> },
  { to: 'top', icon: <AlignStartHorizontal /> },
  { to: 'middle', icon: <AlignVerticalJustifyCenter /> },
  { to: 'bottom', icon: <AlignEndHorizontal /> },
];

export function TransformSection() {
  const { t } = useTranslation();
  const layer = useSelected();
  const unit = usePrefs((s) => s.unit);
  if (!layer) return null;

  const setSize = (dim: 'w' | 'h', raw: string) => {
    const mm = parseLength(raw, unit);
    if (mm === null || mm < 1 || mm > 3000) return false;
    // Text keeps its proportions; other layers change one dimension.
    if (layer.type === 'text') {
      const k = mm / layer[dim];
      update(layer.id, { w: layer.w * k, h: layer.h * k }, 'Resize');
    } else update(layer.id, { [dim]: mm }, 'Resize');
    return true;
  };

  return (
    <Section title={t('transform.title')}>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2.5 gap-y-2">
        <span className="text-label">{t('transform.width')}</span>
        <NumberField
          label={t('transform.width')}
          display={formatLength(layer.w, unit, false)}
          suffix={unit}
          onCommit={(r) => setSize('w', r)}
        />
        <span className="text-label">{t('transform.height')}</span>
        <NumberField
          label={t('transform.height')}
          display={formatLength(layer.h, unit, false)}
          suffix={unit}
          onCommit={(r) => setSize('h', r)}
        />
        <span className="text-label">{t('transform.rotation')}</span>
        <NumberField
          label={t('transform.rotation')}
          display={String(Math.round(layer.rotationDeg * 10) / 10)}
          suffix="°"
          onCommit={(raw) => {
            const v = Number(raw.replace(',', '.'));
            if (!Number.isFinite(v)) return false;
            update(layer.id, { rotationDeg: ((((v + 180) % 360) + 360) % 360) - 180 }, 'Rotate');
            return true;
          }}
        />
        <span className="text-label">{t('transform.opacity')}</span>
        <NumberField
          label={t('transform.opacity')}
          display={String(Math.round(layer.opacity * 100))}
          suffix="%"
          onCommit={(raw) => {
            const v = Number(raw);
            if (!Number.isFinite(v) || v < 0 || v > 100) return false;
            update(layer.id, { opacity: v / 100 }, 'Opacity');
            return true;
          }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          icon={<RotateCcw />}
          onClick={() => rotateBy(layer.id, -90)}
          aria-label={t('transform.rotL')}
        >
          90°
        </Button>
        <Button
          size="sm"
          icon={<RotateCw />}
          onClick={() => rotateBy(layer.id, 90)}
          aria-label={t('transform.rotR')}
        >
          90°
        </Button>
        <span className="text-xs text-muted">{t('transform.dragHint')}</span>
      </div>
      <div
        role="group"
        aria-label={t('transform.align')}
        className="grid grid-cols-6 rounded-lg border border-line-strong"
      >
        {ALIGN.map((a) => (
          <IconButton
            key={a.to}
            label={t(`transform.alignTo.${a.to}`)}
            icon={a.icon}
            onClick={() => align(layer.id, a.to)}
            className="w-full rounded-none [&_svg]:size-4"
          />
        ))}
      </div>
    </Section>
  );
}

/* ───────────── layers ───────────── */

function LayerThumb({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const assetsVersion = useAssets((s) => s.version);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 34 * dpr;
    c.height = 34 * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = (30 * dpr) / Math.max(layer.w, layer.h);
    ctx.setTransform(k * (layer.flipX ? -1 : 1), 0, 0, k, c.width / 2, c.height / 2);
    drawLayerContent(ctx, { ...layer, opacity: 1 }, { asset: assetSource, fxMaxSide: 256 });
  }, [layer, assetsVersion]);
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-[repeating-conic-gradient(var(--mat-in)_0_25%,var(--panel)_0_50%)] bg-[length:10px_10px]">
      <canvas ref={ref} className="size-[34px]" aria-hidden />
    </span>
  );
}

export function LayersSection() {
  const { t } = useTranslation();
  const layers = useDoc((s) => s.doc.layers);
  const selectedId = useDoc((s) => s.selectedId);
  const select = useDoc((s) => s.select);
  const side = useWorkspace((s) => s.side);
  const setSide = useWorkspace((s) => s.setSide);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  function onDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragId) {
      const from = layers.findIndex((l) => l.id === dragId);
      moveInStack(dragId, from < index ? index - 1 : index);
    }
    setDragId(null);
    setOverIndex(null);
  }

  return (
    <Section
      title={t('design.layers')}
      action={
        <IconButton
          label={t('design.addLayer')}
          icon={<Plus />}
          onClick={() => pickImages()}
          className="size-[26px] w-[26px]"
        />
      }
    >
      {layers.length === 0 ? (
        <p className="m-0 text-xs text-muted">
          {t('design.layersEmpty')}
          <br />
          {t('design.layersTip')}
        </p>
      ) : (
        <ul aria-label={t('design.layers')} className="-mx-2 m-0 flex list-none flex-col gap-0.5 p-0">
          {layers.map((l, i) => (
            <li
              key={l.id}
              aria-current={l.id === selectedId ? 'true' : undefined}
              draggable={renaming !== l.id}
              onDragStart={(e) => {
                setDragId(l.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOverIndex(e.clientY < r.top + r.height / 2 ? i : i + 1);
              }}
              onDrop={(e) => onDrop(e, overIndex ?? i)}
              onDragEnd={() => {
                setDragId(null);
                setOverIndex(null);
              }}
              onKeyDown={(e) => {
                if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                  e.preventDefault();
                  moveInStack(l.id, e.key === 'ArrowUp' ? i - 1 : i + 1);
                }
              }}
              title={t('design.dragHint')}
              className={cn(
                'relative flex items-center gap-0.5 rounded-[10px] px-1',
                l.id === selectedId ? 'bg-accent-soft' : 'hover:bg-hover',
                dragId === l.id && 'opacity-50',
                overIndex === i &&
                  'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:bg-accent',
                overIndex === i + 1 &&
                  i === layers.length - 1 &&
                  'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-accent',
              )}
            >
              <IconButton
                label={l.visible ? t('design.hideLayer') : t('design.showLayer')}
                icon={l.visible ? <Eye /> : <EyeOff />}
                onClick={() => setVisible(l.id, !l.visible)}
                className={cn('size-[30px] w-[30px] [&_svg]:size-[17px]', !l.visible && 'text-faint')}
              />
              {renaming === l.id ? (
                // Rename field replaces the row button (inputs must not be nested in buttons).
                <span className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1.5">
                  <LayerThumb layer={l} />
                  <input
                    autoFocus
                    defaultValue={l.name}
                    aria-label={t('design.rename')}
                    onBlur={(e) => {
                      rename(l.id, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="h-7 min-w-0 flex-1 rounded border border-accent bg-field px-1.5 text-[13px] text-ink outline-none"
                  />
                </span>
              ) : (
                <button
                  type="button"
                  aria-pressed={l.id === selectedId}
                  onClick={() => {
                    select(l.id);
                    if (l.side !== side) setSide(l.side);
                  }}
                  onDoubleClick={() => setRenaming(l.id)}
                  onKeyDown={(e) => e.key === 'F2' && setRenaming(l.id)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1.5 text-left',
                    !l.visible && 'opacity-50',
                  )}
                >
                  <LayerThumb layer={l} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] text-ink">{l.name}</span>
                    <small className="truncate text-[11.5px] text-muted">
                      {t(`design.types.${l.type}`)}
                      {l.side === 'inside' ? ` · ${t('pattern.inside').toLowerCase()}` : ''}
                      {l.wrap.on ? ` · ${t('design.wrapped')}` : ''}
                    </small>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
