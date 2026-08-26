'use client';

import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('bg-overlay fixed inset-0 z-50', className)}
      {...props}
    />
  );
}

/**
 * Which motion vocabulary a sheet speaks.
 *
 * `'shell'` is the application frame's: the drawer and its backdrop run on
 * `--shell-motion-duration` and `--ease-shell`, exactly as the desktop
 * sidebar does, and both begin below the global header. Everything else
 * (forms, filters, detail panels) omits it and keeps the shared dialog
 * motion, so this stays one deliberate exception rather than a knob.
 */
type SheetMotion = 'shell';

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  // Opts this sheet out of the generic dialog motion and into the app shell's
  // own (`data-motion="shell"`, defined in globals.css). Stamped on the
  // OVERLAY as well as the panel, because the two have to travel together:
  // the shell drawer's backdrop fades on exactly the drawer's clock, and both
  // start below the global header rather than over it. Anything that is not
  // the app shell leaves this unset and keeps the shared dialog motion.
  motion,
  // Required rather than defaulted to an English literal: this is a generic
  // primitive with no `next-intl` dependency of its own, so the
  // locale-correct label is the caller's responsibility (both current
  // callers pass `common.close`) — a default would silently ship English
  // inside a translated shell.
  closeLabel,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
  motion?: SheetMotion | undefined;
  closeLabel: string;
}) {
  return (
    <SheetPortal>
      <SheetOverlay data-motion={motion} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-motion={motion}
        className={cn(
          // PROJECT CUSTOMISATION: animation is defined against data-slot/state
          // in globals.css so it exists without an extra animation plugin and
          // can adopt the explicit reduced-motion fade policy there.
          'bg-background shadow-elevated fixed z-50 flex flex-col gap-4',
          side === 'right' && 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
          side === 'left' && 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
          side === 'top' && 'inset-x-0 top-0 h-auto border-b',
          side === 'bottom' && 'inset-x-0 bottom-0 h-auto border-t',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-1.5 right-1.5 flex size-11 items-center justify-center rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
