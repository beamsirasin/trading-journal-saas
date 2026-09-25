'use client';

import { ChevronRight, Plus, type LucideIcon } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { AdaptiveOverlay, OverlayActions } from './adaptive-overlay';

/**
 * JOURNAL AT ENTRY — one shared surface, two places to write.
 *
 * WHAT THIS REPLACES. Two divider-separated rows under a small `OPTIONAL`
 * eyebrow. Everything about that treatment was quiet: quiet enough that the
 * journal — the reason the product exists — read as a pair of links someone had
 * left at the bottom of a form. Being genuinely optional is not the same as
 * being nearly invisible.
 *
 * SO IT IS A SURFACE, WITH A NAME. `Journal at entry` says what the two areas
 * are for; `Now or later` says the whole thing can wait, which is the one fact
 * that has to survive the promotion. Between them they do the work `OPTIONAL`
 * was doing, without making either area look like a task.
 *
 * NO COUNTS, NO BADGES, NO STATUS WORDS. An area either shows its invitation or
 * shows what it holds, and the preview IS the status. "Recorded", "Complete",
 * "0 of 2" and their relatives are how an invitation turns back into a chore.
 *
 * THE EDITORS NO LONGER REPLACE THE FORM ON A DESKTOP.
 *
 * They used to: opening `Trade idea` swapped the whole recording form out for
 * the editor and offered "Back to trade". Three things were wrong with that.
 * The trade being written about disappeared while it was being written about,
 * so the risk and target it referred to could not be checked. The page's height
 * changed underneath the reader, which on a long form meant the scroll position
 * afterwards was somewhere new. And there was no way to abandon an edit — every
 * keystroke went straight into the trade, so "Back to trade" was a one-way
 * door with no companion.
 *
 * Both areas now open the same focused overlay the exit plan uses — a centred
 * dialog with room to write on a desktop, a modal bottom sheet on a phone — and
 * both carry `Done` and `Cancel`. The form stays where it was, at the scroll
 * position it was at, visible behind the overlay.
 */

