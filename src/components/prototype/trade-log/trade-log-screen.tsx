'use client';

import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

import { prototypeCopy, type PrototypeLocale } from '../copy';
import { findTrade } from '../fixtures';
import { PROTOTYPE_POPULATION } from '../population';
import { PrototypeShell } from '../prototype-shell';
import { applyQuery, DEFAULT_QUERY, PAGE_SIZE, summarize, type JournalQuery } from '../query';
import { TradeDetailsPanel, type DetailTab } from './trade-details-panel';
import { TradeLogMobileList } from './trade-log-mobile';
import { TradeLogRows } from './trade-log-rows';
import { TradeLogSummary } from './trade-log-summary';
import { TradeLogTable } from './trade-log-table';
import { AppliedFilterChips, TradeLogHeader, TradeLogToolbar } from './trade-log-toolbar';

/**
 * THE TRADE LOG.
 *
 * PAGE ORDER IS FIXED AND SHORT: title and scope, then the workspace toolbar,
 * then applied chips when there are any, then one compact summary strip, then
 * one continuous journal surface. Five bands, of which two are one line tall.
 * The trades begin roughly 200px higher than they did.
 *
 * RESPONSIVE BY CONTENT WIDTH, NOT BY BREAKPOINT HABIT. The three compositions
 * switch at viewport widths chosen by measuring backwards from the journal's
 * available content, given the shell's real 64px rail and the container's real
 * gutters:
 *
 *   viewport >= 1248  ->  content >= 1120  ->  seven-column table
 *   viewport >= 768   ->  content >= 720   ->  multi-line journal rows
 *   below             ->                       mobile list
 *
 * That is why the middle threshold is `md` and the upper one is an arbitrary
 * `min-[1248px]` rather than `xl`: `xl` (1280) would have left an 80px band
 * where the table technically fits but sits at its minimum everywhere, and the
 * spec's threshold is about the CONTENT, which only this arithmetic knows.
 *
 * ALL THREE COMPOSITIONS ARE MOUNTED AND CSS CHOOSES. That is a prototype
 * decision, not a production one — it makes a browser-resize review show the
 * real transition instantly, and the cost (three renders of 25 rows) is
 * irrelevant against fixture data. Production would pick one.
 */
