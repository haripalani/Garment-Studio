import { useTranslation } from 'react-i18next';
import {
  Circle,
  Diamond,
  Grid3x3,
  Hand,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Plus,
  RectangleHorizontal,
  Shapes,
  Square,
  Star,
  Triangle,
  Type,
} from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { formatLength, piecesOnSide, UNITS, type Unit } from '@gs/core';
import { Button, FloatingBar, IconButton, Popover, Segmented, Tip, cn } from '@gs/ui';
import { fit } from '../editor/actions';
import { pickImages } from '../editor/filePicker';
import { PatternCanvas } from '../pattern/PatternCanvas';
import { useDoc } from '../store/doc';
import { usePrefs } from '../store/prefs';
import { look, useLook } from '../store/look';
import { useWorkspace, type ShapeKind, type Side, type Tool } from '../store/workspace';
import { StageHeader } from './StageHeader';

export function PatternStage() {
  const { t } = useTranslation();
  const side = useWorkspace((s) => s.side);
  const setSide = useWorkspace((s) => s.setSide);
  const garment = useDoc((s) => s.garment);
  const count = piecesOnSide(garment, side).length;

  return (
    <section
      data-tour="pattern"
      aria-label={t('pattern.title')}
      className="@container/pattern flex min-w-0 flex-1 flex-col bg-panel"
    >
      <StageHeader
        title={t('pattern.title')}
        sub={<span className="@max-[400px]/pattern:hidden">{t('pattern.pieces', { count })}</span>}
      >
        <Segmented<Side>
          label={t('pattern.side')}
          size="sm"
          tone="accent"
          surface="outlined"
          value={side}
          onChange={setSide}
          options={[
            { value: 'outside', label: t('pattern.outside') },
            { value: 'inside', label: t('pattern.inside') },
          ]}
        />
      </StageHeader>

      <div className="relative min-h-0 flex-1 overflow-hidden border-t border-line bg-mat">
        <PatternCanvas />
        <ToolRail />
        <UnitBox />
        <CursorReadout />
        <ZoomBar />
      </div>
    </section>
  );
}

function CursorReadout() {
  const cursor = useWorkspace((s) => s.cursor);
  const unit = usePrefs((s) => s.unit);
  return (
    <span className="pointer-events-none absolute bottom-5 left-9 max-w-[30%] truncate text-xs text-faint tabular-nums">
      {cursor
        ? `${cursor.piece} · ${formatLength(cursor.x, unit, false)} × ${formatLength(cursor.y, unit)}`
        : '—'}
    </span>
  );
}

const SHAPES: { kind: ShapeKind; icon: ReactNode }[] = [
  { kind: 'rect', icon: <RectangleHorizontal /> },
  { kind: 'square', icon: <Square /> },
  { kind: 'circle', icon: <Circle /> },
  { kind: 'triangle', icon: <Triangle /> },
  { kind: 'star', icon: <Star /> },
  { kind: 'diamond', icon: <Diamond /> },
  { kind: 'line', icon: <Minus className="-rotate-45" /> },
  { kind: 'dashed-line', icon: <Minus className="-rotate-45 [stroke-dasharray:3_3]" /> },
];

