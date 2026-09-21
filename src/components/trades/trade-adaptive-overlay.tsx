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

/**
 * WHAT A PHONE KEYBOARD LEAVES VISIBLE, while one is up.
 *
 * iOS Safari, and Chrome on Android by default, lay the keyboard OVER the
 * page: the layout viewport keeps its height and only the visual viewport
 * shrinks. A sheet fixed to the bottom of the layout viewport then sits behind
 * the keyboard — measured on a 390x844 phone, the Symbol search at 571-619px
 * under a keyboard whose top was at 508px, and the last rows of a longer
 * library never scrollable above it. So while a keyboard is up the sheet is
 * lifted to the bottom of what is visible and capped to its height.
 *
 * `bottom` is how far the visible region's bottom sits above the layout
 * viewport's — the keyboard's height, less any distance the browser has
 * panned the page (`offsetTop`) to show the focused field — so it stays right
 * whether or not the browser pans. A browser that shrinks the layout viewport
 * with the keyboard instead reports no difference, and nothing moves.
 *
 * `null` while no keyboard is up: 140px, so a collapsing URL bar during a
 * scroll never counts as one.
 */
interface KeyboardViewport {
  /** Distance from the layout viewport bottom to the visible bottom. */
  readonly bottom: number;
  /** Height left visible above the keyboard. */
  readonly height: number;
  /** The layout viewport height, which the sheet floor is a fraction of. */
  readonly layout: number;
}

function useKeyboardViewport(): KeyboardViewport | null {
  const [visible, setVisible] = useState<KeyboardViewport | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport == null) return;
    const read = () => {
      if (window.innerHeight - viewport.height <= 140) {
        setVisible(null);
        return;
      }
      const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setVisible((current) =>
        current?.bottom === bottom &&
        current.height === viewport.height &&
        current.layout === window.innerHeight
          ? current
          : { bottom, height: viewport.height, layout: window.innerHeight },
      );
    };
    read();
    viewport.addEventListener('resize', read);
    viewport.addEventListener('scroll', read);
    return () => {
      viewport.removeEventListener('resize', read);
      viewport.removeEventListener('scroll', read);
    };
  }, []);
  return visible;
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
 * On a phone both are a bottom sheet the width of the screen — desktop dialog
 * dimensions are never forced onto it — and `focused` adds one thing there:
 * a floor. A one-answer editor holds very little, and a sheet sized to that
 * reads as a strip stuck to the bottom edge rather than a place to decide, so
 * it rises to just under half the screen however little it holds. It is still
 * bottom-anchored, its content still starts at its top, and an editor with
 * more in it (the Entry calendar) grows past the floor to the same ceiling as
 * any sheet and then scrolls inside itself.
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
  /**
   * Omitted by an editor that commits on the choice itself. A bordered strip
   * holding only a Done button under a list that already closed the sheet
   * promises a confirmation step that does not exist.
   */
  footer?: ReactNode;
  children: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel: string;
  /** Desktop proportion only. Defaults to the original `wide` dialog. */
  size?: 'wide' | 'focused';
}) {
  const desktop = useIsDesktopViewport();
  const focused = size === 'focused';
  const keyboard = useKeyboardViewport();
  const keyboardOpen = keyboard !== null;
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
          {footer === undefined ? null : (
            <div
              className={cn(
                'border-border bg-card shrink-0 border-t',
                focused ? 'px-7 py-5' : 'px-6 py-4',
              )}
            >
              {footer}
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={closeLabel}
        className={cn('max-h-[92dvh] gap-0 rounded-t-2xl', focused && 'min-h-[45dvh]')}
        /*
          Sitting on the keyboard rather than behind it: the same ceiling and
          floor, measured against what the keyboard leaves visible.
        */
        style={
          keyboard === null
            ? undefined
            : {
                bottom: keyboard.bottom,
                maxHeight: keyboard.height * 0.92,
                ...(focused
                  ? { minHeight: Math.min(keyboard.layout * 0.45, keyboard.height * 0.92) }
                  : {}),
              }
        }
      >
        <SheetHeader className="border-border shrink-0 border-b px-4 pt-4 pr-14 pb-3">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div
          data-sheet-body=""
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-4 pt-4',
            // With no footer strip, the body is what meets the home indicator.
            footer === undefined && !keyboardOpen
              ? 'pb-[max(1rem,env(safe-area-inset-bottom))]'
              : 'pb-4',
          )}
        >
          <SheetDescription className="mb-4">{description}</SheetDescription>
          {children}
          {keyboardOpen && footer !== undefined ? (
            <div className="border-border mt-4 border-t pt-3">{footer}</div>
          ) : null}
        </div>
        {keyboardOpen || footer === undefined ? null : (
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
