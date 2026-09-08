'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsDesktopViewport } from '@/hooks/use-is-desktop-viewport';

import { useKeyboardObscuringViewport } from './form-primitives';

/**
 * ONE FOCUSED OVERLAY, TWO SHAPES.
 *
 * The recording flow now has three places where a secondary decision needs the
 * reader's whole attention — choosing an exit plan, writing the trade idea,
 * recording how the entry felt — and before this they were three different
 * mechanisms: a centred dialog, a desktop panel that REPLACED the form in
 * place, and a hand-rolled `fixed inset-0` layer on phones. Three ways to leave
 * a form is three things to learn, and the middle one was the worst of them:
 * the trade the trader was writing about vanished while they wrote about it.
 *
 * So all three share this. Above `md` a centred Dialog; below it a modal bottom
 * sheet. Same title, same body, same footer, same Escape behaviour — only the
 * geometry differs, which is the same choice `ToolbarDisclosure` already makes
 * for the journal's filters.
 *
 * THE HEADER IS THE TITLE ALONE, AND THE DESCRIPTION SCROLLS WITH THE BODY.
 *
 * Both were pinned at first, and MEASURED at 320px under 200% text zoom that
 * cost the overlay its primary action: the sentence under "Choose exit plan"
 * wrapped to a 641px header inside a 718px panel, the body was crushed to 64px
 * against 2,342px of content, and the footer was pushed out through the bottom
 * edge — `Use exit plan` sat at 793–881px on a 780px screen, unreachable by any
 * amount of scrolling. A pinned region has to be able to promise it stays
 * small, and a sentence cannot. The title can, so the title is what stays: it
 * is the part that has to remain visible while the reader scrolls, and the
 * description is ordinary first-line content.
 *
 * THE FOOTER IS PINNED, EXCEPT WHEN A KEYBOARD IS UP. A bottom sheet docked to
 * the bottom of the layout viewport puts its actions underneath a phone
 * keyboard, so `Done` becomes unreachable exactly while someone is typing. When
 * the visual viewport says a keyboard is covering the page, the actions stop
 * being pinned and flow after the content instead, where scrolling can reach
 * them — the same answer `FormFooter` already gives on the form itself.
 */
export function AdaptiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  /**
   * A CSS selector for the control that opened this.
   *
   * Radix restores focus to a `DialogTrigger`, and none of these have one —
   * they are opened by ordinary buttons setting state, so without this a
   * keyboard user who presses Escape is returned to the top of a form they were
   * part-way down. Measured, on the first of these overlays to exist: `focus
   * restored to row: false`.
   */
  returnFocusTo,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  footer: ReactNode;
  children: ReactNode;
  returnFocusTo?: string;
  className?: string;
}) {
  const isDesktop = useIsDesktopViewport();
  const keyboardOpen = useKeyboardObscuringViewport();

  /*
    RESTORATION WATCHES THE OPEN FLAG, NOT THE CLOSE HANDLER.

    An overlay closes three ways — Escape, the backdrop, and its own primary
    action — and only the first two travel through `onOpenChange`. Reacting to
    the transition covers all three with one rule.
  */
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || returnFocusTo === undefined) return;
    const selector = returnFocusTo;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  }, [open, returnFocusTo]);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          closeLabel="Close"
          className={cn(
            'flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-[34rem] flex-col gap-0 overflow-hidden p-0',
            className,
          )}
        >
          <DialogHeader className="shrink-0 gap-1 px-6 pt-6 pr-14 pb-3 text-left">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
            <DialogDescription className="mb-4">{description}</DialogDescription>
            {children}
          </div>

          <div className="border-border bg-card shrink-0 border-t px-6 py-4">{footer}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel="Close"
        className={cn('max-h-[92dvh] gap-0 rounded-t-2xl', className)}
      >
        <SheetHeader className="border-border shrink-0 gap-1 border-b px-4 pt-4 pr-14 pb-3">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <SheetDescription className="mb-4">{description}</SheetDescription>
          {children}
          {/* Unpinned while a keyboard is up — see the note above. */}
          {keyboardOpen ? <div className="border-border mt-4 border-t pt-3">{footer}</div> : null}
        </div>

        {keyboardOpen ? null : (
          <div className="border-border bg-card shrink-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The action row every one of these overlays ends with.
 *
 * Primary right on a desktop, full-width and stacked on a phone — and the
 * primary is FIRST in the DOM either way, so a screen reader and a keyboard
 * both meet the affirmative action before the way out.
 */
export function OverlayActions({
  primary,
  secondary,
  tertiary,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  /** A quiet, non-destructive third action — "Clear selection". Optional. */
  tertiary?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      {tertiary === undefined ? null : (
        <div className="min-w-0 sm:order-first sm:mr-auto">{tertiary}</div>
      )}
      <div className="flex min-w-0 flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:items-center">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
