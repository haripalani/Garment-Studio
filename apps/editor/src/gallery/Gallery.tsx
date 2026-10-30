import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Copy,
  FlipHorizontal,
  Image as ImageIcon,
  Plus,
  Trash2,
  Type,
} from 'lucide-react';
import {
  Badge,
  Button,
  CollapsibleSection,
  FieldRow,
  FloatingBar,
  Glass,
  IconButton,
  Menu,
  Modal,
  NumberField,
  Section,
  Segmented,
  Select,
  SliderRow,
  SplitChevron,
  StageNotice,
  Swatches,
  ToggleRow,
} from '@gs/ui';
import { formatLength, parseLength, UNITS, type Unit } from '@gs/core';
import { usePrefs } from '../store/prefs';
import { FABRIC_COLOURS } from '../shell/Inspector';

/** Living design-system reference (Stage 3 deliverable). Every component in every state, both themes. */
export function Gallery() {
  const { t } = useTranslation();
  const { theme, setTheme } = usePrefs();
  return (
    <div className="h-full overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-line bg-panel px-5">
        <Link to="/" className="flex items-center gap-1.5 text-accent-fg hover:underline [&_svg]:size-4">
          <ArrowLeft /> {t('gallery.back')}
        </Link>
        <h1 className="m-0 text-base font-[650]">{t('gallery.title')}</h1>
        <div className="ml-auto">
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1200px] grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5 p-5">
        <Tokens />
        <Buttons />
        <Segments />
        <FieldsDemo />
        <SwatchDemo />
        <SectionsDemo />
        <OverlaysDemo />
        <SelectedItemPreview />
        <FloatingDemo />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel p-4">
      <h2 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </div>
  );
}

const TOKENS = [
  'bg',
  'panel',
  'ink',
  'muted',
  'faint',
  'line',
  'line-strong',
  'field',
  'hover',
  'accent',
  'accent-hover',
  'accent-soft',
  'danger',
  'success',
  'mat-bg',
  'dot',
  'stage',
  'seg-bg',
  'icon',
  'label',
];