export interface JournalArea {
  readonly id: string;
  /**
   * A quiet visual anchor for the row.
   *
   * The two areas were pure text and read as generic navigation links. An icon
   * in the product's own tinted-square idiom — the one the opening choice cards
   * already use — gives each a shape to recognise before the label is read.
   * Secondary by construction: 14px of glyph inside a 28px anchor, beside a
   * 14px label.
   */
  readonly Icon: LucideIcon;
  /** The area's own name — the thing being written about. */
  readonly label: string;
  /** Shown while the area is untouched. A question, not a noun. */
  readonly invitation: string;
  /** The overlay's title, and it does not change while the overlay is open. */
  readonly title: string;
  /** One line under the title saying what this is for. */
  readonly description: string;
  /** Concise preview lines once it holds something. Empty while untouched. */
  readonly preview: readonly string[];
  /** The editor, bound to the overlay-local draft — see `useJournalDraft`. */
  readonly children: ReactNode;
  /** A specialized editor may still reuse this area's launcher and active state. */
  readonly renderOverlay?: (state: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => ReactNode;
  /** Applies the overlay's edits to the trade. */
  readonly onDone: () => void;
  /** Discards them. Escape and the backdrop do this too. */
  readonly onCancel: () => void;
}

/**
 * AN OVERLAY-LOCAL WORKING COPY, so `Cancel` has something to discard.
 *
 * The editors write into a draft that is only merged into the trade when `Done`
 * is pressed. `Cancel`, Escape and the backdrop all put the draft back to what
 * the trade currently says, which is what makes leaving an overlay safe enough
 * to do casually — and casually leaving is exactly what someone does when they
 * opened `Feelings at entry` to see what it asks.
 *
 * The re-seed is a RENDER-PHASE adjustment rather than an effect: React's own
 * documented pattern for "reset state when a prop changes", and the only one
 * that avoids rendering a stale draft for a frame after the trade moves
 * underneath it.
 */
export function useJournalDraft<T>(
  committed: T,
  commit: (value: T) => void,
): { draft: T; setDraft: (value: T) => void; done: () => void; cancel: () => void } {
  const [draft, setDraft] = useState(committed);
  const [seeded, setSeeded] = useState(committed);

  if (seeded !== committed) {
    setSeeded(committed);
    setDraft(committed);
  }

  return {
    draft,
    setDraft,
    done: () => commit(draft),
    cancel: () => setDraft(committed),
  };
}

/**
 * JOURNAL AT ENTRY — the surface, under its own name.
 *
 * "Journal at entry" DESCRIBES THE SUBJECT, NOT THE MOMENT OF TYPING. A trader
 * writing up last Tuesday's finished trade is still recording what they thought
 * at entry; the name says which instant is being remembered, and the historical
 * path uses this same surface for exactly that reason.
 */
export function JournalAtEntry({ areas }: { areas: readonly JournalArea[] }) {
  return <LauncherSurface heading="Journal at entry" aside="Now or later" areas={areas} />;
}

/**
 * THE LAUNCHER SURFACE ITSELF — one boundary, one or more places to write.
 *
 * IT IS SHARED RATHER THAN COPIED because the Fully closed path needs a second
 * one: Review, holding Reflection, and later Reflection AND System assessment
 * side by side. A second implementation would have been two surfaces that
 * gradually stopped looking alike, and the second of them would have had to
 * relearn the overlay, the working copy, the focus restoration and the rule
 * that a preview is the only status an area ever shows.
 *
 * REVIEW IS A SEPARATE SURFACE, NOT A THIRD AREA IN THE JOURNAL. What the trader
 * thought at entry and what they concluded afterwards are different kinds of
 * truth about a trade, recorded at different times and read for different
 * reasons; merging them would make "how did you feel?" and "what would you
 * change?" look like two halves of one question.
 */
export function LauncherSurface({
  heading,
  aside,
  areas,
}: {
  heading: string;
  /** The one fact the promotion must not cost: none of this is due now. */
  aside?: string;
  areas: readonly JournalArea[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <>
      <section className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 px-1">
          <h2 className="text-label text-muted-foreground uppercase">{heading}</h2>
          {aside === undefined ? null : <p className="text-subtle-foreground text-xs">{aside}</p>}
        </div>

        {/*
          ONE SURFACE, NOT TWO CARDS. A single boundary with one quiet divider
          between the halves — side by side where there is room, stacked where
          there is not. Two outlined cards would read as two separate things to
          deal with, which is the impression this area exists to avoid.

          A SINGLE AREA TAKES THE WHOLE WIDTH. Splitting into columns before
          there is a second area would leave Reflection sitting in half a row
          with an empty half beside it, which reads as a missing thing rather
          than as a complete one.
        */}
        <div
          className={cn(
            'border-border bg-muted/20 divide-border grid min-w-0 divide-y overflow-hidden rounded-xl border',
            areas.length > 1 &&
              'min-[560px]:grid-cols-2 min-[560px]:divide-x min-[560px]:divide-y-0',
          )}
        >
          {areas.map((area) => (
            <JournalAreaButton key={area.id} area={area} onOpen={() => setActiveId(area.id)} />
          ))}
        </div>
      </section>

      {/*
        ONE OVERLAY PER AREA, rather than one overlay showing whichever area is
        active. A shared overlay has to render a title while it is closing, and
        the only title available then is the next area's or an empty string —
        so the heading visibly changed during the closing animation. Per-area
        overlays each keep a stable title for their whole life, which is also
        what lets each one name its own launcher for focus restoration.
      */}
      {areas.map((area) => {
        const open = activeId === area.id;
        if (area.renderOverlay !== undefined) {
          return (
            <Fragment key={area.id}>
              {area.renderOverlay({
                open,
                onOpenChange: (next) => setActiveId(next ? area.id : null),
              })}
            </Fragment>
          );
        }

        return (
          <AdaptiveOverlay
            key={area.id}
            open={open}
            onOpenChange={(next) => {
              if (next) return;
              // Escape and the backdrop are `Cancel`, not `Done`. An overlay that
              // silently kept edits on dismissal would make Cancel a lie.
              area.onCancel();
              setActiveId(null);
            }}
            returnFocusTo={`[data-journal-area="${area.id}"]`}
            title={area.title}
            description={area.description}
            className="sm:max-w-[38rem]"
            footer={
              <OverlayActions
                secondary={
                  <Button
                    variant="ghost"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => {
                      area.onCancel();
                      setActiveId(null);
                    }}
                  >
                    Cancel
                  </Button>
                }
                primary={
                  <Button
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => {
                      area.onDone();
                      setActiveId(null);
                    }}
                  >
                    Done
                  </Button>
                }
              />
            }
          >
            {/* Mounted only while open, so an abandoned editor is not still
                holding scroll position or an open sub-control next time. */}
            {open ? area.children : null}
          </AdaptiveOverlay>
        );
      })}
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
        'group/area flex min-h-[3.75rem] w-full min-w-0 items-center gap-3 px-3 py-3 text-left',
        'hover:bg-accent/40 focus-visible:ring-ring transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:-outline-offset-2',
      )}
    >
      {/* The anchor tints toward the accent once the area holds something, so a
          populated half is recognisable before any text is read. */}
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
          populated ? 'bg-primary/10 text-primary-text' : 'bg-muted text-muted-foreground',
        )}
      >
        <area.Icon className="size-3.5" />
      </span>

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

      {/*
        A plus to start, a chevron to continue — and both brighten with the row
        rather than sitting at a fixed grey. The affordance says the area is
        live, never that it is owed, so there is no badge and no count.
      */}
      <span
        aria-hidden="true"
        className="text-subtle-foreground group-hover/area:text-foreground shrink-0 transition-colors"
      >
        {populated ? <ChevronRight className="size-4" /> : <Plus className="size-4" />}
      </span>
    </button>
  );
}
