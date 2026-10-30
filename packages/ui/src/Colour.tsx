import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ArrowLeftRight, Pipette, Trash2 } from 'lucide-react';
import { cn } from './cn';
import { NumberField } from './Fields';
import { Segmented } from './Segmented';
import { SliderRow } from './Fields';
import { eyeDropperSupported, pickScreenColour } from './Swatches';

/** Colour swatch button (native picker) with an optional eyedropper. */
export function ColourField({
  label,
  value,
  onChange,
  eyedropLabel = 'Pick a colour from the screen',
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  eyedropLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <label
        title={label}
        className="relative block h-8 w-11 cursor-pointer overflow-hidden rounded-lg border border-line-strong"
        style={{ background: value }}
      >
        <span className="sr-only">{label}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      {eyeDropperSupported() && (
        <button
          type="button"
          aria-label={eyedropLabel}
          title={eyedropLabel}
          onClick={async () => {
            const hex = await pickScreenColour();
            if (hex) onChange(hex);
          }}
          className="flex size-8 items-center justify-center rounded-lg border border-line-strong text-icon hover:bg-hover hover:text-ink [&_svg]:size-4"
        >
          <Pipette />
        </button>
      )}
    </span>
  );
}

export interface GradientStopValue {
  at: number;
  color: string;
  alpha: number;
}

export interface GradientValue {
  kind: 'linear' | 'radial';
  angleDeg: number;
  stops: GradientStopValue[];
}

const MAX_STOPS = 5;
const REMOVE_DISTANCE = 28;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function cssStops(stops: readonly GradientStopValue[]): string {
  return [...stops]
    .sort((a, b) => a.at - b.at)
    .map((s) => {
      const [r, g, b] = hexToRgb(s.color);
      return `rgba(${r},${g},${b},${s.alpha}) ${(s.at * 100).toFixed(1)}%`;
    })
    .join(', ');
}

/** Colour at position t, interpolated from the stops (for new stops). */
function sampleAt(stops: readonly GradientStopValue[], t: number): GradientStopValue {
  const s = [...stops].sort((a, b) => a.at - b.at);
  const first = s[0]!;
  const last = s[s.length - 1]!;
  if (t <= first.at) return { ...first, at: t };
  if (t >= last.at) return { ...last, at: t };
  const i = s.findIndex((x) => x.at >= t);
  const a = s[i - 1]!;
  const b = s[i]!;
  const k = (t - a.at) / Math.max(1e-6, b.at - a.at);
  const ca = hexToRgb(a.color);
  const cb = hexToRgb(b.color);
  return {
    at: t,
    color: rgbToHex(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k),
    alpha: a.alpha + (b.alpha - a.alpha) * k,
  };
}

/**
 * Gradient editor: click under the bar to add a stop (max 5), drag a marker to move it,
 * drag it away from the bar to remove it. `onChange(value, done)` — `done` marks the end of a gesture.
 */