function Tokens() {
  return (
    <Card title="Colour tokens">
      <div className="grid grid-cols-4 gap-2">
        {TOKENS.map((k) => (
          <div key={k} className="flex flex-col gap-1">
            <span className="h-9 rounded-md border border-line" style={{ background: `var(--${k})` }} />
            <code className="truncate text-[10.5px] text-muted">--{k}</code>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Buttons() {
  return (
    <Card title="Buttons">
      <div className="flex flex-wrap gap-2">
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="soft">Soft</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm">Small</Button>
        <Button size="lg" variant="primary" icon={<ImageIcon />}>
          Image
        </Button>
        <IconButton label="Add" icon={<Plus />} />
        <IconButton label="Add (default)" variant="default" icon={<Plus />} />
        <div className="flex">
          <Button variant="primary" className="rounded-r-none">
            Export
          </Button>
          <Menu
            trigger={<SplitChevron label="More exports" />}
            items={[
              { id: 'a', label: 'Catalogue render', description: 'Path-traced pictures' },
              { id: 'b', label: 'Print files (ZIP)', description: 'Disabled state', disabled: true },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}

function Segments() {
  const [a, setA] = useState<'pattern' | 'split' | '3d'>('split');
  const [b, setB] = useState<'outside' | 'inside'>('outside');
  const [c, setC] = useState<'front' | 'back' | 'side'>('front');
  const [u, setU] = useState<Unit>('cm');
  return (
    <Card title="Segmented controls">
      <Segmented
        label="View"
        value={a}
        onChange={setA}
        options={[
          { value: 'pattern', label: 'Sewing pattern' },
          { value: 'split', label: 'Split' },
          { value: '3d', label: '3D' },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Segmented
          label="Side"
          size="sm"
          tone="accent"
          surface="outlined"
          value={b}
          onChange={setB}
          options={[
            { value: 'outside', label: 'Outside' },
            { value: 'inside', label: 'Inside' },
          ]}
        />
        <Segmented
          label="Camera"
          size="sm"
          surface="outlined"
          value={c}
          onChange={setC}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'back', label: 'Back' },
            { value: 'side', label: 'Side' },
          ]}
        />
      </div>
      <Segmented
        label="Units"
        orientation="vertical"
        size="sm"
        surface="outlined"
        value={u}
        onChange={setU}
        options={UNITS.map((x) => ({ value: x, label: x }))}
        className="w-fit"
      />
    </Card>
  );
}

function FieldsDemo() {
  const unit = usePrefs((s) => s.unit);
  const [widthMm, setWidthMm] = useState(130);
  const [mat, setMat] = useState('cotton');
  const [on, setOn] = useState(true);
  const [v, setV] = useState(0.5);
  return (
    <Card title="Fields">
      <FieldRow label="Material">
        <Select
          label="Material"
          value={mat}
          onChange={setMat}
          className="w-[150px]"
          options={[
            { value: 'cotton', label: 'Cotton' },
            { value: 'pique', label: 'Piqué' },
            { value: 'fleece', label: 'Fleece', disabled: true },
          ]}
        />
      </FieldRow>
      <ToggleRow label="Fold shadows (AO)" checked={on} onChange={setOn} />
      <ToggleRow label="Disabled toggle" checked={false} onChange={() => {}} disabled />
      <SliderRow
        label="Wrinkles"
        value={v}
        onChange={setV}
        min={0}
        max={1}
        step={0.05}
        format={(x) => x.toFixed(1)}
      />
      <SliderRow label="Disabled" value={0.3} onChange={() => {}} min={0} max={1} step={0.1} disabled />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width"
          display={formatLength(widthMm, unit, false)}
          suffix={unit}
          onCommit={(raw) => {
            const mm = parseLength(raw, unit);
            if (mm === null || mm <= 0) return false;
            setWidthMm(mm);
            return true;
          }}
        />
        <NumberField label="Rotation" display="0" suffix="°" onCommit={() => true} />
      </div>
      <p className="m-0 text-xs text-muted">
        Width is stored as {widthMm.toFixed(1)} mm and shown in the current unit ({unit}).
      </p>
    </Card>
  );
}

function SwatchDemo() {
  const [c, setC] = useState(FABRIC_COLOURS[0]!);
  return (
    <Card title="Swatches">
      <Swatches label="Fabric colour" colors={FABRIC_COLOURS} value={c} onChange={setC} />
      <code className="text-xs text-muted">{c}</code>
    </Card>
  );
}

function SectionsDemo() {
  return (
    <Card title="Sections">
      <div className="rounded-lg border border-line px-4">
        <Section title="Artwork" subtitle="Add an image or text">
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="primary" icon={<ImageIcon />}>
              Image
            </Button>
            <Button size="lg" variant="primary" icon={<Type />}>
              Text
            </Button>
          </div>
        </Section>
        <CollapsibleSection title="Key light">
          <SliderRow label="Power" value={3} onChange={() => {}} min={0} max={6} step={0.1} />
        </CollapsibleSection>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge>Free</Badge>
        <Badge tone="accent">Pro</Badge>
        <Badge tone="success">Live</Badge>
        <Badge tone="warn">Beta</Badge>
      </div>
      <StageNotice stage={4}>Stage placeholders look like this.</StageNotice>
    </Card>
  );
}

function OverlaysDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Overlays">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Menu
          align="start"
          trigger={<Button>Open menu</Button>}
          items={[
            { id: '1', label: 'First item', description: 'With a description' },
            { id: '2', label: 'Second item' },
          ]}
        />
      </div>
      <Modal open={open} onOpenChange={setOpen} title="Modal title" description="Optional description">
        <p className="m-0 text-[13px] text-muted">Focus is trapped; Escape closes.</p>
      </Modal>
    </Card>
  );
}

/** The floating "Selected item" panel; wired to real layers in Stage 4. */
function SelectedItemPreview() {
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('center');
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  return (
    <Card title="Selected item panel (preview)">
      <div className="flex flex-col gap-3 rounded-xl border border-glass-line bg-glass-strong p-3 shadow-panel">
        <h3 className="m-0 text-[13px] font-semibold">Selected item</h3>
        <div className="grid grid-cols-4 gap-1.5">
          <Button size="sm" icon={<FlipHorizontal />}>
            Mirror
          </Button>
          <Button size="sm">Invert</Button>
          <Button size="sm" icon={<Copy />}>
            Copy
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 />} aria-label="Delete" />
        </div>
        <FieldRow label="Paragraph">
          <Segmented
            label="Paragraph"
            size="sm"
            surface="outlined"
            value={align}
            onChange={setAlign}
            options={[
              { value: 'left', label: <AlignLeft />, ariaLabel: 'Align left' },
              { value: 'center', label: <AlignCenter />, ariaLabel: 'Centre' },
              { value: 'right', label: <AlignRight />, ariaLabel: 'Align right' },
            ]}
          />
        </FieldRow>
        <SliderRow
          label="Hue"
          value={hue}
          onChange={setHue}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${v}°`}
        />
        <SliderRow
          label="Saturation"
          value={sat}
          onChange={setSat}
          min={0}
          max={2}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="grid grid-cols-2 gap-1.5">
          {['Chest', 'Left chest logo', 'Front bottom', 'Back', 'Back neck', 'Right sleeve'].map((p) => (
            <Button key={p} size="sm">
              {p}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function FloatingDemo() {
  return (
    <Card title="Floating bars and glass">
      <div
        className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg bg-mat p-4"
        style={{
          backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <FloatingBar>
          <IconButton label="Zoom out" icon={<span className="text-base">−</span>} />
          <span className="w-[46px] text-center tabular-nums">100%</span>
          <IconButton label="Zoom in" icon={<Plus />} />
        </FloatingBar>
        <Glass className="px-4 py-2 text-[13px]">Glass surface</Glass>
      </div>
    </Card>
  );
}
