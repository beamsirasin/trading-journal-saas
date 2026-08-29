'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The one shape every toolbar control wears.
 *
 * Three controls that each hand-rolled a bordered pill would drift within a
 * release — different heights, different chevrons, different truncation — and
 * a row of near-identical-but-not buttons is the exact thing that makes a
 * product look assembled rather than designed. One component, three uses.
 *
 * FORWARDS ITS REF AND ITS PROPS, because Radix's `asChild` triggers clone
 * this element and expect `aria-expanded`, `aria-haspopup`, `data-state` and
 * the click handler to land on the real `<button>`.
 *
 * RESPONSIVE BY LABEL, NOT BY SHRINKING. Below `sm` a control may drop to
 * icon-only (`labelClassName="sr-only"` from the caller) — never to a smaller
 * target. The 44px minimum holds at every width, so the mobile row is three
 * full-size targets rather than four cramped ones.
 */
export const ToolbarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<'button'> & {
    icon: React.ReactNode;
    /** A count or status marker rendered after the label. */
    badge?: React.ReactNode | undefined;
    labelClassName?: string | undefined;
  }
>(function ToolbarTrigger(
  { icon, badge, children, className, labelClassName, ...props },
  reference,
) {
  return (
    <button
      ref={reference}
      type="button"
      {...props}
      className={cn(
        'border-border bg-card text-foreground inline-flex h-11 min-w-11 items-center gap-2 rounded-lg border px-3',
        'text-sm font-medium whitespace-nowrap',
        // `accent`, not `surface-raised`: the trigger is already `bg-card`,
        // and `surface-raised` is the SAME white as the card in light mode, so
        // hover would have had no effect there at all.
        'hover:bg-accent focus-visible:ring-ring outline-none focus-visible:ring-2',
        // The panel is open: the trigger lifts to the raised plane so the
        // reader can see which of the three controls the floating surface
        // belongs to without following its tail.
        'data-[state=open]:bg-accent',
        'transition-colors duration-150 motion-reduce:transition-none',
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className={cn('min-w-0 truncate', labelClassName)}>{children}</span>
      {badge}
      <ChevronDown className="text-subtle-foreground size-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
});
