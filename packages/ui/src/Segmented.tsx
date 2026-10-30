import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentOption<V>[];
  label: string;
  size?: 'sm' | 'md';
  /** `accent` fills the active segment with the accent colour (Outside/Inside); `plain` raises it. */
  tone?: 'plain' | 'accent';
  /** `track` sits on the seg background; `outlined` on panel with a border. */
  surface?: 'track' | 'outlined';
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** A radio group styled as segmented buttons. Arrow keys move the selection. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  tone = 'plain',
  surface = 'track',
  orientation = 'horizontal',
  className,
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent) {
    const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const back = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    if (e.key !== forward && e.key !== back) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + (e.key === forward ? 1 : -1) + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex gap-0.5 rounded-[9px] p-0.5',
        orientation === 'vertical' && 'flex-col',
        surface === 'track' ? 'bg-seg' : 'border border-line bg-panel',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap transition-colors duration-150',
              'disabled:opacity-40 [&_svg]:size-4',
              size === 'sm' ? 'h-[26px] px-3 text-[12.5px]' : 'h-7 px-3.5 text-[13px]',
              !active && 'text-icon hover:text-ink',
              active && tone === 'plain' && 'bg-panel text-accent-fg shadow-seg',
              active && tone === 'accent' && 'bg-accent text-accent-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
