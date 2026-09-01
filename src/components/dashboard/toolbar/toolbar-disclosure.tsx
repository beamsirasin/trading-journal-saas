'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsDesktopViewport } from '@/hooks/use-is-desktop-viewport';

/**
 * ONE CONTROL, TWO SURFACES — chosen by viewport, never by shrinking.
 *
 * The frozen presentation contract is explicit that the mobile Date Range is
 * a near-full-height sheet rather than a compressed desktop popover, and the
 * same reasoning applies to Filters and Account: a floating panel anchored to
 * a 44px trigger on a 320px screen is a panel with no room left for content.
 * Rather than every toolbar control re-deciding that, they all open through
 * here.
 *
 * The TRIGGER is identical in both branches — the caller hands one node in
 * and it is rendered `asChild` either way. That is what makes the breakpoint
 * switch invisible: nothing about the closed toolbar depends on which surface
 * a click would open, so there is no flash, no hydration mismatch and no
 * layout difference between the two states.
 *
 * Escape, outside-click dismissal, focus trapping and focus restoration all
 * come from the Radix primitive underneath in both branches; neither surface
 * hand-rolls any of it.
 */
export function ToolbarDisclosure({
  open,
  onOpenChange,
  trigger,
  title,
  /** Rendered in the sheet header and used as the popover's accessible name. */
  children,
  footer,
  popoverClassName,
  align = 'end',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  /**
   * Pinned: the popover's bottom row, and the sheet's sticky footer.
   *
   * Omitted by a control whose panel commits on selection rather than on
   * Apply — an empty bordered strip under a list of accounts would promise a
   * confirmation step that does not exist.
   */
  footer?: ReactNode;
  popoverClassName?: string;
  align?: 'start' | 'end';
}) {
  const tCommon = useTranslations('common');
  const isDesktop = useIsDesktopViewport();

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align={align}
          sideOffset={8}
          aria-label={title}
          /*
            OPTS THIS POPOVER INTO THE TOOLBAR'S OPEN/CLOSE MOTION, and only
            this one.

            The animation itself lives in `globals.css` against
            `[data-slot='popover-content'][data-motion='toolbar']`, which is
            the same opt-in shape `SheetContent`'s `data-motion="shell"` uses
            and the same place every other portal animation in this product is
            defined. Scoped rather than applied to `PopoverContent` itself
            because that primitive also serves the KPI band's definition and
            indicator popovers, and giving every popover in the product motion
            is a design decision this pass was not asked to make.

            The mobile branch below needs no equivalent: `SheetContent`
            already animates, from the same stylesheet.
          */
          data-motion="toolbar"
          // `w-auto` overrides the shared 18rem definition column width: this
          // panel sizes to its own composition, which is two calendars wide.
          // The available-height cap and the internal scroll region below it
          // keep a short laptop viewport scrolling INSIDE the panel rather
          // than off the bottom of it.
          className={cn(
            'shadow-elevated flex w-auto max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0',
            popoverClassName,
          )}
        >
          <div className="max-h-[calc(var(--radix-popover-content-available-height)-4rem)] min-h-0 overflow-y-auto p-4">
            {children}
          </div>
          {footer === undefined ? null : (
            <div className="border-border bg-card border-t p-3">{footer}</div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        closeLabel={tCommon('close')}
        // `dvh`, not `vh`: on a phone the browser's own collapsing chrome
        // makes `vh` taller than the visible viewport, which would push the
        // sticky footer — Clear and Apply — under the URL bar exactly when a
        // reader reaches for it.
        className="h-[92dvh] max-h-[92dvh] gap-0 rounded-t-xl p-0"
      >
        <SheetHeader className="border-border shrink-0 border-b p-4 pr-14">
          <SheetTitle className="text-base">{title}</SheetTitle>
        </SheetHeader>
        {/*
          The one scroll region. Two stacked months at 320px are taller than
          any phone, and the contract accepts that — what it does not accept
          is the footer scrolling away with them.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer === undefined ? null : (
          <div className="border-border bg-card shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
