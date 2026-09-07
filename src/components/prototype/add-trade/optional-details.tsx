'use client';

import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useIsDesktopViewport } from '@/hooks/use-is-desktop-viewport';

/**
 * OPTIONAL DEPTH — one quiet region, two presentations.
 *
 * WHAT THIS REPLACES. Five separately outlined cards stacked under the core
 * surface — Strategy, Entry context, Notes and chart, Original plan, System
 * result — each with its own border, its own shadow and its own chevron. Five
 * bordered boxes of equal weight below one bordered box read as six peers, so
 * the form looked like a six-part questionnaire whichever way you scrolled it.
 * Nothing about that was true: exactly one of the six is required.
 *
 * The group is now ONE muted region with a quiet heading and hairline dividers
 * between its entries. No entry has a border of its own. That is the whole
 * mechanism — hierarchy through spacing, tone and rule weight rather than
 * through nested frames — and it is what makes the core record read as primary
 * without anything being added to it.
 *
 * DESKTOP EXPANDS IN PLACE; MOBILE OPENS A FULL-SCREEN SUBVIEW. On a phone an
 * inline accordion turns the form into one long document where the reader loses
 * both their place and any sense of how much is left. A subview gives the
 * optional work the whole screen, a title, and one way out — `Done` — which
 * returns to the form with the entry summarised. It is progressive disclosure,
 * not a wizard: there are no steps, no numbering, no forced order, and `Done`
 * never saves the trade.
 */

export function OptionalDetails({
  title = 'Optional details',
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-muted-foreground text-label uppercase">{title}</h2>
        {description === undefined ? null : (
          <p className="text-subtle-foreground text-xs">{description}</p>
        )}
      </div>
      {/*
        A muted plane, not a card. `bg-muted/30` sits the group visually BELOW
        the core surface's `bg-card`, which is the entire point: the reader can
        see at a glance which half of the page is the trade and which half is
        the commentary.
      */}
      <div className="bg-muted/30 border-border divide-border min-w-0 divide-y rounded-lg border">
        {children}
      </div>
    </section>
  );
}

export function OptionalEntry({
  title,
  /** What the entry holds, or `null` while it is genuinely untouched. */
  summary,
  /** A standing clarification, e.g. "Recorded after the trade". */
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string | null;
  note?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktopViewport();
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  const header = (
    <span className="min-w-0 flex-1 text-left">
      <span className="text-foreground block text-sm font-medium">{title}</span>
      {summary === undefined || summary === null ? (
        <span className="text-subtle-foreground block text-xs">Optional</span>
      ) : (
        // A populated entry states what it holds, so a reader scanning for what
        // is left to do never has to open a row to find out it is answered.
        <span className="text-muted-foreground block truncate text-xs">{summary}</span>
      )}
    </span>
  );

  if (!isDesktop) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hover:bg-accent/40 focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 px-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:-outline-offset-2"
        >
          {header}
          {note === undefined ? null : (
            <span className="text-subtle-foreground min-w-0 text-right text-xs">{note}</span>
          )}
          <ChevronRight className="text-subtle-foreground size-4 shrink-0" aria-hidden="true" />
        </button>
        <MobileSubview open={open} title={title} onDone={() => setOpen(false)}>
          {children}
        </MobileSubview>
      </>
    );
  }

  return (
    <div className="min-w-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((current) => !current)}
          className="hover:bg-accent/40 focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 px-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:-outline-offset-2"
        >
          {header}
          {note === undefined ? null : (
            <span className="text-subtle-foreground min-w-0 text-right text-xs">{note}</span>
          )}
          <ChevronDown
            className={cn(
              'text-subtle-foreground size-4 shrink-0 transition-transform duration-150',
              open && 'rotate-180',
              'motion-reduce:transition-none',
            )}
            aria-hidden="true"
          />
        </button>
      </h3>
      {open ? (
        <div id={id} className="border-border border-t px-4 py-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A full-screen optional area on a phone.
 *
 * `Done` RETURNS; IT DOES NOT SAVE. That distinction is load-bearing — a reader
 * who believes Done committed the trade will leave without saving it — so the
 * footer says so in as many words rather than relying on the button's colour to
 * imply it.
 *
 * Not a `<dialog>`: this is a same-surface navigation push, not a modal over the
 * form, and it deliberately reuses the page's own scroll and background rather
 * than the top layer. The body scroll behind it is locked while it is open so
 * two scroll containers never fight.
 */
export function MobileSubview({
  open,
  title,
  onDone,
  children,
}: {
  open: boolean;
  title: string;
  onDone: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="group"
      aria-label={title}
      data-mobile-subview={title}
      className="bg-background fixed inset-0 z-50 flex flex-col"
    >
      <header className="border-border bg-background flex shrink-0 items-center gap-2 border-b px-2 py-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onDone}>
          <X className="size-5" aria-hidden="true" />
        </Button>
        <h2 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
        <Button size="sm" onClick={onDone} className="min-h-11 shrink-0">
          Done
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{children}</div>

      <p className="border-border text-subtle-foreground shrink-0 border-t px-4 py-2 text-xs">
        Done returns to the trade. It does not save it.
      </p>
    </div>
  );
}
