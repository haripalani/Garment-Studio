import type { ReactElement, ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';

export const TooltipProvider = T.Provider;

export function Tip({
  label,
  children,
  side = 'bottom',
}: {
  label: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md border border-line-strong bg-panel px-2 py-1 text-xs text-ink shadow-panel"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
