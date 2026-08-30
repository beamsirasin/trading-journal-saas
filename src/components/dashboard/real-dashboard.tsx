import { ArrowRight, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { DashboardPageData } from '@/lib/dashboard/page-data';
import { composePerformanceCards } from '@/lib/dashboard/performance-card';
import {
  dashboardLayoutItem,
  dashboardWidgetAttributes,
  DEFAULT_DASHBOARD_LAYOUT,
} from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import {
  DashboardLoadingIndicator,
  DashboardLoadingStatus,
} from '@/components/dashboard/dashboard-loading-indicator';
import { ActiveTradingAccountSummaryCard } from '@/components/dashboard/empty-trading-dashboard';
import { ExecutionGapSection } from '@/components/dashboard/execution-gap/execution-gap-section';
import { BasicKpiRow } from '@/components/dashboard/kpi/basic-kpi-row';
import { BASIC_KPI_GRID_CLASS, kpiSpanClassName } from '@/components/dashboard/kpi/kpi-widget-card';
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
import { PerformanceCard } from '@/components/dashboard/performance/performance-card';
import { RecentTradesCard } from '@/components/dashboard/recent-trades/recent-trades-card';
import { MetricLabel } from '@/components/product/metric';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export type { DashboardRecentTrade } from '@/lib/dashboard/page-data';

const BASIC_KPI_LAYOUT = DEFAULT_DASHBOARD_LAYOUT.filter((item) =>
  item.widgetId.startsWith('basic.'),
);

export function RealDashboard({
  data,
  dateLocale,
  calendarSlot,
  insightSlot,
  riskSlot,
}: {
  data: DashboardPageData;
  dateLocale: string;
  /**
   * The Calendar's own server boundary, streamed in by the route.
   *
   * Passed as a node rather than as data because D6A deliberately kept the
   * Calendar out of `DashboardPageData` — it is a separate read on a
   * dimension (the month) the Dashboard bundle does not have. Handing the
   * rendered subtree in lets it suspend on its own without the five core
   * reads waiting for it, and keeps this component free of any knowledge of
   * how a month is fetched.
   */
  calendarSlot: React.ReactNode;
  /**
   * D8 insight pillars. Its own streamed boundary too: five more bulk
   * projections must never hold the five core reads off the screen.
   */
  insightSlot: React.ReactNode;
  /**
   * D7's Risk Performance boundary, on exactly the same terms and for the
   * same reason: a modeled balance needs the Account's whole authoritative
   * money history to know what the visible range opened at, which is a
   * different horizon from the five bounded core reads.
   */
  riskSlot: React.ReactNode;
}) {
  const t = useTranslations('dashboard.real');
  const tFilters = useTranslations('dashboard.filters');
  const accountLabel =
    data.account.kind === 'account' ? data.account.account.name : tFilters('allAccounts');
  const performanceCards = composePerformanceCards(data);

  return (
    /*
      SECTION RHYTHM IS EXPLICIT, NOT ONE UNIFORM GAP.

      Through D4 every boundary on this page was the same `gap-8` (32px),
      which spends the same whitespace separating an account label from a KPI
      band as it does separating two analytical sections — and made the page
      read like a marketing layout rather than a data product. D4.5 replaced
      that with a five-step ramp (20/24/28/32px).

      THIS PASS COLLAPSES THE RAMP TO TWO STEPS. Five distinct margins is a
      rhythm no reader can perceive — 20px and 24px are not legibly different
      boundaries, they are just four separate ways of being loose, and
      together they spent ~40px of the first viewport saying nothing. There
      are now exactly two kinds of boundary on this page, matching the two
      that actually exist: 16px between the CONTEXT strips that open the page
      (account, KPI band, Needs Attention — one continuous operational block)
      and 24px between ANALYTICAL SECTIONS, which is also the gap those
      sections use between their own cards, so a section boundary and a card
      boundary read as one system. `first:mt-0` keeps the top edge correct
      when the account context bar is absent (all-accounts scope).
    */
    <div className="flex min-w-0 flex-col">
      {data.account.kind === 'account' ? (
        <ActiveTradingAccountSummaryCard account={data.account.account} />
      ) : null}
      <BasicKpiRow data={data} className="mt-4 first:mt-0" />
      <NeedsAttentionPanel attention={data.attention.counts} className="mt-4" />

      <section aria-labelledby="performance-heading" className="mt-6 flex flex-col gap-4">
        {/*
          NO LOCAL RANGE CONTROL. Through R2A this heading row carried its own
          30D/90D/All links — a second visible owner of a range that was always
          global. It is gone: the sticky Dashboard toolbar is the one Date
          Range control, and it offers the full canonical preset set plus
          Custom rather than three of the nine. The underlying state is
          unchanged; only its single visible owner moved.

          A SECTION HEADING, NOT A PAGE HEADER. It was `text-xl` over a
          `leading-relaxed` sentence — 60px for two lines introducing two cards
          whose own titles repeat the same thing 40px lower. `text-base` is
          also what the benchmark uses for a section title (16px/500).
        */}
        {/*
          A TITLE AND AN AFFORDANCE, NOT A TITLE AND A PARAGRAPH.

          Measured, the benchmark Dashboard carries ZERO explanatory
          paragraphs (§16, "Text paragraphs: 0"); its card headers are a
          16px/500 title plus an ⓘ, and every definition lives behind that
          icon. The sentence that used to sit here — "Active account: {name}.
          Each side uses its own eligible Trade population." — said one thing
          the toolbar and the account strip 100px above already say (which
          account), and one thing that is genuine methodology (the two sides
          do not share a Trade population). The first was redundant; the
          second is exactly what an ⓘ is for, and it is now the first line of
          this popover rather than a permanent second line under the heading.

          Nothing was deleted: both facts are in `performanceHelp`, reachable
          by pointer, touch and keyboard through `MetricInfo`'s real button.
        */}
        <div className="flex min-w-0 items-center gap-1">
          <h2 id="performance-heading" className="text-base font-semibold tracking-tight">
            {t('performanceTitle')}
          </h2>
          <MetricInfo
            triggerLabel={t('performanceInfoTrigger')}
            title={t('performanceTitle')}
            description={t('performanceHelp', { account: accountLabel })}
          />
        </div>

        {/*
          Two equal halves, and `items-stretch` so both cards share a top edge
          and a height whatever each side's population contains. Since D4.5
          this grid AGREES with the layout metadata rather than contradicting
          it: `performance` is its own two-column section and each card spans
          one of its columns, so the retired 2+3-of-five reading is gone from
          both the page and the record it emits.
        */}
        <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2">
          {performanceCards.map((model) => (
            <PerformanceCard key={model.widgetId} model={model} />
          ))}
        </div>
      </section>

      {/*
        D5B replaces D2's placeholder summary card with the real
        `execution.gap` widget. It still consumes only
        `DashboardPageData.comparison` — one server-composed Population C
        model, no fetch of its own — and it deliberately follows the D4 pair
        it explains rather than sitting between the KPI band and the
        baselines.
      */}
      <ExecutionGapSection comparison={data.comparison} dateLocale={dateLocale} className="mt-6" />

      {/*
        D8B — the three insight pillars, between the Execution Gap they help
        explain and the record list that follows. The Gap says HOW MUCH edge
        the execution captured; these three ask where that came from — the
        system, the trader state, the trader discipline — and only then does
        the page hand over to individual records.
      */}
      <div className="mt-6 min-w-0">{insightSlot}</div>

      {/*
        D6B — the one section whose two widgets are genuinely unequal (§30).
        The split is now FIVE columns of Trade rows beside SEVEN of Calendar
        grid, reversed from D6B's original 7 + 5.

        Measured, the old ratio was backwards. The Trade list carries an
        instrument, a direction, a status chip, a strategy line and three
        narrow R columns — it reaches its natural width at about 500px and
        every pixel past that is padding between the strategy line and the
        numbers. The Calendar is a seven-column grid of fixed-aspect day
        cells: width is the ONLY thing that makes a day cell legible, and at
        five of twelve its cells were dropping their secondary line through
        the `@container` queries the card uses to stay honest at small sizes.
        Wider goes to the widget that can spend it. The Basic KPI band's
        five-column grid is deliberately NOT reused here; each section owns
        its own, which is exactly what D4.5's section-aware metadata was for.

        `items-start`, NOT `items-stretch`. D6B stretched the shorter card to
        give the section one bottom edge, which was a fair trade when the two
        were 7 + 5 and close in height. Reversed, it stopped being one: the
        Calendar is now both the wider and much the taller card, so stretching
        left roughly 150px of empty card below five Trade rows — the largest
        blank surface on the page, created purely to align an edge nothing
        reads across. A ragged bottom between two cards of genuinely different
        length is the honest shape.
      */}
      <section aria-labelledby="recent-and-calendar-heading" className="mt-6 min-w-0">
        <h2 id="recent-and-calendar-heading" className="sr-only">
          {t('recentAndCalendarSection')}
        </h2>
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-12">
          <RecentTradesCard
            trades={data.recentTrades.items}
            timezone={data.scope.timezone}
            dateLocale={dateLocale}
            className="lg:col-span-5"
          />
          <div className="min-w-0 lg:col-span-7">{calendarSlot}</div>
        </div>
      </section>

      {/*
        D7B — the Risk Performance section, in the layout slot the registry
        has recorded for `account.balance`/`risk.drawdown` since D2 (orders
        120 and 130, after the record list). It is the page's last analytical
        beat: the KPI band, the two baselines and the Execution Gap are all
        expressed in R over the selected range, and this is the one section
        that answers the money question those cannot — where the modeled
        balance actually stands, and how far below its own high-water mark.

        A node rather than data, for the same reason as `calendarSlot`: it is
        its own server boundary and suspends on its own.
      */}
      <div className="mt-6 min-w-0">{riskSlot}</div>

      <div className="mt-4 flex justify-end">
        <Link
          href="/app/analytics"
          className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('viewFullAnalytics')} <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Four independent, informational counts (Phase 14C §18) — never a combined
 * "completeness score" (CLAUDE.md's Discipline Score precedent applies
 * equally here). Each count links to the Journal, where a trader can
 * actually act on it; the panel itself never blocks or nags. Definitions:
 * `openTrades` = `status = 'open'`; `pendingSystemOutcomes` =
 * `system_status = 'pending'`; `unclassifiedTrades` = `strategy_id IS NULL`
 * (Phase 14B); `reviewsPending` = `status = 'closed' AND review_notes IS
 * NULL` — see `getWorkspaceTradeAttentionCounts` (`src/server/dal/trades.ts`)
 * for the exact query.
 *
 * D4.5 geometry: one bar, not a card with a header block and a four-column
 * grid under it. Through D4 this stood 243px tall — taller than the five KPI
 * cards it sits beneath — to say three numbers, and spread them across the
 * full page width.
 *
 * THIS PASS MAKES IT A STRIP AND MAKES IT HOLD ONE ROW AT 1440. D4.5's bar
 * was ~88px at 1920 but WRAPPED at 1440 — the fifth count fell to a second
 * line and dragged the Review action onto a third, which put it back at
 * 215px with a 500px void on the left. The header now has a fixed
 * `lg:w-[17.5rem]` share rather than competing with the counts for width, the
 * counts sit in a `flex-1` row that distributes what is left, the labels drop
 * their uppercase tracking (`MetricLabel`'s `plain` variant — five long
 * labels shouting at once is exactly the case it exists for), and the
 * figures step from `text-xl` to `text-lg`. All five counts plus the action
 * now hold one row from 1024 up, at ~62px.
 *
 * Every count, its label, the title, the supporting sentence and the Review
 * action survive unchanged; the D2 scope (`workspace_operational`) and the
 * "no score, no invented category" rule are untouched.
 *
 * It owns its own layout slot rather than being wrapped in one, because it
 * renders nothing at all when every count is zero — a wrapper would leave a
 * slot's worth of dead vertical space behind on exactly the workspace with
 * nothing to show.
 */
function NeedsAttentionPanel({
  attention,
  className,
}: {
  attention: DashboardPageData['attention']['counts'];
  className?: string;
}) {
  const t = useTranslations('dashboard.real');
  const total =
    attention.openTrades +
    attention.pendingSystemOutcomes +
    attention.unclassifiedTrades +
    attention.reviewsPending +
    attention.needsExecutionDetails;
  if (total === 0) return null;

  const items: readonly { readonly key: string; readonly count: number }[] = [
    { key: 'openTrades', count: attention.openTrades },
    { key: 'pendingSystemOutcomes', count: attention.pendingSystemOutcomes },
    { key: 'unclassifiedTrades', count: attention.unclassifiedTrades },
    { key: 'reviewsPending', count: attention.reviewsPending },
    // Phase 14E — legacy/internal `planned` rows only; zero (and hidden via
    // the `count > 0` filter below) for every workspace with none.
    { key: 'needsExecutionDetails', count: attention.needsExecutionDetails },
  ];

  return (
    <section
      {...dashboardWidgetAttributes(dashboardLayoutItem('review.needs-attention'))}
      aria-labelledby="needs-attention-heading"
      className={cn('min-w-0', className)}
    >
      <Card
        data-dashboard-panel="needs-attention"
        className="flex min-w-0 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
      >
        {/* The header's fixed share came down with the sentence it used to
            carry: a mark plus a three-word title needs ~11rem, not 19, and
            every rem it gives back goes to the counts row beside it. */}
        <div className="flex min-w-0 items-center gap-2.5 lg:w-[12rem] lg:shrink-0 xl:w-[13rem]">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
            <ListChecks className="size-4" aria-hidden="true" />
          </span>
          {/*
            THE SENTENCE MOVED BEHIND THE ⓘ. It was two wrapped lines of pure
            explanation — what the counts are scoped to, and that the strip is
            not a task list — sitting permanently beside five numbers that are
            each already labelled. The benchmark carries no such copy anywhere
            on its Dashboard, and the scope caveat is real methodology rather
            than something a reader needs on every visit, which is precisely
            the split the info affordance exists to make. The text itself is
            unchanged and is now `needsAttention.help`.
          */}
          <div className="flex min-w-0 items-center gap-1">
            <CardTitle id="needs-attention-heading" className="text-sm leading-5">
              {t('needsAttention.title')}
            </CardTitle>
            <MetricInfo
              triggerLabel={t('needsAttention.infoTrigger')}
              title={t('needsAttention.title')}
              description={t('needsAttention.help')}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-2 2xl:gap-x-7">
            {items
              .filter((item) => item.count > 0)
              .map((item) => (
                <div key={item.key} className="flex min-w-0 flex-col">
                  <dt>
                    <MetricLabel variant="plain">{t(`needsAttention.${item.key}`)}</MetricLabel>
                  </dt>
                  <dd className="numeric text-lg leading-6 font-semibold">{item.count}</dd>
                </div>
              ))}
          </dl>
          <Link
            href="/app/trades"
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring -mr-2 inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('needsAttention.review')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </section>
  );
}

export function DashboardDataError() {
  const t = useTranslations('dashboard.real');
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>{t('error.title')}</CardTitle>
        <CardDescription>{t('error.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/app"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('error.retry')}
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Reserves the real Dashboard's geometry while the server payload resolves,
 * and says so.
 *
 * TWO JOBS, TWO LAYERS, DELIBERATELY NOT ONE. The blocks are the geometry
 * contract: the Basic KPI band mirrors the row's own grid and span metadata,
 * every other block is the measured height of the section it stands in for,
 * and the margins between them are the page's own rhythm — so nothing on the
 * page moves when the figures arrive. Over them sits the branded mark, which
 * is the ANSWER to "is this broken or is it working": a wall of grey blocks
 * alone reads as a failed render for the first second or so, and it is
 * exactly that second this mark is for.
 *
 * IT IS THE ARRIVAL HALF OF ONE TRANSITION. `DashboardTransitionOverlay`
 * shows the same mark, in the same place, on the OUTGOING document while a
 * Dashboard state navigation is in flight; this shows it on the incoming one.
 * Because the transport is a native document navigation
 * (`DashboardStateLink`), those really are two different documents — the mark
 * is what makes the seam between them read as one continuous state instead of
 * two unrelated flashes. Neither half invents progress, and neither delays
 * anything.
 *
 * THE COPY IS THE ONE THAT IS TRUE HERE. The overlay says "Updating" because
 * a state change is what put it on screen; this says "Loading", because a
 * fresh document reaching this fallback may equally be a cold first visit,
 * and a cold visit is not an update.
 *
 * ONE ANNOUNCEMENT. `DashboardLoadingStatus` is rendered here and NOT in the
 * Calendar / insight / Risk sub-skeletons, which suspend separately: three
 * live regions resolving at three different moments would announce one user
 * action three times.
 */
export function DashboardSkeleton() {
  const t = useTranslations('dashboard.loading');

  return (
    <div className="flex min-w-0 flex-col">
      <DashboardLoadingStatus message={t('loading')} />
      {/*
        EVERY HEIGHT HERE IS A MEASUREMENT, AND THEY ALL MOVED IN THIS PASS.
        Re-measured on the populated fixture at 1440 after the density work:
        KPI 106 -> 120 (the row's new padding), Needs Attention 78 -> 74 and
        the section heading 38 -> 24 (both lost a description line), Execution
        Gap 493 -> 525 and Risk 616 -> 526 (the two major charts moved to one
        shared plot height), Recent Trades 489 -> 413 (three fields, seven
        44px rows) and Calendar 640 -> 630 (one value per cell). A skeleton
        carrying the old numbers is worse than no skeleton: it reserves a
        geometry the page no longer has and guarantees the jump it exists to
        prevent.

        The blocks are borderless for the same reason the real cards now are —
        they stand in for those cards, and an outlined placeholder resolving
        into an unoutlined card is a visible flicker at the seam.
      */}
      <div className="flex animate-pulse flex-col" aria-hidden="true">
        <div className="bg-card h-[42px] rounded-lg" />
        <div className={cn('mt-4', BASIC_KPI_GRID_CLASS)}>
          {BASIC_KPI_LAYOUT.map((layout) => (
            <div
              key={layout.widgetId}
              className={cn('bg-card h-[120px] rounded-lg', kpiSpanClassName(layout))}
            />
          ))}
        </div>
        <div className="bg-card mt-4 h-[74px] rounded-lg" />
        {/* The section heading above the two baselines is real text on
            arrival, so the skeleton reserves its single line rather than
            letting the cards below jump 24px down when it appears. */}
        <div className="mt-6 flex flex-col gap-4">
          <div className="bg-card h-[24px] w-64 rounded-md" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-card h-[193px] rounded-lg" />
            <div className="bg-card h-[193px] rounded-lg" />
          </div>
        </div>
        <div className="bg-card mt-6 h-[525px] rounded-lg" />
        {/*
          D6B's unequal section, reserved at the geometry it actually renders
          at — five columns of Trade rows beside seven of Calendar. A skeleton
          that reserved two stacked full-width bands would visibly reflow into
          two columns the moment the payload arrived, which is the exact jump a
          skeleton exists to prevent. The two blocks are different heights
          because the real section is `items-start` and genuinely ragged.
        */}
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-12">
          <div className="bg-card h-[413px] rounded-lg lg:col-span-5" />
          <div className="bg-card h-[630px] rounded-lg lg:col-span-7" />
        </div>
        {/* D7's Risk Performance section: one card, a summary strip over a
            chart, at the height it actually renders at. */}
        <div className="bg-card mt-6 h-[526px] rounded-lg" />
      </div>
      {/*
        Fixed and centred in the VIEWPORT, offset past the sidebar by the
        shell's own inherited variable. The skeleton is several viewports
        tall; a mark centred inside it would be off-screen for anyone who has
        scrolled, and dead weight for everyone else.
      */}
      <div className="pointer-events-none fixed inset-0 z-20 grid place-items-center px-4 lg:pl-[var(--shell-workspace-offset)]">
        <DashboardLoadingIndicator tone="overlay" message={t('loading')} detail={t('detail')} />
      </div>
    </div>
  );
}