export function TradeLogScreen({
  locale = 'en',
  initialQuery,
  initialTradeId = null,
  initialTab = 'overview',
}: {
  locale?: PrototypeLocale;
  initialQuery?: Partial<JournalQuery>;
  initialTradeId?: string | null;
  initialTab?: DetailTab;
}) {
  /*
    DEEP LINKS ARRIVE AS PROPS, RESOLVED ON THE SERVER.

    They were read from `window.location` in a mount effect, which worked and
    was wrong twice: it calls `setState` synchronously inside an effect (a
    cascading render the React lint rule correctly rejects), and it renders one
    frame of the DEFAULT scope before correcting itself — so a screenshot taken
    at the wrong moment shows the wrong journal. The page reads `searchParams`
    instead and this component is initialised, once, with the right answer.
  */
  const copy = prototypeCopy(locale);
  const [query, setQuery] = useState<JournalQuery>({ ...DEFAULT_QUERY, ...initialQuery });
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(
    findTrade(initialTradeId) === null ? null : initialTradeId,
  );
  const [tab, setTab] = useState<DetailTab>(initialTab);

  const { page, matching, pageFrom, pageTo } = useMemo(() => applyQuery(query), [query]);
  const summary = useMemo(() => summarize(matching), [matching]);
  const selectedTrade = useMemo(
    () => PROTOTYPE_POPULATION.find((trade) => trade.id === selectedTradeId) ?? null,
    [selectedTradeId],
  );

  const handleQueryChange = useCallback((next: JournalQuery) => setQuery(next), []);

  const selectedIndex = page.findIndex((trade) => trade.id === selectedTradeId);
  const previous = selectedIndex > 0 ? page[selectedIndex - 1] : undefined;
  const next =
    selectedIndex >= 0 && selectedIndex < page.length - 1 ? page[selectedIndex + 1] : undefined;

  function openTrade(tradeId: string, nextTab: DetailTab) {
    setSelectedTradeId(tradeId);
    setTab(nextTab);
  }

  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const showAccount = query.account === 'all';

  return (
    <PrototypeShell active="trades">
      <Container width="canvas" className="pb-16">
        <TradeLogHeader
          copy={copy}
          query={query}
          onQueryChange={handleQueryChange}
          onLogTrade={() => {
            window.location.href = './log-trade';
          }}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <TradeLogToolbar copy={copy} query={query} onQueryChange={handleQueryChange} />

          <AppliedFilterChips copy={copy} query={query} onQueryChange={handleQueryChange} />

          <TradeLogSummary copy={copy} summary={summary} state={query.state} />

          {/* ONE CONTINUOUS JOURNAL SURFACE — table or rows or list, plus its
              own footer. Not a card per trade, and not a card per breakpoint. */}
          <section
            aria-label={copy.journalLabel}
            className="border-border bg-card shadow-card min-w-0 overflow-hidden rounded-lg border"
          >
            {page.length === 0 ? (
              <EmptyJournal
                onClear={() =>
                  handleQueryChange({
                    ...query,
                    search: '',
                    directions: [],
                    outcomes: [],
                    strategy: null,
                    setup: null,
                    followUps: [],
                    page: 1,
                  })
                }
              />
            ) : (
              <>
                <div className="hidden min-[1248px]:block">
                  <TradeLogTable
                    trades={page}
                    copy={copy}
                    selectedTradeId={selectedTradeId}
                    showAccount={showAccount}
                    onSelect={openTrade}
                  />
                </div>
                <div className="hidden min-[1248px]:hidden md:block">
                  <TradeLogRows
                    trades={page}
                    copy={copy}
                    selectedTradeId={selectedTradeId}
                    showAccount={showAccount}
                    onSelect={openTrade}
                  />
                </div>
                <div className="md:hidden">
                  <TradeLogMobileList
                    trades={page}
                    copy={copy}
                    selectedTradeId={selectedTradeId}
                    showAccount={showAccount}
                    onSelect={openTrade}
                  />
                </div>

                <footer className="border-border flex min-w-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-muted-foreground numeric text-sm">
                      {pageFrom}–{pageTo} of {matching.length} {copy.summaryTrades}
                    </p>
                    <p className="text-subtle-foreground text-xs">{copy.timezoneNote}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={query.page <= 1}
                      onClick={() => handleQueryChange({ ...query, page: query.page - 1 })}
                    >
                      <ChevronLeft className="size-4" aria-hidden="true" />
                      {copy.previous}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={query.page >= totalPages}
                      onClick={() => handleQueryChange({ ...query, page: query.page + 1 })}
                    >
                      {copy.next}
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </div>
      </Container>

      <TradeDetailsPanel
        trade={selectedTrade}
        copy={copy}
        tab={tab}
        onTabChange={setTab}
        onClose={() => setSelectedTradeId(null)}
        onPrevious={previous === undefined ? null : () => setSelectedTradeId(previous.id)}
        onNext={next === undefined ? null : () => setSelectedTradeId(next.id)}
      />
    </PrototypeShell>
  );
}

/**
 * Zero matches is a different state from an empty journal, and both are
 * different from a failed read. This is the first of the three; it says which
 * refinements produced it and offers the one action that undoes them.
 */
function EmptyJournal({ onClear }: { onClear: () => void }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center')}>
      <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
        <Search className="size-5" aria-hidden="true" />
      </span>
      <p className="text-foreground text-base font-semibold">No trades match these filters</p>
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
        Your account and date range are unchanged — only the refinements below them narrowed the
        journal to nothing.
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