function ToolRail() {
  const { t } = useTranslation();
  const tool = useWorkspace((s) => s.tool);
  const setTool = useWorkspace((s) => s.setTool);
  const shapeKind = useWorkspace((s) => s.shapeKind);
  const setShapeKind = useWorkspace((s) => s.setShapeKind);

  const tools: { id: Tool; label: string; icon: ReactNode }[] = [
    { id: 'select', label: t('pattern.select'), icon: <MousePointer2 /> },
    { id: 'hand', label: t('pattern.hand'), icon: <Hand /> },
    { id: 'image', label: t('pattern.image'), icon: <ImageIcon /> },
    { id: 'text', label: t('pattern.text'), icon: <Type /> },
  ];

  return (
    <FloatingBar
      role="toolbar"
      aria-label={t('pattern.tools')}
      aria-orientation="vertical"
      className="absolute top-10 left-9 flex-col gap-1 p-1.5"
    >
      {tools.map((x) => (
        <ToolButton
          key={x.id}
          label={x.label}
          active={tool === x.id}
          onClick={() => (x.id === 'image' ? pickImages() : setTool(x.id))}
        >
          {x.icon}
        </ToolButton>
      ))}
      <Popover
        side="right"
        align="start"
        className="grid grid-cols-4 gap-1 p-1.5"
        trigger={
          <ToolButton label={t('pattern.shapes')} active={tool === 'shape'}>
            <Shapes />
          </ToolButton>
        }
      >
        {SHAPES.map((s) => (
          <ToolButton
            key={s.kind}
            label={t(`pattern.shapeKinds.${s.kind}`)}
            active={tool === 'shape' && shapeKind === s.kind}
            onClick={() => setShapeKind(s.kind)}
          >
            {s.icon}
          </ToolButton>
        ))}
      </Popover>
    </FloatingBar>
  );
}

// Forwards ref and props so it can be a Radix trigger (asChild) itself — the popover's
// aria-haspopup/expanded then sit on the real button.
const ToolButton = forwardRef<
  HTMLButtonElement,
  { label: string; active: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>
>(function ToolButton({ label, active, children, className, ...rest }, ref) {
  return (
    <Tip label={label} side="right">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        {...rest}
        className={cn(
          'flex size-9 items-center justify-center rounded-lg transition-colors duration-150 [&_svg]:size-[19px]',
          active ? 'bg-accent text-accent-ink' : 'text-icon hover:bg-hover hover:text-ink',
          className,
        )}
      >
        {children}
      </button>
    </Tip>
  );
});

function UnitBox() {
  const { t } = useTranslation();
  const unit = usePrefs((s) => s.unit);
  const setUnit = usePrefs((s) => s.setUnit);
  return (
    <FloatingBar className="absolute top-[264px] left-9 w-[50px] flex-col p-1">
      <Tip label={t('pattern.units')} side="right">
        <Segmented<Unit>
          label={t('pattern.units')}
          orientation="vertical"
          surface="outlined"
          size="sm"
          value={unit}
          onChange={setUnit}
          options={UNITS.map((u) => ({ value: u, label: u }))}
          className="border-0 bg-transparent p-0 [&_button]:h-7 [&_button]:w-10 [&_button]:px-0 [&_button]:text-xs [&_button]:font-[650] [&_button[aria-checked=true]]:bg-accent-soft [&_button[aria-checked=true]]:shadow-none"
        />
      </Tip>
    </FloatingBar>
  );
}

function ZoomBar() {
  const { t } = useTranslation();
  const zoom = useWorkspace((s) => s.view.zoom);
  const zoomBy = useWorkspace((s) => s.zoomBy);
  const markings = useLook((s) => s.scene.patternMarkings);
  const setScene = look.setScene;

  return (
    <FloatingBar className="absolute bottom-4 left-1/2 -translate-x-1/2">
      <IconButton
        label={t('pattern.zoomOut')}
        icon={<Minus />}
        onClick={() => zoomBy(-1)}
        className="[&_svg]:size-4"
      />
      <span className="w-[46px] text-center text-label tabular-nums" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton
        label={t('pattern.zoomIn')}
        icon={<Plus />}
        onClick={() => zoomBy(1)}
        className="[&_svg]:size-4"
      />
      <Button variant="ghost" size="sm" className="mx-2 text-ink" onClick={fit}>
        {t('pattern.fit')}
      </Button>
      <IconButton
        label={t('pattern.markings')}
        icon={<Grid3x3 />}
        aria-pressed={markings}
        onClick={() => setScene({ patternMarkings: !markings })}
        className={cn('[&_svg]:size-[17px]', markings && 'text-accent-fg')}
      />
    </FloatingBar>
  );
}
