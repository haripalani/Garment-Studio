import { Pipette } from 'lucide-react';
import { cn } from './cn';

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

export function eyeDropperSupported(): boolean {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

/** Opens the native EyeDropper; resolves null if unsupported or cancelled. */
export async function pickScreenColour(): Promise<string | null> {
  if (!eyeDropperSupported()) return null;
  const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
  try {
    return (await new Ctor().open()).sRGBHex;
  } catch {
    return null;
  }
}

export function Swatches({
  colors,
  value,
  onChange,
  label,
  customLabel = 'Custom colour',
  eyedropLabel = 'Pick a colour from the screen',
}: {
  colors: readonly string[];
  value: string;
  onChange: (hex: string) => void;
  label: string;
  customLabel?: string;
  eyedropLabel?: string;
}) {
  const isCustom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            title={c}
            onClick={() => onChange(c)}
            style={{ background: c }}
            className={cn(
              'size-7 rounded-full border border-black/12 transition-shadow duration-150',
              selected && 'ring-2 ring-accent ring-offset-2 ring-offset-panel',
            )}
          />
        );
      })}
      <label
        title={customLabel}
        className={cn(
          'relative size-7 cursor-pointer overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]',
          'bg-[conic-gradient(#ff4d4d,#ffc84d,#8be04d,#4de0c8,#4d8bff,#b04dff,#ff4d4d)]',
          isCustom && 'ring-2 ring-accent ring-offset-2 ring-offset-panel',
        )}
      >
        <span className="sr-only">{customLabel}</span>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
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
          className="flex size-7 items-center justify-center rounded-lg border border-dashed border-line-strong bg-panel text-icon hover:text-ink [&_svg]:size-4"
        >
          <Pipette />
        </button>
      )}
    </div>
  );
}
