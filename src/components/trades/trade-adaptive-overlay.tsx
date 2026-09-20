'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

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

function useKeyboardObscuresViewport() {
  const [obscured, setObscured] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport == null) return;
    const read = () => setObscured(window.innerHeight - viewport.height > 140);
    read();
    viewport.addEventListener('resize', read);
    return () => viewport.removeEventListener('resize', read);
  }, []);
  return obscured;
}

/**
 * TWO DESKTOP PROPORTIONS, ONE PHONE ONE.
 *
 * `wide` is the original geometry: a 38rem dialog for an editor that holds a
 * list, a library or a branching set of questions (Exit Plan, System
 * Assessment). `focused` is for an editor that holds ONE answer — a symbol, a
 * direction, a time — where 38rem leaves the control adrift in the middle of a
 * dimmed screen. It is narrower and padded more generously, so the title,
 * helper, control and Done read as one composition rather than a small form
 * pinned to a large sheet.
 *
 * The phone is unaffected either way: a bottom sheet is already the width of
 * the screen, and desktop dialog dimensions must never be forced onto it.
 */
export function TradeAdaptiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  returnFocusRef,
  closeLabel,
  size = 'wide',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  footer: ReactNode;
  children: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel: string;
  /** Desktop proportion only. Defaults to the original `wide` dialog. */
  size?: 'wide' | 'focused';
}) {
  const desktop = useIsDesktopViewport();
  const focused = size === 'focused';
  const keyboardOpen = useKeyboardObscuresViewport();
  const wasOpen = useRef(false);

  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    requestAnimationFrame(() => returnFocusRef?.current?.focus());
  }, [open, returnFocusRef]);

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          closeLabel={closeLabel}
          className={cn(
            'flex max-h-[85dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0',
            focused ? 'max-w-[35rem]' : 'max-w-[38rem]',
          )}
        >
          <DialogHeader
            className={cn(
              'shrink-0 pr-14 text-left',
              focused ? 'px-7 pt-7 pb-2' : 'px-6 pt-6 pb-3',
            )}
          >
            <DialogTitle className={focused ? 'text-xl' : undefined}>{title}</DialogTitle>
          </DialogHeader>
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto', focused ? 'px-7 pb-5' : 'px-6 pb-4')}
          >
            <DialogDescription className={focused ? 'mb-5 text-sm' : 'mb-4'}>
              {description}
            </DialogDescription>
            {children}
          </div>
          <div
            className={cn(
              'border-border bg-card shrink-0 border-t',
              focused ? 'px-7 py-5' : 'px-6 py-4',
            )}
          >
            {footer}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={closeLabel}
        className="max-h-[92dvh] gap-0 rounded-t-2xl"
      >
        <SheetHeader className="border-border shrink-0 border-b px-4 pt-4 pr-14 pb-3">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <SheetDescription className="mb-4">{description}</SheetDescription>
          {children}
          {keyboardOpen ? <div className="border-border mt-4 border-t pt-3">{footer}</div> : null}
        </div>
        {keyboardOpen ? null : (
          <div
            className={cn(
              'border-border bg-card shrink-0 border-t px-4 pt-3',
              'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            )}
          >
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
