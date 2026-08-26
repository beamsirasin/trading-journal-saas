'use client';

import { Popover as PopoverPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * PROJECT-AUTHORED wrapper over `radix-ui`'s `Popover`, following the same
 * composition/`data-slot` convention as `dialog.tsx` and `dropdown-menu.tsx`.
 *
 * Chosen over `Tooltip` for the Dashboard's metric-definition affordances on
 * purpose: a Radix tooltip opens on hover and focus but has no open gesture
 * at all on touch, and this product treats mobile as a first-class surface
 * (CLAUDE.md §8). A popover opens from pointer, tap, and Enter/Space alike,
 * closes on Escape and outside click, and manages focus — so the definition
 * is reachable by every input method rather than by hover only.
 */
function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          // Width is intentionally independent of the trigger: these triggers
          // are icon-sized, so `--radix-popover-trigger-width` would collapse
          // the content to a single character column.
          'bg-popover text-popover-foreground border-border shadow-popover z-50 w-72 max-w-[calc(100vw-1.5rem)] origin-(--radix-popover-content-transform-origin) rounded-md border p-3 text-sm leading-relaxed outline-none',
          // A definition list for a whole card can outgrow a short viewport;
          // scroll inside the popover rather than off the screen.
          'max-h-(--radix-popover-content-available-height) overflow-y-auto',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