export function GradientEditor({
  value,
  onChange,
  labels = {},
}: {
  value: GradientValue;
  onChange: (v: GradientValue, done: boolean) => void;
  labels?: Partial<
    Record<'linear' | 'radial' | 'angle' | 'colour' | 'opacity' | 'remove' | 'swap' | 'hint', string>
  >;
}) {
  const [sel, setSel] = useState(0);
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startY: number; removing: boolean } | null>(null);
  const L = {
    linear: 'Linear',
    radial: 'Radial',
    angle: 'Angle',
    colour: 'Colour of this stop',
    opacity: 'Opacity',
    remove: 'Remove this colour',
    swap: 'Swap colours',
    hint: 'Click under the bar to add a colour (up to 5). Drag a marker away from the bar to remove it.',
    ...labels,
  };
  const stops = value.stops;
  const current = stops[Math.min(sel, stops.length - 1)]!;

  const setStops = (next: GradientStopValue[], done: boolean) => onChange({ ...value, stops: next }, done);
  const posFromEvent = (clientX: number) => {
    const r = lane.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  function onLaneDown(e: RPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).dataset.stop !== undefined || stops.length >= MAX_STOPS) return;
    const t = posFromEvent(e.clientX);
    const next = [...stops, sampleAt(stops, t)];
    setSel(next.length - 1);
    setStops(next, true);
  }

  function onStopDown(e: RPointerEvent<HTMLButtonElement>, index: number) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSel(index);
    drag.current = { index, startY: e.clientY, removing: false };
  }

  function onStopMove(e: RPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    d.removing = stops.length > 2 && Math.abs(e.clientY - d.startY) > REMOVE_DISTANCE;
    const next = stops.map((s, i) => (i === d.index ? { ...s, at: posFromEvent(e.clientX) } : s));
    setStops(next, false);
  }

  function onStopUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.removing) {
      setSel(0);
      setStops(
        stops.filter((_, i) => i !== d.index),
        true,
      );
    } else setStops(stops, true);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="h-6 rounded-md border border-line"
        style={{
          background: `linear-gradient(90deg, ${cssStops(stops)}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 10px 10px`,
        }}
      />
      <div
        ref={lane}
        onPointerDown={onLaneDown}
        className="relative -mt-1.5 h-5 cursor-copy"
        aria-hidden={false}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            data-stop={i}
            aria-label={`${L.colour} ${i + 1}: ${s.color}, ${Math.round(s.alpha * 100)}%`}
            aria-pressed={i === sel}
            onPointerDown={(e) => onStopDown(e, i)}
            onPointerMove={onStopMove}
            onPointerUp={onStopUp}
            onClick={() => setSel(i)}
            className={cn(
              'absolute top-0 h-4 w-3 -translate-x-1/2 cursor-ew-resize rounded-[3px] border-2 shadow',
              i === sel ? 'border-accent' : 'border-white',
              drag.current?.index === i && drag.current.removing && 'opacity-30',
            )}
            style={{ left: `${s.at * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <ColourField
          label={L.colour}
          value={current.color}
          onChange={(color) =>
            setStops(
              stops.map((s, i) => (i === sel ? { ...s, color } : s)),
              true,
            )
          }
        />
        <NumberField
          label={L.opacity}
          display={String(Math.round(current.alpha * 100))}
          suffix="%"
          className="w-[72px]"
          onCommit={(raw) => {
            const v = Number(raw);
            if (!Number.isFinite(v)) return false;
            setStops(
              stops.map((s, i) => (i === sel ? { ...s, alpha: Math.min(1, Math.max(0, v / 100)) } : s)),
              true,
            );
            return true;
          }}
        />
        <button
          type="button"
          aria-label={L.remove}
          title={L.remove}
          disabled={stops.length <= 2}
          onClick={() => {
            setStops(
              stops.filter((_, i) => i !== sel),
              true,
            );
            setSel(0);
          }}
          className="flex size-8 items-center justify-center rounded-lg text-icon hover:bg-hover disabled:opacity-35 [&_svg]:size-4"
        >
          <Trash2 />
        </button>
        <button
          type="button"
          aria-label={L.swap}
          title={L.swap}
          onClick={() =>
            setStops(
              stops.map((s) => ({ ...s, at: 1 - s.at })),
              true,
            )
          }
          className="flex size-8 items-center justify-center rounded-lg text-icon hover:bg-hover [&_svg]:size-4"
        >
          <ArrowLeftRight />
        </button>
      </div>
      <p className="m-0 text-[11.5px] text-muted">{L.hint}</p>
      <Segmented<'linear' | 'radial'>
        label={L.linear}
        size="sm"
        surface="outlined"
        className="grid grid-cols-2"
        value={value.kind}
        onChange={(kind) => onChange({ ...value, kind }, true)}
        options={[
          { value: 'linear', label: L.linear },
          { value: 'radial', label: L.radial },
        ]}
      />
      {value.kind === 'linear' && (
        <SliderRow
          label={L.angle}
          value={value.angleDeg}
          min={0}
          max={360}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(angleDeg) => onChange({ ...value, angleDeg }, false)}
          onCommit={(angleDeg) => onChange({ ...value, angleDeg }, true)}
        />
      )}
    </div>
  );
}
