import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const variantClasses = {
  neutral: 'bg-muted text-muted-foreground border-border',
  /** Cyan identity accent — not shadcn's `accent`, which is a hover surface. */
  brand: 'bg-brand/10 text-brand border-brand/25',
  positive: 'bg-positive/10 text-positive border-positive/25',
  negative: 'bg-negative/10 text-negative border-negative/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
} as const;

export type BadgeVariant = keyof typeof variantClasses;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1',
        'text-xs font-medium tracking-wide',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
