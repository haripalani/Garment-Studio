import { useTranslation } from 'react-i18next';
import type { Paint } from '@gs/core';
import { ColourField, FieldRow, GradientEditor, Segmented } from '@gs/ui';

function lighten(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.6);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Solid colour or gradient for text and shapes. `done` marks the end of a gesture (history). */
export function PaintEditor({
  paint,
  onChange,
}: {
  paint: Paint;
  onChange: (p: Paint, done: boolean) => void;
}) {
  const { t } = useTranslation();
  const first = paint.kind === 'solid' ? paint.color : (paint.stops[0]?.color ?? '#ffffff');
  return (
    <div className="flex flex-col gap-2.5">
      <FieldRow label={t('item.colour')}>
        <Segmented<'solid' | 'gradient'>
          label={t('item.colour')}
          size="sm"
          surface="outlined"
          value={paint.kind === 'solid' ? 'solid' : 'gradient'}
          onChange={(m) =>
            onChange(
              m === 'solid'
                ? { kind: 'solid', color: first }
                : {
                    kind: 'linear',
                    angleDeg: 90,
                    stops: [
                      { at: 0, color: first, alpha: 1 },
                      { at: 1, color: lighten(first === '#ffffff' ? '#4a5fd1' : first), alpha: 1 },
                    ],
                  },
              true,
            )
          }
          options={[
            { value: 'solid', label: t('design.solid') },
            { value: 'gradient', label: t('design.gradient') },
          ]}
        />
      </FieldRow>
      {paint.kind === 'solid' && (
        <ColourField
          label={t('item.colour')}
          value={paint.color}
          onChange={(color) => onChange({ kind: 'solid', color }, true)}
        />
      )}
      {paint.kind !== 'solid' && (
        <GradientEditor
          value={{ kind: paint.kind, angleDeg: paint.angleDeg, stops: paint.stops }}
          onChange={(v, done) => onChange({ kind: v.kind, angleDeg: v.angleDeg, stops: v.stops }, done)}
          labels={{
            linear: t('item.linear'),
            radial: t('item.radial'),
            angle: t('item.angle'),
            colour: t('item.stopColour'),
            opacity: t('item.opacity'),
            remove: t('item.removeStop'),
            swap: t('item.swap'),
            hint: t('item.gradientHint'),
          }}
        />
      )}
    </div>
  );
}
