import { BRAND } from '@gs/core';

/** Working-brand mark (ADR-0002): a tee outline with a stitch line, plus the wordmark. */
export function Logo() {
  return (
    <span className="flex items-center gap-2 select-none">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <path
          d="M11 8.5 7 11l2 4.2 2-.9V24h10v-9.7l2 .9L25 11l-4-2.5c-.7 1.6-2.7 2.7-5 2.7s-4.3-1.1-5-2.7Z"
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M13 18.5h6"
          stroke="#fff"
          strokeWidth="1.6"
          strokeDasharray="1.6 1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="hidden text-[19px] font-bold tracking-[-0.4px] whitespace-nowrap text-ink min-[1200px]:inline">
        {BRAND.name.split(' ')[0]}
        <span className="font-medium text-accent-fg"> {BRAND.name.split(' ').slice(1).join(' ')}</span>
      </span>
    </span>
  );
}
