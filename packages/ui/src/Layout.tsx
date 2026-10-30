import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Collapsible, Tabs as T } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

/** Inspector section: title, optional subtitle and header action, divider below. */
export function Section({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2.5 border-b border-line py-4', className)}>
      <div>
        <div className="flex min-h-[26px] items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-[650] tracking-[-0.07px] text-ink">{title}</h3>
          {action}
        </div>
        {subtitle && <p className="m-0 text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-line py-4">
      <Collapsible.Trigger className="flex w-full items-center justify-between text-sm font-[650] text-ink [&_svg]:size-4 [&_svg]:text-muted [&_svg]:transition-transform data-[state=open]:[&_svg]:rotate-180">
        {title}
        <ChevronDown />
      </Collapsible.Trigger>
      <Collapsible.Content className="flex flex-col gap-2.5 pt-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/* ───────────── Tabs (underlined, inspector header) ───────────── */

export function Tabs<V extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: V;
  onChange: (v: V) => void;
  tabs: readonly { value: V; label: ReactNode; content: ReactNode }[];
  label: string;
}) {
  return (
    <T.Root value={value} onValueChange={(v) => onChange(v as V)} className="flex min-h-0 flex-1 flex-col">
      <T.List aria-label={label} className="flex h-[53px] shrink-0 border-b border-line px-4">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="relative flex-1 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:text-accent-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((t) => (
        <T.Content
          key={t.value}
          value={t.value}
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 outline-none"
        >
          {t.content}
        </T.Content>
      ))}
    </T.Root>
  );
}

/* ───────────── Floating bars and glass ───────────── */

export function FloatingBar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-panel',
        className,
      )}
      {...rest}
    />
  );
}

export function Glass({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-glass-line bg-glass shadow-[0_4px_18px_rgba(16,24,40,.1)] backdrop-blur-[14px] backdrop-saturate-[1.2]',
        className,
      )}
      {...rest}
    />
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'warn';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-full px-1.5 text-[10px] font-semibold tracking-wide uppercase',
        tone === 'neutral' && 'bg-seg text-muted',
        tone === 'accent' && 'bg-accent-soft text-accent-fg',
        tone === 'success' && 'bg-success/15 text-success-fg',
        tone === 'warn' && 'bg-amber-500/15 text-warn-fg',
      )}
    >
      {children}
    </span>
  );
}

/** Honest placeholder for work scheduled in a later stage. */
export function StageNotice({ stage, children }: { stage: number; children: ReactNode }) {
  return (
    <p className="m-0 rounded-lg border border-dashed border-line-strong bg-panel/90 px-3 py-2 text-xs text-muted">
      <Badge tone="accent">Stage {stage}</Badge> <span className="ml-1">{children}</span>
    </p>
  );
}
