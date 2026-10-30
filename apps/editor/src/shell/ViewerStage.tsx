import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Gauge, LayoutGrid, List, RotateCcw, Search, Shirt, Tag } from 'lucide-react';
import {
  Badge,
  Button,
  FloatingBar,
  Glass,
  IconButton,
  Popover,
  Segmented,
  Select,
  StageNotice,
  Tip,
  cn,
} from '@gs/ui';
import { useDoc } from '../store/doc';
import { look, useLook } from '../store/look';
import { useWorkspace, type CameraPreset, type Quality } from '../store/workspace';
// three.js is loaded only when the 3D view is shown (own chunk).
const ViewerCanvas = lazy(() => import('../viewer/ViewerCanvas').then((m) => ({ default: m.ViewerCanvas })));
import { StageHeader } from './StageHeader';

export function ViewerStage() {
  const { t } = useTranslation();
  const quality = useWorkspace((s) => s.quality);
  const setQuality = useWorkspace((s) => s.setQuality);
  const camera = useWorkspace((s) => s.camera);
  const setCamera = useWorkspace((s) => s.setCamera);

  return (
    <section
      data-tour="viewer"
      aria-label={t('viewer.title')}
      className="@container/viewer flex min-w-0 flex-1 flex-col border-l border-line bg-panel"
    >
      <StageHeader title={t('viewer.title')}>
        <Tip label={t('viewer.quality')}>
          <span data-tour="quality">
            <Select<Quality>
              label={t('viewer.quality')}
              value={quality}
              onChange={setQuality}
              icon={<Gauge />}
              className="w-[132px] border-transparent bg-transparent @max-[480px]/viewer:w-auto"
              valueClassName="@max-[480px]/viewer:hidden"
              options={(['adaptive', 'full', 'half', 'quarter'] as const).map((q) => ({
                value: q,
                label: t(`viewer.${q}`),
              }))}
            />
          </span>
        </Tip>
        <Segmented<CameraPreset>
          label={t('viewer.camera')}
          size="sm"
          surface="outlined"
          value={camera}
          onChange={setCamera}
          options={(['front', 'back', 'side'] as const).map((c) => ({ value: c, label: t(`viewer.${c}`) }))}
        />
      </StageHeader>

      <div className="relative min-h-0 flex-1 overflow-hidden border-t border-line bg-stage">
        <Suspense fallback={null}>
          <ViewerCanvas />
        </Suspense>
        <GarmentPicker />
        <span className="pointer-events-none absolute bottom-5 left-4 flex items-center gap-2 rounded-full bg-glass px-2.5 py-1 text-xs text-icon backdrop-blur">
          <i className="size-[7px] rounded-full bg-success shadow-[0_0_0_3px_rgba(52,168,83,.15)]" />
          {t('viewer.live')}
        </span>
        <ViewBar />
      </div>
    </section>
  );
}

type Category = 'all' | 'tees' | 'polo' | 'hoodies';

