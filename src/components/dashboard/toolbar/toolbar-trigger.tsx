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
        // Named group so the chevron can read the button's own Radix
        // `data-state` without a second source of truth. Named rather than
        // bare `group`, because these triggers are rendered inside toolbars
        // and panels that may own groups of their own.
        'group/toolbar-trigger',
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
        /*
          PRESS IS ACKNOWLEDGED, NOT ANNOUNCED.

          A 2% inset on press — the smallest deflection that still reads as a
          physical response on a 44px target. It is a TRANSFORM, so it costs
          no layout: the button occupies the same box in the toolbar's flex
          row at every point in the gesture, and nothing beside it moves.

          `transition-[...]` rather than `transition` (all): `all` would put
          width, height and the focus ring on the same clock, which is how a
          control ends up visibly catching up with its own focus outline.
          150ms sits in the middle of the 120–180ms band this product uses for
          hover/press feedback, and matches the colour transition it shares.
        */
        'active:scale-[0.98]',
        'transition-[color,background-color,border-color,transform] duration-150 ease-(--motion-ease-standard)',
        // Reduced motion keeps the STATE and drops the travel: colours still
        // change instantly and the press deflection is suppressed entirely.
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className={cn('min-w-0 truncate', labelClassName)}>{children}</span>
      {badge}
      {/*
        The chevron points where the panel is: down while closed, up while
        open. Rotation rather than an icon swap, so the two states are one
        continuous object rather than two glyphs exchanging places — and so
        there is nothing to animate at all when motion is reduced, where the
        arrow simply snaps to the correct direction and still tells the truth.
      */}
      <ChevronDown
        className={cn(
          'text-subtle-foreground size-3.5 shrink-0',
          'transition-transform duration-150 ease-(--motion-ease-standard)',
          'group-data-[state=open]/toolbar-trigger:rotate-180',
          'motion-reduce:transition-none',
        )}
        aria-hidden="true"
      />
    </button>
  );
});
