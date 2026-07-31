import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const variantClasses = {
  neutral: 'bg-surface-raised text-muted border-border-subtle',
  accent: 'bg-accent/10 text-accent border-accent/25',
  positive: 'bg-positive/10 text-positive border-positive/25',
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