function GarmentPicker() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.garmentPanelOpen);
  const setOpen = useWorkspace((s) => s.setGarmentPanelOpen);
  const garment = useDoc((s) => s.garment);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  // Until the catalogue (GET /garments) has real models, the development tee is the only one.
  const models = [garment];
  const name = (g: typeof garment) => g.name.en ?? g.id;
  const shown = models.filter(
    (m) =>
      name(m).toLowerCase().includes(query.toLowerCase()) &&
      (category === 'all' || (category === 'tees' && m.category === 'tee')),
  );

  return (
    <div className="absolute top-3 right-3 z-10" data-tour="garment">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        className="w-[400px] p-3"
        trigger={
          <button type="button" aria-expanded={open} aria-haspopup="dialog">
            <Glass className="flex items-center gap-3 py-1.5 pr-3.5 pl-1.5 text-left">
              <span className="flex size-10 items-center justify-center rounded-[11px] bg-accent/15 text-accent-fg [&_svg]:size-[22px]">
                <Shirt />
              </span>
              <span className="flex flex-col leading-tight">
                <b className="text-[15px] tracking-[0.45px] text-accent-fg uppercase">{name(garment)}</b>
                <small className="text-[12.5px] text-muted">{garment.cut.en}</small>
              </span>
              <ChevronDown className={cn('ml-3 size-4 text-muted transition-transform', open && 'rotate-180')} />
            </Glass>
          </button>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="m-0 text-base font-[650] text-accent-fg">{t('garments.title')}</h3>
          <span className="rounded-full bg-seg px-2 text-xs text-muted">{models.length}</span>
          <Segmented<'grid' | 'list'>
            label={t('garments.title')}
            size="sm"
            surface="outlined"
            className="ml-auto"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'grid', label: <LayoutGrid />, ariaLabel: t('garments.grid') },
              { value: 'list', label: <List />, ariaLabel: t('garments.list') },
            ]}
          />
        </div>
        <label className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-field px-2.5 text-muted focus-within:border-accent [&_svg]:size-4">
          <Search />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('garments.search')}
            aria-label={t('garments.search')}
            className="h-full flex-1 bg-transparent text-[13px] text-ink outline-none"
          />
        </label>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(['all', 'tees', 'polo', 'hoodies'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                'h-7 rounded-full border px-3 text-[12.5px] font-medium',
                category === c ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-ink hover:bg-hover',
              )}
            >
              {t(`garments.${c}`)}
            </button>
          ))}
        </div>
        <ul className={cn('m-0 list-none p-0', layout === 'grid' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-1.5')}>
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={m.id === garment.id}
                className="relative flex w-full flex-col items-start gap-0.5 rounded-xl border border-accent bg-accent-soft p-3 text-left"
              >
                <span className="absolute top-2 right-2 flex items-center gap-1">
                  {m.dev && <Badge tone="warn">{t('garments.dev')}</Badge>}
                  <Check className="size-4 text-accent-fg" />
                </span>
                <Shirt className="mb-2 size-10 text-accent-fg" />
                <b className="text-[13px] text-ink uppercase">{name(m)}</b>
                <small className="text-[11.5px] text-muted uppercase">{m.cut.en}</small>
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="m-0 text-xs text-muted">{t('garments.noMatch')}</p>}
        <div className="mt-3">
          <StageNotice stage={5}>{t('garments.catalogueNote')}</StageNotice>
        </div>
        <p className="mt-3 mb-0 text-xs text-muted">{t('garments.count', { count: shown.length })}</p>
      </Popover>
    </div>
  );
}

function ViewBar() {
  const { t } = useTranslation();
  const scene = useLook((s) => s.scene);
  const setScene = look.setScene;
  const resetView = useWorkspace((s) => s.resetView);

  return (
    <FloatingBar className="absolute bottom-4 left-1/2 -translate-x-1/2">
      <IconButton
        label={t('viewer.autoRotate')}
        icon={<RotateCcw />}
        aria-pressed={scene.autoRotate}
        className={cn(scene.autoRotate && 'text-accent-fg')}
        onClick={() => setScene({ autoRotate: !scene.autoRotate })}
      />
      <Button variant="ghost" className="text-ink" onClick={resetView}>
        {t('viewer.reset')}
      </Button>
      <IconButton
        label={t('viewer.neckLabel')}
        icon={<Tag />}
        aria-pressed={scene.neckLabel}
        className={cn(scene.neckLabel && 'bg-accent-soft text-accent-fg')}
        onClick={() => setScene({ neckLabel: !scene.neckLabel })}
      />
      <IconButton
        label={t('viewer.hanger')}
        icon={<HangerIcon />}
        aria-pressed={scene.hanger}
        className={cn(scene.hanger && 'bg-accent-soft text-accent-fg')}
        onClick={() => setScene({ hanger: !scene.hanger })}
      />
    </FloatingBar>
  );
}

function HangerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 7.5a2 2 0 1 1 2-2" />
      <path d="M12 7.5v1.2L3 15a1.3 1.3 0 0 0 .8 2.4h16.4A1.3 1.3 0 0 0 21 15l-9-6.3" />
    </svg>
  );
}
