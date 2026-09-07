'use client';

import { cn } from '@/lib/utils';

import { followUpLabel, type PrototypeCopy } from '../copy';
import { FOLLOW_UP_TAB, FOLLOW_UP_TONE, type FollowUp } from '../presentation';
import type { DetailTab } from './trade-details-panel';

/**
 * ONE follow-up per row, and it goes somewhere specific.
 *
 * The row shows the highest-priority outstanding item only; everything else
 * about the Trade remains visible inside its details and individually
 * filterable. A row that listed three chores would be a to-do list wearing a
 * journal's clothes.
 *
 * THREE TONES, NOT ONE AND NOT FIVE — see `FOLLOW_UP_TONE`. Amber is reserved
 * for a record that is broken as a RECORD; the primary accent carries the
 * product's central action, resolving the system result; everything else stays
 * neutral. Painting every missing optional field amber is how a journal starts
 * to feel like an audit (spec §B5).
 */
export function FollowUpAction({
  followUp,
  copy,
  onSelect,
  className,
  emptyPlaceholder = true,
}: {
  followUp: FollowUp;
  copy: PrototypeCopy;
  onSelect: (tab: DetailTab) => void;
  className?: string;
  /**
   * Whether a Trade with nothing outstanding still draws an em dash.
   *
   * TRUE IN THE TABLE, FALSE IN A JOURNAL ROW, and the difference is not
   * cosmetic. A table CELL must be filled — an empty one reads as a rendering
   * fault and breaks the column's alignment — so the dash is the honest "no
   * value here". A row has no column to fill, and three stacked dashes down its
   * right edge (money, R, follow-up) turn an ordinary open position into
   * something that looks like an error report.
   */
  emptyPlaceholder?: boolean;
}) {
  if (followUp === 'none') {
    return emptyPlaceholder ? (
      <span className={cn('text-subtle-foreground', className)} aria-hidden="true">
        —
      </span>
    ) : null;
  }

  const tone = FOLLOW_UP_TONE[followUp];

  return (
    <button
      type="button"
      data-follow-up={followUp}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(FOLLOW_UP_TAB[followUp]);
      }}
      className={cn(
        'focus-visible:ring-ring relative inline-flex items-center rounded-sm text-left text-sm',
        'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
        /*
          THE HIT AREA IS BIGGER THAN THE INK.

          Measured at 16–20px tall across the table and the journal rows, which
          is under WCAG 2.2's 24px minimum and well under this product's own
          44px target. Growing the control itself would have added ~24px to
          every row in a 25-row list — the density the redesign exists to
          protect. A transparent pseudo-element extends the target vertically
          instead: it costs no layout, so the row keeps its height and its
          baseline alignment, and the thumb still gets 44px.
        */
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
        tone === 'attention'
          ? 'text-warning font-medium'
          : tone === 'action'
            ? 'text-primary font-medium'
            : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {followUpLabel(copy, followUp)}
    </button>
  );
}
