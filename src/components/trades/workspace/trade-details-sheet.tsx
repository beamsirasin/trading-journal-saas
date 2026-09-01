'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import {
  DEFAULT_TRADE_DETAILS_TAB,
  TRADE_DETAILS_TABS,
  type TradeDetailsTab,
} from '@/lib/trades/details-tabs';
import { cn } from '@/lib/utils';
import type { TradeCreateStrategyOption, TradeDetail } from '@/server/dal/trades';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useRouter } from '@/i18n/navigation';

import { TradeChartPanel } from './panels/chart-panel';
import { TradeExecutionPanel } from './panels/execution-panel';
import { TradeNotesPanel } from './panels/notes-panel';
import { TradeOverviewPanel } from './panels/overview-panel';
import { TradePlanPanel } from './panels/plan-panel';
import { TradeReviewPanel } from './panels/review-panel';
import { TradeDetailsHeader } from './trade-details-header';
import { useTradesListHref } from './trade-links';

/**
 * TRADE DETAILS — one Trade, inspected without leaving the workspace.
 *
 * URL-BACKED, WHICH IS WHY IT IS A NAVIGATION AND NOT A useState. `?trade=` is
 * the contract this route already had: the server fetches the Trade through
 * the fully authorized DAL, so a refresh reconstructs the sheet, a deep link
 * opens it, and the Dashboard's Needs Attention panel can point straight at
 * one. Holding the selection in local state would have meant a second,
 * client-side fetch path for data that is already workspace-scoped
 * server-side.
 *
 * THE TAB IS URL STATE TOO, AND FOR ONE SPECIFIC REASON. The Review column
 * links to the tab that can clear each actionable state — "Needs review" opens
 * Review, "Needs system result" opens Plan — which is only expressible if the
 * tab travels in the link. It carries no authorization surface whatsoever: an
 * unrecognised value degrades to Overview, and `?trade=` continues through its
 * own unchanged authorized path either way.
 *
 * ONE SHEET, TWO GEOMETRIES. Full width on a phone, because a three-quarter
 * side panel at 390px is neither a panel nor a page. From `sm` up it is a
 * right-hand drawer sized against this product's own container scale — wide
 * enough for a two-column fact grid and an execution timeline, narrow enough
 * that the table behind it stays visible as context rather than being covered.
 * The competitor's exact percentage is deliberately not copied.
 *
 * CLOSING IS A NAVIGATION BACK TO THE SAME LIST — same filters, same page,
 * same bucket — never a bare `/app/trades` that would silently discard the
 * scope the reader had built. Escape, the close button, and an outside click
 * all take that one path, because they all mean the same thing.
 */
export function TradeDetailsSheet({
  trade,
  tab,
  timezone,
  locale,
  canWrite,
  classificationOptions,
}: {
  trade: TradeDetail;
  tab: TradeDetailsTab;
  timezone: string;
  locale: string;
  canWrite: boolean;
  classificationOptions: readonly TradeCreateStrategyOption[];
}) {
  const t = useTranslations('trades.workspace.details');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const listHref = useTradesListHref();
  const baseId = useId();

  /*
    THE URL SEEDS THE TAB; THE READER'S CLICKS DO NOT WRITE BACK TO IT.

    Landing on `?tab=review` from a Review-column link must open Review, so the
    URL is the initial value. But once the sheet is open, switching tabs is a
    reading gesture, not a change to which Trade is being read — pushing a
    history entry for each of six tabs would turn one Back press into six. So
    tab changes are local state, and the URL keeps whatever brought the reader
    here. The key on this component (the Trade id, set by the caller) is what
    re-seeds this when a DIFFERENT Trade opens.
  */
  const [active, setActive] = useState<TradeDetailsTab>(tab);

  function close() {
    router.push(listHref(), { scroll: false });
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent
        side="right"
        closeLabel={tCommon('close')}
        data-trade-details={trade.tradeId}
        // `sm:max-w-xl` at tablet, `lg:max-w-2xl` on a desktop: the sheet grows
        // with the viewport but stops well short of the workspace width, so the
        // table behind it stays readable context.
        className="w-full gap-0 p-0 sm:max-w-xl lg:max-w-2xl"
      >
        <SheetHeader className="border-border shrink-0 border-b p-4 pr-14">
          <SheetTitle className="min-w-0 text-lg break-all">{trade.symbol}</SheetTitle>
          <TradeDetailsHeader trade={trade} timezone={timezone} locale={locale} />
        </SheetHeader>

        {/*
          A real tablist. Arrow keys, Home and End come from explicit ARIA
          wiring over the browser's own button semantics, with a roving
          tabindex so the strip is one tab stop rather than six. The strip
          scrolls horizontally on a narrow phone rather than shrinking its
          labels — six unreadable words are worse than four readable ones and a
          swipe.
        */}
        <div
          role="tablist"
          aria-label={t('tabsLabel')}
          className="border-border flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5"
          onKeyDown={(event) => {
            const index = TRADE_DETAILS_TABS.indexOf(active);
            const count = TRADE_DETAILS_TABS.length;
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % count
                : event.key === 'ArrowLeft'
                  ? (index - 1 + count) % count
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? count - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            const target = TRADE_DETAILS_TABS[next];
            if (target === undefined) return;
            setActive(target);
            document.getElementById(`${baseId}-tab-${target}`)?.focus();
          }}
        >
          {TRADE_DETAILS_TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item}`}
              aria-selected={item === active}
              aria-controls={`${baseId}-panel-${item}`}
              tabIndex={item === active ? 0 : -1}
              data-trade-details-tab={item}
              onClick={() => setActive(item)}
              className={cn(
                'focus-visible:ring-ring inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2',
                // Colour is not the only signal: the selected tab also carries
                // `aria-selected` and a filled surface, not just a tint.
                item === active
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tabs.${item}`)}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`${baseId}-panel-${active}`}
          aria-labelledby={`${baseId}-tab-${active}`}
          tabIndex={0}
          // `pb-10` and the safe-area inset together keep the last action in a
          // panel clear of a phone's home indicator.
          className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(2.5rem,env(safe-area-inset-bottom))]"
        >
          {active === 'overview' ? (
            <TradeOverviewPanel trade={trade} timezone={timezone} locale={locale} />
          ) : active === 'plan' ? (
            <TradePlanPanel
              trade={trade}
              timezone={timezone}
              locale={locale}
              canWrite={canWrite}
              classificationOptions={classificationOptions}
            />
          ) : active === 'execution' ? (
            <TradeExecutionPanel
              trade={trade}
              timezone={timezone}
              locale={locale}
              canWrite={canWrite}
            />
          ) : active === 'review' ? (
            <TradeReviewPanel trade={trade} canWrite={canWrite} />
          ) : active === 'chart' ? (
            <TradeChartPanel trade={trade} />
          ) : (
            <TradeNotesPanel trade={trade} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export { DEFAULT_TRADE_DETAILS_TAB };
