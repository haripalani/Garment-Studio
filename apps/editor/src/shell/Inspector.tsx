import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RotateCcw, Save, Undo2 } from 'lucide-react';
import {
  Button,
  CollapsibleSection,
  FieldRow,
  Section,
  Segmented,
  Select,
  SliderRow,
  Swatches,
  Tabs,
  ToggleRow,
} from '@gs/ui';
import { ArtworkSection, LayersSection, TransformSection } from '../pattern/LayerPanels';
import { look, useLook, type Gobo, type LabelShape, type Material } from '../store/look';
import { useWorkspace, type InspectorTab } from '../store/workspace';

export const FABRIC_COLOURS = [
  '#f2f0ea',
  '#ffffff',
  '#141516',
  '#26365a',
  '#4f6146',
  '#8c2f2f',
  '#c8b28c',
  '#9db4c8',
  '#e3a9b2',
  '#6e7072',
];
export const BACKDROP_COLOURS = [
  '#f4f3f0',
  '#ffffff',
  '#ece6dc',
  '#dacfbf',
  '#d2dbcf',
  '#cfd8e3',
  '#e2d3cf',
  '#a3a3a1',
  '#2a2b2e',
  '#d8682a',
  '#3d2c58',
  '#1d1c20',
  '#1f4a3a',
];
export const HANGER_COLOURS = ['#f4f4f2', '#2a2826', '#b58a5c', '#7a5236', '#9aa0a6', '#c8a24a'];
export const LABEL_COLOURS = ['#efe6d2', '#161616', '#ffffff'];

const MATERIALS: Material[] = [
  'cotton',
  'cotton-blend',
  'interlock',
  'sport-knit',
  'pique',
  'rib',
  'waffle',
  'fleece',
  'mesh',
];
const GOBOS: Gobo[] = [
  'none',
  'window',
  'blinds',
  'soft-blinds',
  'leaves',
  'palm',
  'branches',
  'stripes',
  'spotlight',
];
const LABELS: LabelShape[] = ['small-woven', 'wide', 'square', 'tall-satin', 'loop'];

const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);
const deg = (v: number) => `${Math.round(v)}°`;

export function Inspector() {
  const { t } = useTranslation();
  const tab = useWorkspace((s) => s.tab);
  const setTab = useWorkspace((s) => s.setTab);
  return (
    <aside
      aria-label={t('inspector.tabs')}
      className="flex w-80 shrink-0 flex-col border-l border-line bg-panel"
    >
      <Tabs<InspectorTab>
        label={t('inspector.tabs')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'design', label: t('inspector.design'), content: <DesignPane /> },
          { value: 'scene', label: t('inspector.scene'), content: <ScenePane /> },
        ]}
      />
    </aside>
  );
}

