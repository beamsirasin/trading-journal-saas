import type { LabelHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * PROJECT-AUTHORED — a native `<label>` rather than Radix's.
 *
 * Radix's Label exists to forward clicks to controls that are not real form
 * elements. Every control in this phase is a real `<input>`, where `htmlFor`
 * already does that natively and needs no JavaScript. Adding a client
 * component for it would be cost without benefit.
 */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'text-foreground text-sm leading-none font-medium select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
