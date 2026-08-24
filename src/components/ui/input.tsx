import type { InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * PROJECT-AUTHORED (not vendored from shadcn) — see docs/design-system.md §7b.
 *
 * `h-11` rather than shadcn's `h-9`: 44px is the documented minimum touch
 * target, and an input is a touch target. Sizing it once here is more
 * reliable than remembering to override it at every call site.
 */
export function Input({
  className,
  type = 'text',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-surface-raised text-foreground flex h-11 w-full min-w-0 rounded-md border px-3 py-2 text-base sm:text-sm',
        'placeholder:text-muted-foreground',
        'transition-[color,box-shadow] outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Errors are announced by aria-invalid; the ring is the visual echo of
        // it, never the only signal.
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}
