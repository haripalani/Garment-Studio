import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@gs/ui';
import { usePrefs } from '../store/prefs';
import { useWorkspace } from '../store/workspace';

export const TOUR_STEPS = ['artwork', 'pattern', 'viewer', 'quality', 'garment', 'export'] as const;

const CARD_W = 300;
const GAP = 12;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function cardPosition(target: Box, cardH: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Prefer below, then left, then right; clamp inside the viewport.
  let top = target.top + target.height + GAP;
  let left = target.left + target.width / 2 - CARD_W / 2;
  if (top + cardH > vh - GAP) {
    top = target.top + target.height / 2 - cardH / 2;
    left = target.left - CARD_W - GAP;
    if (left < GAP) left = target.left + target.width + GAP;
  }
  return {
    top: Math.min(Math.max(GAP, top), vh - cardH - GAP),
    left: Math.min(Math.max(GAP, left), vw - CARD_W - GAP),
  };
}

export function Tour() {
  const { t } = useTranslation();
  const step = useWorkspace((s) => s.tourStep);
  const setStep = useWorkspace((s) => s.setTourStep);
  const setTab = useWorkspace((s) => s.setTab);
  const setViewMode = usePrefs((s) => s.setViewMode);
  const tourDone = usePrefs((s) => s.tourDone);
  const setTourDone = usePrefs((s) => s.setTourDone);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(170);
  const cardRef = useRef<HTMLDivElement>(null);

  // First visit: run once.
  useEffect(() => {
    if (!tourDone) setStep(0);
  }, [tourDone, setStep]);

  // Every target must be visible: the design tab and split view.
  useEffect(() => {
    if (step === null) return;
    setTab('design');
    setViewMode('split');
  }, [step, setTab, setViewMode]);

  useLayoutEffect(() => {
    if (step === null) return;
    const id = TOUR_STEPS[step];
    const measure = () => {
      const el = document.querySelector(`[data-tour="${id}"]`);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
      if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useEffect(() => {
    if (step !== null) cardRef.current?.focus();
  }, [step]);

  if (step === null) return null;
  const id = TOUR_STEPS[step]!;
  const last = step === TOUR_STEPS.length - 1;

  const finish = () => {
    setStep(null);
    setTourDone(true);
  };

  const pad = 6;
  const pos = box
    ? cardPosition(box, cardH)
    : { top: window.innerHeight / 2 - cardH / 2, left: window.innerWidth / 2 - CARD_W / 2 };

  return (
    <div className="fixed inset-0 z-40" onKeyDown={(e) => e.key === 'Escape' && finish()}>
      {box && (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent transition-all duration-300"
          style={{
            top: box.top - pad,
            left: box.left - pad,
            width: box.width + pad * 2,
            height: box.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,.5)',
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="fixed rounded-xl border border-line-strong bg-panel p-4 text-ink shadow-panel outline-none transition-[top,left] duration-300"
        style={{ width: CARD_W, top: pos.top, left: pos.left }}
      >
        <p className="m-0 text-xs font-semibold text-accent-fg">
          {t('tour.of', { n: step + 1, total: TOUR_STEPS.length })}
        </p>
        <h3 id="tour-title" className="mt-1 mb-1.5 text-[15px] font-[650]">
          {t(`tour.steps.${id}.title`)}
        </h3>
        <p className="m-0 text-[13px] text-muted">{t(`tour.steps.${id}.body`)}</p>
        <div className="mt-4 flex items-center gap-2">
          <span className="mr-auto flex gap-1" aria-hidden>
            {TOUR_STEPS.map((s, i) => (
              <span
                key={s}
                className={cn('h-1.5 rounded-full bg-line-strong', i === step ? 'w-4 bg-accent' : 'w-1.5')}
              />
            ))}
          </span>
          {!last && (
            <Button variant="ghost" size="sm" onClick={finish}>
              {t('tour.skip')}
            </Button>
          )}
          {step > 0 && (
            <Button size="sm" onClick={() => setStep(step - 1)}>
              {t('tour.back')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? t('tour.done') : t('tour.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
