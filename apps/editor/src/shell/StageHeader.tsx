import type { ReactNode } from 'react';

export function StageHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-4">
      <h2 className="m-0 text-[15px] font-[650] tracking-[-0.15px] whitespace-nowrap text-accent-fg">{title}</h2>
      {sub && <span className="whitespace-nowrap text-muted">{sub}</span>}
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
    </div>
  );
}
