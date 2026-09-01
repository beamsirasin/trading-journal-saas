'use client';

import { CheckCircle2, CircleDot, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import {
  DEFAULT_TRADES_STATE_FILTER,
  TRADES_STATE_FILTERS,
  type TradesStateFilter,
} from '@/lib/trades/state-filter';
import { cn } from '@/lib/utils';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * THE TRADES WORKSPACE'S TOP-LEVEL POPULATION CONTROL.
 *
 * All Trades / Open Trades / Closed Trades. It replaces the Calendar / Trade
 * Log switcher that stood here: the page is a Trade Log at all times now, so
 * the control in this slot no longer chooses a MODE, it chooses which Trades
 * the one mode is showing.
 *
 * THE VISUAL LANGUAGE IS INHERITED, NOT REDESIGNED. Every class on the group
 * and on each item is the one the previous switcher used — same bordered
 * group, same `p-1`, same `rounded-lg` / `rounded-md` pairing, same 40px
 * minimum height, same `px-3`, same `text-sm font-semibold`, same
 * `bg-surface-raised` active fill, same `hover:bg-accent` rest state, same
 * focus ring. Only the members changed.
 *
 * SELECTION IS NOT COMMUNICATED BY FILL ALONE. `aria-current="page"` marks the
 * active item programmatically, and each item carries its own icon and full
 * label, so the state survives both a screen reader and a reader who cannot
 * distinguish the raised surface from the flat one.
 *
 * WHY LINKS RATHER THAN BUTTONS. The population is URL state, exactly as the
 * previous switcher's mode was: each state has a real address that can be
 * bookmarked, shared, opened in a new tab and restored on refresh. That also
 * gives keyboard operation and focus visibility for free from the browser's
 * own link semantics, rather than from a bespoke roving-tabindex widget.
 */
export function TradesStateNav({ state }: { readonly state: TradesStateFilter }) {
  const t = useTranslations('trades.workspace.state');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const ICON = { all: List, open: CircleDot, closed: CheckCircle2 } as const;

  function href(next: TradesStateFilter): string {
    const params = new URLSearchParams(searchParams.toString());
    // The default population is the bare address, so `/app/trades` keeps
    // meaning "the whole journal" rather than acquiring a redundant key.
    if (next === DEFAULT_TRADES_STATE_FILTER) params.delete('state');
    else params.set('state', next);

    // Page 4 of the old population is not page 4 of the new one, and a Trade
    // open in the sheet may not survive the change — so the pager and the
    // selection reset to the first valid page rather than stranding the reader
    // on an empty one.
    params.delete('cursor');
    params.delete('trail');
    params.delete('trade');
    params.delete('tab');
    params.delete('section');

    /*
      THE NEEDS ATTENTION BUCKET IS CLEARED, AND THAT IS THE WHOLE ANSWER TO
      "TWO FILTERS OVER ONE POPULATION".

      A bucket is a Dashboard-originated drill-down — "show me the Trades whose
      System outcome is still pending". Choosing a top-level population is a
      new question, not a refinement of that one, and keeping both would make
      genuinely impossible combinations reachable in one click: `state=closed`
      with the `open` bucket can never match a Trade. Clearing it means every
      state this control can reach is a population that actually exists.
    */
    params.delete('attention');

    const query = params.toString();
    return query === '' ? pathname : `${pathname}?${query}`;
  }

  return (
    /*
      The scroller is the only responsive concession, and it is a safety net
      rather than the normal case: three full labels fit from `sm` up with
      their icons, and below `sm` the icons step aside (see below) so the three
      fit on a 375px phone unabbreviated. On a 320px screen the group scrolls
      inside its own track instead of pushing the page sideways
      (docs/design-system.md section 6) — the same containment the Trade
      Details tab strip already uses.
    */
    <div className="-mx-1 max-w-full overflow-x-auto px-1">
      <nav
        aria-label={t('label')}
        className="border-border inline-flex w-fit rounded-lg border p-1"
      >
        {TRADES_STATE_FILTERS.map((item) => {
          const Icon = ICON[item];
          const isActive = state === item;
          return (
            <Link
              key={item}
              href={href(item)}
              data-trades-state={item}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'focus-visible:ring-ring inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold whitespace-nowrap outline-none focus-visible:ring-2',
                isActive
                  ? 'bg-surface-raised text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {/*
                Below `sm` the ICON steps aside, never the label. Three
                icon-and-label pairs do not fit a phone, and a reader deciding
                between "Open Trades" and "Closed Trades" needs the words far
                more than the glyph — the same principle the toolbar applies in
                reverse, where it drops labels from controls that keep a
                distinct icon each.
              */}
              <Icon className="hidden size-4 sm:inline-block" aria-hidden="true" />
              {t(item)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
