'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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

/** The accepted editor geometry: centered dialog on desktop, reachable bottom sheet on phones. */
export function TradeAdaptiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  footer: ReactNode;
  children: ReactNode;
  returnFocusTo?: string;
}) {
  const desktop = useIsDesktopViewport();
  const keyboardOpen = useKeyboardObscuresViewport();
  const wasOpen = useRef(false);

  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || returnFocusTo === undefined) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(returnFocusTo)?.focus());
  }, [open, returnFocusTo]);

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          closeLabel="Close"
          className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-[38rem] flex-col gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="shrink-0 px-6 pt-6 pr-14 pb-3 text-left">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
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
      <SheetContent side="bottom" closeLabel="Close" className="max-h-[92dvh] gap-0 rounded-t-2xl">
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
