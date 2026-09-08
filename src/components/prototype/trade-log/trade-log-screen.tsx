'use client';

import { BookOpen, ChevronLeft, ChevronRight, Plus, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

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
/** Which of the journal's four states to render. `null` is the real one. */
export type JournalDemoState = 'loading' | 'error' | 'first-use' | null;

export function TradeLogScreen({
  locale = 'en',
  initialQuery,
  initialTradeId = null,
  initialTab = 'overview',
  demo = null,
}: {
  locale?: PrototypeLocale;
  initialQuery?: Partial<JournalQuery>;
  initialTradeId?: string | null;
  initialTab?: DetailTab;
  demo?: JournalDemoState;
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

  /**
   * CLOSING THE DRAWER PUTS FOCUS BACK ON THE ROW IT CAME FROM.
   *
   * Radix restores focus to the element that TRIGGERED a dialog, and this
   * drawer has no trigger — it is opened by clicking a row and setting state,
   * so on Escape focus fell all the way back to `<body>`. A keyboard user who
   * inspected the tenth trade and closed it was returned to the top of the
   * document with the list they had been reading scrolled somewhere below.
   *
   * The row is re-focused on the frame after the state change, because the
   * link only becomes focusable again once the modal's `inert` is lifted. The
   * production workspace solves the same problem with
   * `rememberTradeFocusReturn`; this is the prototype-scale version of it.
   */
  function closeTrade() {
    const returnTo = selectedTradeId;
    setSelectedTradeId(null);
    if (returnTo === null) return;
    requestAnimationFrame(() => {
      /*
        THE VISIBLE ROW, NOT THE FIRST ONE IN THE DOM.

        This prototype mounts all three journal compositions and lets CSS choose
        between them, so every trade has three copies of its row and two of them
        are `display: none` at any given width. `querySelector` returns the
        table's copy, which below 1248px is the hidden one — and `.focus()` on a
        `display: none` element does nothing at all, so the restoration silently
        did not happen on exactly the widths where it matters most. Production
        renders one composition and will not need this.
      */
      const candidates = document.querySelectorAll<HTMLAnchorElement>(
        `[data-trade-row="${returnTo}"] a[href]`,
      );
      for (const candidate of candidates) {
        if (candidate.offsetParent !== null) {
          candidate.focus({ preventScroll: false });
          return;
        }
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const showAccount = query.account === 'all';

  return (
    <PrototypeShell active="trades">
      {/*
        `lang` MARKS THE SCRIPT CHANGE. The document is served as `lang="en"`
        (the prototype lives under `/en`), so a Thai journal rendered inside it
        was Thai text a screen reader would pronounce with English rules and a
        translation tool would try to translate again. The attribute is scoped
        to the subtree that actually changes language.
      */}
      <Container width="canvas" className="pb-16" {...(locale === 'th' ? { lang: 'th' } : {})}>
        <TradeLogHeader
          copy={copy}
          query={query}
          onQueryChange={handleQueryChange}
          onLogTrade={() => {
            window.location.href = './log-trade';
          }}
        />

        <div className="flex min-w-0 flex-col gap-3">
          {/*
            ONE QUIET BAND OF CHROME, THEN THE JOURNAL.

            The controls, the applied-filter chips and the summary were three
            children of a `gap-4` column, each visually independent — and with the
            summary framed as a card, the page presented three stacked bands
            before the first trade. They are one group now, spaced tightly enough
            to read as a single toolbar region, and the only remaining gap of
            consequence is the one between that region and the journal itself.
          */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <TradeLogToolbar copy={copy} query={query} onQueryChange={handleQueryChange} />

            <AppliedFilterChips copy={copy} query={query} onQueryChange={handleQueryChange} />

            <TradeLogSummary
              copy={copy}
              summary={summary}
              state={query.state}
              status={demo === 'error' ? 'failed' : demo === 'loading' ? 'loading' : 'ready'}
            />
          </div>

          {/* ONE CONTINUOUS JOURNAL SURFACE — table or rows or list, plus its
              own footer. Not a card per trade, and not a card per breakpoint. */}
          <section
            aria-label={copy.journalLabel}
            className="border-border bg-card shadow-card min-w-0 overflow-hidden rounded-lg border"
          >
            {demo === 'loading' ? (
              <JournalSkeleton />
            ) : demo === 'error' ? (
              <FailedJournal />
            ) : demo === 'first-use' ? (
              <FirstUseJournal />
            ) : page.length === 0 ? (
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
                {/*
                  EACH COMPOSITION DECLARES ITS OWN RANGE — no rule here depends
                  on which of two variants Tailwind happens to emit last.

                  The mid-width wrapper was `hidden min-[1248px]:hidden md:block`,
                  which reads as "block from 768, hidden again from 1248" and did
                  not behave that way: Tailwind orders the named `md` variant and
                  the arbitrary `min-[1248px]` variant independently, so at 1440
                  `md:block` was emitted last and won. The table and the journal
                  rows both rendered — 361px of table directly above 468px of the
                  same five trades as rows. Measured at 1440 and 1280 before the
                  fix, and it is exactly what the design review reported seeing.

                  Stacking two arbitrary bounds gives each composition one rule
                  with both edges in it, so no two can ever be true at once.
                */}
                <div className="hidden min-[1248px]:block">
                  <TradeLogTable
                    trades={page}
                    copy={copy}
                    selectedTradeId={selectedTradeId}
                    showAccount={showAccount}
                    onSelect={openTrade}
                  />
                </div>
                <div className="hidden min-[768px]:max-[1247px]:block">
                  <TradeLogRows
                    trades={page}
                    copy={copy}
                    selectedTradeId={selectedTradeId}
                    showAccount={showAccount}
                    onSelect={openTrade}
                  />
                </div>
                <div className="block min-[768px]:hidden">
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
                  {/* `aria-disabled` rather than `disabled`, for the same
                      reason as the detail drawer's Previous/Next: the control
                      stays reachable and announces that it is unavailable,
                      instead of vanishing from the tab order at the first and
                      last page. */}
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-disabled={query.page <= 1}
                      className={cn(query.page <= 1 && 'pointer-events-none opacity-50')}
                      onClick={() =>
                        query.page > 1 && handleQueryChange({ ...query, page: query.page - 1 })
                      }
                    >
                      <ChevronLeft className="size-4" aria-hidden="true" />
                      {copy.previous}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-disabled={query.page >= totalPages}
                      className={cn(query.page >= totalPages && 'pointer-events-none opacity-50')}
                      onClick={() =>
                        query.page < totalPages &&
                        handleQueryChange({ ...query, page: query.page + 1 })
                      }
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
        onClose={closeTrade}
        onPrevious={previous === undefined ? null : () => setSelectedTradeId(previous.id)}
        onNext={next === undefined ? null : () => setSelectedTradeId(next.id)}
      />
    </PrototypeShell>
  );
}

/**
 * THE FOUR STATES A DATA SURFACE OWES ITS READER.
 *
 * The prototype shipped success and no-match and stopped there, which left the
 * two states a reader is most likely to misread undesigned. They are distinct
 * on purpose:
 *
 *   loading    reserves the journal's real geometry so nothing jumps on arrival
 *   first use  says how to start, not "no data"
 *   no match   names what narrowed it and offers the one undo
 *   failed     keeps the scope controls and offers Retry — it must NEVER look
 *              like an empty journal, because "your read failed" and "you have
 *              no trades" are opposite facts and only one of them is about the
 *              reader's trading
 *
 * Reachable at `?demo=loading|first-use|error` so all four can be reviewed.
 */
function JournalSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
      {/* Eight rows at the real 64px height. A skeleton that collapses into
          taller content on arrival moves the page under someone already
          reading it, which is worse than no skeleton at all. */}
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="border-border flex h-16 items-center gap-4 border-b px-4 last:border-b-0"
        >
          <div className="bg-muted h-4 w-24 rounded" />
          <div className="bg-muted h-4 w-28 rounded" />
          <div className="bg-muted h-4 w-20 rounded" />
          <div className="bg-muted ml-auto h-4 w-24 rounded" />
          <div className="bg-muted h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

function JournalNotice({
  icon,
  title,
  body,
  action,
  tone = 'neutral',
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-full',
          tone === 'error' ? 'bg-negative/10 text-negative' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <p className="text-foreground text-base font-semibold">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{body}</p>
      {action}
    </div>
  );
}

function EmptyJournal({ onClear }: { onClear: () => void }) {
  return (
    <JournalNotice
      icon={<Search className="size-5" aria-hidden="true" />}
      title="No trades match these filters"
      body="Your account and date range are unchanged — only the refinements below them narrowed the journal to nothing."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

function FirstUseJournal() {
  return (
    <JournalNotice
      icon={<BookOpen className="size-5" aria-hidden="true" />}
      title="Your trading journal starts here"
      body="Record a trade at entry to follow it while it is open, or after the trade to write up one that has already finished."
      action={
        <Button size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Log a trade
        </Button>
      }
    />
  );
}

/**
 * A FAILED READ IS NOT AN EMPTY JOURNAL.
 *
 * It keeps the scope controls above it untouched and offers Retry, and it never
 * borrows the empty state's wording or its zeroed figures — a reader who is
 * told "no trades" when the request actually failed has been given a fact about
 * their trading that is not true.
 */
function FailedJournal() {
  return (
    <JournalNotice
      tone="error"
      icon={<TriangleAlert className="size-5" aria-hidden="true" />}
      title="Trades could not be loaded"
      body="Your filters are unchanged. This is a problem reaching your journal, not a report about it."
      action={
        <Button variant="outline" size="sm">
          Retry
        </Button>
      }
    />
  );
}