function DesignPane() {
  const { t } = useTranslation();
  const fabric = useLook((s) => s.fabric);
  const setFabric = look.setFabric;
  const light = useLook((s) => s.light);
  const setLight = look.setLight;

  return (
    <>
      <ArtworkSection />
      <TransformSection />
      <LayersSection />

      <Section title={t('design.fabric')}>
        <Swatches
          label={t('design.fabricColour')}
          colors={FABRIC_COLOURS}
          value={fabric.color}
          onChange={(color) => setFabric({ color })}
        />
        <FieldRow label={t('design.colour')}>
          <Segmented<'solid' | 'gradient'>
            label={t('design.colour')}
            size="sm"
            surface="outlined"
            value={fabric.mode}
            onChange={(mode) => setFabric({ mode })}
            options={[
              { value: 'solid', label: t('design.solid') },
              { value: 'gradient', label: t('design.gradient') },
            ]}
          />
        </FieldRow>
        {fabric.mode === 'gradient' && (
          <div className="flex flex-col gap-2">
            <div
              className="h-5 rounded-md border border-line"
              style={{ background: `linear-gradient(90deg, ${fabric.color}, ${fabric.gradientTo})` }}
            />
            <div className="flex justify-between text-xs text-muted">
              <span>{t('design.top')}</span>
              <span>{t('design.bottom')}</span>
            </div>
            <Swatches
              label={t('design.bottom')}
              colors={FABRIC_COLOURS}
              value={fabric.gradientTo}
              onChange={(gradientTo) => setFabric({ gradientTo })}
            />
          </div>
        )}
      </Section>

      <Section title={t('design.appearance')}>
        <FieldRow label={t('design.material')}>
          <Select<Material>
            label={t('design.material')}
            value={fabric.material}
            onChange={(material) => setFabric({ material })}
            options={MATERIALS.map((m) => ({ value: m, label: t(`design.materials.${m}`) }))}
            className="w-[150px]"
          />
        </FieldRow>
        <ToggleRow label={t('design.ao')} checked={fabric.ao} onChange={(ao) => setFabric({ ao })} />
        <ToggleRow
          label={t('design.wrinkles')}
          checked={fabric.wrinkles}
          onChange={(wrinkles) => setFabric({ wrinkles })}
        />
        <SliderRow
          label={t('design.wrinkleStrength')}
          value={fabric.wrinkleStrength}
          onChange={(wrinkleStrength) => setFabric({ wrinkleStrength })}
          min={0}
          max={1}
          step={0.05}
          format={f1}
          disabled={!fabric.wrinkles}
        />
        <SliderRow
          label={t('design.texture')}
          value={fabric.texture}
          onChange={(texture) => setFabric({ texture })}
          min={0}
          max={1}
          step={0.05}
          format={f1}
        />
        <SliderRow
          label={t('design.knit')}
          value={fabric.knitScale}
          onChange={(knitScale) => setFabric({ knitScale })}
          min={1}
          max={8}
          step={1}
          format={(v) => `×${v}`}
        />
        <SliderRow
          label={t('design.brightness')}
          value={fabric.brightness}
          onChange={(brightness) => setFabric({ brightness })}
          min={0.5}
          max={1.5}
          step={0.01}
          format={f2}
        />
        <SliderRow
          label={t('design.contrast')}
          value={fabric.contrast}
          onChange={(contrast) => setFabric({ contrast })}
          min={0.5}
          max={1.5}
          step={0.01}
          format={f2}
        />
      </Section>

      <CollapsibleSection title={t('design.keyLight')}>
        <SliderRow
          label={t('design.lightSide')}
          value={light.azimuthDeg}
          onChange={(azimuthDeg) => setLight({ azimuthDeg })}
          min={-180}
          max={180}
          step={1}
          format={deg}
        />
        <SliderRow
          label={t('design.lightHeight')}
          value={light.elevationDeg}
          onChange={(elevationDeg) => setLight({ elevationDeg })}
          min={0}
          max={90}
          step={1}
          format={deg}
        />
        <SliderRow
          label={t('design.lightPower')}
          value={light.power}
          onChange={(power) => setLight({ power })}
          min={0}
          max={6}
          step={0.1}
          format={f1}
        />
      </CollapsibleSection>

      <DefaultsCard />
    </>
  );
}

