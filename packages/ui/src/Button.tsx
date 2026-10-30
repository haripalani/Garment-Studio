import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { Tip } from './Tooltip';

type Variant = 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  default: 'bg-panel text-ink border-line-strong hover:bg-hover',
  primary: 'bg-accent text-accent-ink border-accent hover:bg-accent-hover hover:border-accent-hover',
  ghost: 'bg-transparent text-icon border-transparent hover:bg-hover hover:text-ink',
  danger: 'bg-transparent text-danger border-line-strong hover:bg-hover',
  soft: 'bg-accent-soft text-accent-fg border-transparent hover:brightness-110',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px]',
  md: 'h-8 px-2.5 text-[12.5px]',
  lg: 'h-10 px-3 text-[13px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-[7px] rounded-lg border font-medium whitespace-nowrap',
        'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  /** Accessible name; also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  tooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', tooltip = true, className, ...rest },
  ref,
) {
  const btn = (
    <Button ref={ref} variant={variant} aria-label={label} className={cn('w-8 px-0', className)} {...rest}>
      {icon}
    </Button>
  );
  return tooltip ? <Tip label={label}>{btn}</Tip> : btn;
});

/** Chevron half of a split button: `<Button variant="primary" className="rounded-r-none">` + this as a menu trigger. */
export const SplitChevron = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function SplitChevron({ label, className, ...rest }, ref) {
  return (
    <Button
      ref={ref}
      variant="primary"
      aria-label={label}
      className={cn('w-[30px] rounded-l-none border-l-white/20 px-0 [&_svg]:size-3.5', className)}
      {...rest}
    >
      <ChevronDown />
    </Button>
  );
});
