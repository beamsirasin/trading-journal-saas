'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useIsDesktopViewport } from '@/hooks/use-is-desktop-viewport';

/**
 * JOURNAL AT ENTRY — one shared surface, two places to write.
 *
 * WHAT THIS REPLACES. Two divider-separated rows under a small `OPTIONAL`
 * eyebrow. Everything about that treatment was quiet: quiet enough that the
 * journal — the reason the product exists — read as a pair of links someone had
 * left at the bottom of a form. Being genuinely optional is not the same as
 * being nearly invisible, and the previous pass over-corrected the earlier
 * mistake of making optional depth look mandatory.
 *
 * SO IT IS A SURFACE, WITH A NAME. `Journal at entry` says what the two areas
 * are for; `Now or later` says the whole thing can wait, which is the one fact
 * that has to survive the promotion. Between them they do the work `OPTIONAL`
 * was doing, without making either area look like a task.
 *
 * IT SITS BETWEEN THE BASELINE AND SAVE, AND STAYS BELOW BOTH. A restrained
 * boundary and a faint ground — stronger than a bare link, quieter than the
 * amounts above it and quieter than the filled Save beneath it.
 *
 * NO COUNTS, NO BADGES, NO STATUS WORDS. An area either shows its invitation or
 * shows what it holds, and the preview IS the status. "Recorded", "Complete",
 * "0 of 2" and their relatives are how an invitation turns back into a chore.
 */

export interface JournalArea {
  readonly id: string;
  /** The area's own name — the thing being written about. */
  readonly label: string;
  /** Shown while the area is untouched. A question, not a noun. */
  readonly invitation: string;
  /** The focused editor's title. May differ from the area's short name. */
  readonly title: string;
  /** Concise preview lines once it holds something. Empty while untouched. */
  readonly preview: readonly string[];
  readonly children: ReactNode;
}

export function JournalAtEntry({ areas }: { areas: readonly JournalArea[] }) {
  const isDesktop = useIsDesktopViewport();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = areas.find((area) => area.id === activeId) ?? null;

  /* The phone editor owns the screen, so the page behind it must not scroll
     underneath — two scroll containers fighting is how a full-screen editor
     loses the reader's place. */
  useEffect(() => {
    if (isDesktop || active === null) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isDesktop, active]);

  /* Returning puts focus back on the area it came from: the editor replaced
     that area, so on return there is nothing focused and a keyboard user lands
     at the top of a document they were part-way down. */
  function close(id: string) {
    setActiveId(null);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-journal-area="${id}"]`)?.focus();
    });
  }

  if (active !== null && isDesktop) {
    return (
      <section className="min-w-0">
        <div className="border-border mb-3 flex min-w-0 items-center justify-between gap-3 border-b pb-2">
          <h2 className="text-foreground min-w-0 text-sm font-semibold">{active.title}</h2>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={() => close(active.id)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to trade
          </Button>
        </div>
        {active.children}
      </section>
    );
  }

  return (
    <>
      <section className="min-w-0">
        <div className="mb-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 px-1">
          <h2 className="text-foreground text-sm font-medium">Journal at entry</h2>
          {/* The one fact the promotion must not cost: none of this is due now. */}
          <p className="text-subtle-foreground text-xs">Now or later</p>
        </div>

        {/*
          ONE SURFACE, NOT TWO CARDS. A single boundary with one quiet divider
          between the halves — side by side where there is room, stacked where
          there is not. Two outlined cards would read as two separate things to
          deal with, which is the impression this area exists to avoid.
        */}
        <div className="border-border bg-muted/20 divide-border grid min-w-0 divide-y overflow-hidden rounded-xl border min-[560px]:grid-cols-2 min-[560px]:divide-x min-[560px]:divide-y-0">
          {areas.map((area) => (
            <JournalAreaButton key={area.id} area={area} onOpen={() => setActiveId(area.id)} />
          ))}
        </div>
      </section>

      {active === null ? null : (
        <div
          role="group"
          aria-label={active.title}
          data-journal-editor={active.id}
          className="bg-background fixed inset-0 z-50 flex flex-col"
        >
          <header className="border-border bg-background flex shrink-0 items-center gap-2 border-b px-2 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 shrink-0"
              onClick={() => close(active.id)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Trade
            </Button>
            <h2 className="text-foreground min-w-0 flex-1 truncate text-right text-sm font-semibold">
              {active.title}
            </h2>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{active.children}</div>
        </div>
      )}
    </>
  );
}

/** One half of the surface. The whole area is the control. */
function JournalAreaButton({ area, onOpen }: { area: JournalArea; onOpen: () => void }) {
  const populated = area.preview.length > 0;

  return (
    <button
      type="button"
      data-journal-area={area.id}
      onClick={onOpen}
      className={cn(
        'flex min-h-[3.75rem] w-full min-w-0 items-center gap-3 px-3 py-3 text-left',
        'hover:bg-accent/40 focus-visible:ring-ring transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:-outline-offset-2',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-sm font-medium">{area.label}</span>
        {populated ? (
          /* The preview IS the status. Two lines at most; the rest is one
             activation away. */
          area.preview.slice(0, 2).map((line) => (
            <span key={line} className="text-muted-foreground block truncate text-xs">
              {line}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground block text-xs">{area.invitation}</span>
        )}
      </span>

      {/* A plus to start, a chevron to continue. Both subtle: the affordance
          says the area is live, not that it is owed. */}
      {populated ? (
        <ChevronRight className="text-subtle-foreground size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Plus className="text-subtle-foreground size-4 shrink-0" aria-hidden="true" />
      )}
    </button>
  );
}
