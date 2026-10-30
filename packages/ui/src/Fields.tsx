import { useEffect, useId, useState, type ReactNode } from 'react';
import { Select as S, Slider as Sl, Switch as Sw } from 'radix-ui';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from './cn';

/* ───────────── Select (custom-styled dropdown) ───────────── */

export interface SelectOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  /** Rendered after the label in the list only (e.g. a tier badge). */
  hint?: ReactNode;
}

export function Select<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
  valueClassName,
  icon,
  disabled,
}: {
  value: V;
  onChange: (v: V) => void;
  options: readonly SelectOption<V>[];
  label: string;
  className?: string;
  /** Lets callers hide the value text responsively (icon-only trigger). */
  valueClassName?: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as V)} disabled={disabled ?? false}>
      <S.Trigger
        aria-label={label}
        className={cn(
          'inline-flex h-8 items-center justify-between gap-2 rounded-lg border border-line-strong bg-field pr-2 pl-2.5 text-[13px] text-ink',
          'hover:border-faint disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:text-muted',
          className,
        )}
      >
        {icon}
        <span className={cn('truncate', valueClassName)}>
          <S.Value />
        </span>
        <S.Icon asChild>
          <ChevronsUpDown />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-line-strong bg-panel text-[13px] text-ink shadow-panel"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled ?? false}
                className="relative flex h-8 cursor-default items-center gap-2 rounded-md pr-2 pl-7 outline-none select-none data-disabled:opacity-40 data-highlighted:bg-hover"
              >
                <S.ItemIndicator className="absolute left-2 text-accent-fg [&_svg]:size-3.5">
                  <Check />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="ml-auto">{o.hint}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/* ───────────── Switch ───────────── */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Sw.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled ?? false}
      className="relative h-[22px] w-[38px] shrink-0 rounded-[11px] bg-toggle-off transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-45"
    >
      <Sw.Thumb className="block size-[18px] translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  );
}

/** Label on the left, switch on the right (the "Fold shadows (AO)" row). */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-[26px] items-center justify-between gap-3">
      <span className="text-label">{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled ?? false} />
    </div>
  );
}

/* ───────────── Slider with value output ───────────── */

export function SliderRow({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  format = (v) => String(v),
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Fires once when the drag ends (history commit). */
  onCommit?: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[84px_1fr_42px] items-center gap-2.5">
      <span id={id} className="text-label">
        {label}
      </span>
      <Sl.Root
        aria-labelledby={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled ?? false}
        onValueChange={([v]) => v !== undefined && onChange(v)}
        onValueCommit={([v]) => v !== undefined && onCommit?.(v)}
        className="relative flex h-[18px] touch-none items-center select-none data-disabled:opacity-45"
      >
        <Sl.Track className="relative h-1 grow rounded-full bg-line-strong">
          <Sl.Range className="absolute h-full rounded-full bg-accent" />
        </Sl.Track>
        <Sl.Thumb
          aria-label={label}
          className="block size-3.5 rounded-full border-2 border-accent bg-panel shadow-[0_1px_2px_rgba(0,0,0,.25)]"
        />
      </Sl.Root>
      <output className="text-right text-[12.5px] text-muted tabular-nums">{format(value)}</output>
    </div>
  );
}

/* ───────────── Number field with suffix ───────────── */

/**
 * Text input that shows `display` and commits on Enter/blur through `onCommit`.
 * Parsing (units, ranges) belongs to the caller; return false to reject and revert.
 */
export function NumberField({
  label,
  display,
  suffix,
  onCommit,
  className,
  disabled,
}: {
  label: string;
  display: string;
  suffix?: string;
  onCommit: (raw: string) => boolean;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);

  function commit() {
    if (draft === display) return;
    if (!onCommit(draft)) setDraft(display);
  }

  return (
    <label
      className={cn(
        'flex h-8 items-center rounded-lg border border-line-strong bg-field pr-2 focus-within:border-accent',
        disabled && 'opacity-45',
        className,
      )}
    >
      <input
        aria-label={label}
        value={draft}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(display);
        }}
        className="h-full w-full min-w-0 bg-transparent pl-2.5 text-[13px] text-ink tabular-nums outline-none"
      />
      {suffix && <span className="text-xs text-faint">{suffix}</span>}
    </label>
  );
}

/** Label + control laid out across the inspector width ("Material  [Cotton ▾]"). */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-label">{label}</span>
      {children}
    </div>
  );
}
