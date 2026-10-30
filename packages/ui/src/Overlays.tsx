import type { ReactElement, ReactNode } from 'react';
import { Dialog as D, DropdownMenu as M, Popover as P } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from './cn';

/* ───────────── Modal dialog ───────────── */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 440,
  closeLabel = 'Close',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  width?: number;
  closeLabel?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
        <D.Content
          style={{ width }}
          className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-panel p-5 text-ink shadow-panel outline-none"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="m-0 text-base font-[650]">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 mb-0 text-xs text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close
              aria-label={closeLabel}
              className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink [&_svg]:size-4"
            >
              <X />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ───────────── Menu ───────────── */

export interface MenuItemDef {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'end',
  width = 300,
}: {
  trigger: ReactElement;
  items: readonly MenuItemDef[];
  align?: 'start' | 'end';
  width?: number;
}) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={6}
          style={{ width }}
          className="z-50 rounded-xl border border-line-strong bg-panel p-1.5 text-ink shadow-panel"
        >
          {items.map((it) => (
            <M.Item
              key={it.id}
              disabled={it.disabled ?? false}
              onSelect={it.onSelect}
              className="flex cursor-default gap-2.5 rounded-lg p-2 outline-none data-disabled:opacity-45 data-highlighted:bg-hover [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-icon"
            >
              {it.icon}
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold">{it.label}</span>
                {it.description && <span className="text-xs text-muted">{it.description}</span>}
              </span>
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

/* ───────────── Popover ───────────── */

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'center',
  className,
}: {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const controlled = open === undefined ? {} : { open };
  return (
    <P.Root {...controlled} {...(onOpenChange ? { onOpenChange } : {})}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            'z-50 rounded-xl border border-line-strong bg-panel p-2 text-ink shadow-panel outline-none',
            className,
          )}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