function ScenePane() {
  const { t } = useTranslation();
  const scene = useLook((s) => s.scene);
  const setScene = look.setScene;

  return (
    <>
      <Section title={t('scene.backdrop')} className="pt-4">
        <ToggleRow label={t('scene.hdri')} checked={scene.hdri} onChange={(hdri) => setScene({ hdri })} />
        <SliderRow
          label={t('scene.hdriIntensity')}
          value={scene.hdriIntensity}
          onChange={(hdriIntensity) => setScene({ hdriIntensity })}
          min={0}
          max={3}
          step={0.05}
          format={f2}
          disabled={!scene.hdri}
        />
        <SliderRow
          label={t('scene.hdriRotation')}
          value={scene.hdriRotationDeg}
          onChange={(hdriRotationDeg) => setScene({ hdriRotationDeg })}
          min={0}
          max={360}
          step={1}
          format={deg}
          disabled={!scene.hdri}
        />
        <ToggleRow
          label={t('scene.studioBackdrop')}
          checked={scene.backdrop}
          onChange={(backdrop) => setScene({ backdrop })}
        />
        <ToggleRow
          label={t('scene.backdropShadow')}
          checked={scene.backdropShadow}
          onChange={(backdropShadow) => setScene({ backdropShadow })}
          disabled={!scene.backdrop}
        />
        <Swatches
          label={t('scene.backdropColour')}
          colors={BACKDROP_COLOURS}
          value={scene.backdropColor}
          onChange={(backdropColor) => setScene({ backdropColor })}
        />
        <FieldRow label={t('scene.backdropLight')}>
          <Select<Gobo>
            label={t('scene.backdropLight')}
            value={scene.gobo}
            onChange={(gobo) => setScene({ gobo })}
            options={GOBOS.map((g) => ({ value: g, label: t(`scene.gobos.${g}`) }))}
            className="w-[150px]"
          />
        </FieldRow>
        <ToggleRow
          label={t('scene.invert')}
          checked={scene.goboInvert}
          onChange={(goboInvert) => setScene({ goboInvert })}
          disabled={scene.gobo === 'none'}
        />
        <SliderRow
          label={t('scene.backdropBrightness')}
          value={scene.backdropBrightness}
          onChange={(backdropBrightness) => setScene({ backdropBrightness })}
          min={0.5}
          max={1.5}
          step={0.01}
          format={f2}
        />
        <SliderRow
          label={t('scene.backdropContrast')}
          value={scene.backdropContrast}
          onChange={(backdropContrast) => setScene({ backdropContrast })}
          min={0.5}
          max={1.5}
          step={0.01}
          format={f2}
        />
      </Section>

      <Section title={t('scene.hanger')}>
        <ToggleRow
          label={t('scene.showHanger')}
          checked={scene.hanger}
          onChange={(hanger) => setScene({ hanger })}
        />
        <Swatches
          label={t('scene.hangerColour')}
          colors={HANGER_COLOURS}
          value={scene.hangerColor}
          onChange={(hangerColor) => setScene({ hangerColor })}
        />
      </Section>

      <Section title={t('scene.details')}>
        <ToggleRow
          label={t('scene.neckLabel')}
          checked={scene.neckLabel}
          onChange={(neckLabel) => setScene({ neckLabel })}
        />
        <FieldRow label={t('scene.labelShape')}>
          <Select<LabelShape>
            label={t('scene.labelShape')}
            value={scene.labelShape}
            onChange={(labelShape) => setScene({ labelShape })}
            options={LABELS.map((l) => ({ value: l, label: t(`scene.labels.${l}`) }))}
            className="w-[150px]"
            disabled={!scene.neckLabel}
          />
        </FieldRow>
        <Swatches
          label={t('scene.labelColour')}
          colors={LABEL_COLOURS}
          value={scene.labelColor}
          onChange={(labelColor) => setScene({ labelColor })}
        />
        <ToggleRow
          label={t('scene.autoRotate')}
          checked={scene.autoRotate}
          onChange={(autoRotate) => setScene({ autoRotate })}
        />
        <ToggleRow
          label={t('scene.markings')}
          checked={scene.patternMarkings}
          onChange={(patternMarkings) => setScene({ patternMarkings })}
        />
      </Section>

      <DefaultsCard />
    </>
  );
}

function DefaultsCard() {
  const { t } = useTranslation();
  const { saveAsDefault, resetToSaved, restoreFactory } = look;
  const [saved, setSaved] = useState(false);

  return (
    <div className="mt-4 flex flex-col gap-2.5 rounded-[14px] border border-line bg-panel p-3.5">
      <h4 className="m-0 text-sm font-[650]">{t('defaults.title')}</h4>
      <Button size="lg" icon={<Undo2 />} onClick={resetToSaved} className="rounded-[10px] font-semibold">
        {t('defaults.reset')}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            saveAsDefault();
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1600);
          }}
          className="flex flex-col items-center gap-1.5 rounded-[10px] border border-accent/30 bg-accent-soft px-2 py-2.5 text-xs font-semibold text-accent-fg [&_svg]:size-5"
        >
          {saved ? <Check /> : <Save />}
          {saved ? t('defaults.saved') : t('defaults.save')}
        </button>
        <button
          type="button"
          onClick={restoreFactory}
          className="flex flex-col items-center gap-1.5 rounded-[10px] border border-line bg-panel px-2 py-2.5 text-xs font-semibold text-ink hover:bg-hover [&_svg]:size-5"
        >
          <RotateCcw />
          {t('defaults.factory')}
        </button>
      </div>
    </div>
  );
}
