import { Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsDatePreset } from '@/lib/analytics/filters';
import type {
  RiskDrawdownView,
  RiskMoneyTone,
  RiskPerformanceAvailableView,
  RiskPerformanceView,
} from '@/lib/dashboard/risk-performance-presentation';
import { dashboardLayoutItem, dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
import { MetricLabel } from '@/components/product/metric';
import { Card } from '@/components/ui/card';

import { ModeledBalanceChart } from './modeled-balance-chart';

const BALANCE_LAYOUT = dashboardLayoutItem('account.balance');
const DRAWDOWN_LAYOUT = dashboardLayoutItem('risk.drawdown');

const RANGE_KEY: Record<
  AnalyticsDatePreset,
  | 'rangeToday'
  | 'rangeWeek'
  | 'rangeMonth'
  | 'range30'
  | 'range90'
  | 'rangeQuarter'
  | 'rangeYtd'
  | 'rangeAll'
  | 'rangeCustom'
> = {
  today: 'rangeToday',
  week: 'rangeWeek',
  month: 'rangeMonth',
  '30d': 'range30',
  '90d': 'range90',
  quarter: 'rangeQuarter',
  ytd: 'rangeYtd',
  all: 'rangeAll',
  custom: 'rangeCustom',
};

const TONE_CLASS: Record<RiskMoneyTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

/**
 * D7 — the Risk Performance section.
 *
 * ONE SECTION, TWO REGISTRY IDS, ONE PAYLOAD. `account.balance` and
 * `risk.drawdown` are genuinely different capabilities, but they answer one
 * question together: where the modeled balance stands, and how far below its
 * own high-water mark it is standing. Two large disconnected cards would make
 * the reader hold a balance in their head while reading a distance measured
 * from a peak that is not on screen, so they share a section, a header, and
 * the single `RiskPerformanceData` the D7A boundary returns.
 *
 * DASHBOARD DETECTS; ANALYTICS EXPLAINS. There is no underwater drawdown
 * chart, no episode table, no duration analytics, no Ulcer/Sharpe/Sortino,
 * and no recovery factor here. Those are Risk Analytics, and inventing them
 * on the Dashboard would need formulas nothing in this repository has
 * approved.
 *
 * NOTHING BELOW COMPUTES ANYTHING. Every figure is a canonical D7A value that
 * `composeRiskPerformanceView` formatted once on the server.
 */
export function RiskPerformanceCard({
  view,
  className,
}: {
  view: RiskPerformanceView;
  className?: string;
}) {
  const t = useTranslations('dashboard.riskPerformance');
  const headingId = 'risk-performance-heading';

  return (
    <section
      data-dashboard-section="risk-performance"
      data-risk-status={view.status}
      {...(view.status === 'available' ? {} : { 'data-risk-reason': view.reason })}
      aria-labelledby={headingId}
      className={cn('min-w-0', className)}
    >
      <Card
        data-dashboard-panel="risk-performance"
        className="flex min-w-0 flex-col gap-4 p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Wallet className="size-4" aria-hidden="true" />
            </span>
            {/* "Modeled balance and drawdown for {account}" named the two
                metrics the card's own labels name 40px below, and the account
                the toolbar, the context strip and the range chip beside it all
                name already. Title and affordance, per the benchmark's header
                composition. */}
            <h2 id={headingId} className="text-card-title min-w-0 truncate">
              {t('title')}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {view.status === 'available' ? <RangeChip preset={view.datePreset} /> : null}
            {/*
              A real button, not a hover tooltip: the limitations of a modeled
              balance are the kind of thing a reader must be able to reach by
              keyboard and on touch, not only with a pointer.
            */}
            <MetricInfo triggerLabel={t('infoTrigger')} title={t('metrics.modeledBalance')}>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('help')}</p>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t('helpScope')}</p>
              {/* The definitions that used to be printed on the card itself.
                  Same wording, one tap away instead of permanently occupying
                  lines of a card that led with five figures. */}
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t('peakHint')}</p>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {t('chart.caption')}
              </p>
              {/*
                THE FIGURES THAT LEFT THE FACE, STATED HERE WITH THEIR VALUES.

                Peak Balance, Max Drawdown and the closed-Trade count are all
                still canonical D7 payload; this is where a reader who wants
                them finds them, and there is no money-Risk Analytics view to
                send them to yet. Only rendered on the available state — an
                unavailable card has no figures to state.
              */}
              {view.status === 'available' ? <RiskInfoFigures view={view} /> : null}
            </MetricInfo>
          </div>
        </div>

        {view.status === 'available' ? (
          <AvailableBody view={view} />
        ) : view.status === 'unavailable' ? (
          <StateBlock
            state="unavailable"
            title={t(`states.unavailable.${view.reason}.title`)}
            description={t(`states.unavailable.${view.reason}.description`)}
          />
        ) : (
          /*
            An integrity or service failure is NOT a product limitation. It is
            announced, and its copy never says "no data" — telling a reader
            there is nothing to show would send them off to record more Trades
            to fix something more Trades cannot fix.
          */
          <StateBlock
            state="error"
            title={t(`states.error.${view.reason}.title`)}
            description={t(`states.error.${view.reason}.description`)}
          />
        )}
      </Card>
    </section>
  );
}

function AvailableBody({ view }: { view: RiskPerformanceAvailableView }) {
  const t = useTranslations('dashboard.riskPerformance');

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/*
        7 + 5 of the section's twelve columns, exactly as the layout metadata
        records. Mobile source order is Modeled Balance, Period P&L, then the
        two drawdown readings and the peak they are measured from — the
        priority a 320px screen has to honour before anything else.
      */}
      {/*
        TWO FIGURES, AND THEY ANSWER THE SECTION'S ONE QUESTION: where is my
        modeled capital now, and how far is it below its high-water mark?

        PERIOD P&L LEFT THE FACE BECAUSE IT IS INDISTINGUISHABLE FROM THE KPI
        ROW'S NET P&L WITHOUT A SENTENCE. Both sum the SAME authoritative
        `net_pnl_minor` over closed, non-deleted Trades in the same date
        range, so on a default Dashboard they are the same number printed
        twice — the populated fixture shows +$2,310.00 in both. They are not
        the same metric: the KPI additionally requires `actual_r` and
        `trader_outcome` and DOES follow the Strategy/Setup/Version filters,
        while Risk requires neither and deliberately ignores those filters
        (`analyticalFilters.effect: 'not_applied_to_account_balance'`). So the
        two silently diverge the moment a framework filter is applied, and
        nothing short of a paragraph can tell a reader when that has happened.
        A number that is usually a duplicate and occasionally a different
        thing, with no visible cue for which, is worse than no number.
        `periodNetPnlMinor` is untouched on the payload.

        PEAK BALANCE LEFT TOO: the chart's dashed reference line already IS
        the high-water mark, so the figure restated a line the reader can see.
        MAX DRAWDOWN left because it answers "what was the worst stretch in
        this window" — diagnosis, and range-dependent besides ($790 over All
        time, $455 over 30D on the same fixture). Both remain on the payload
        and are stated in the info popover.
      */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:gap-6">
        <div
          {...dashboardWidgetAttributes(BALANCE_LAYOUT)}
          className="bg-muted/50 flex min-w-0 flex-col rounded-lg px-3 py-2.5"
        >
          <HeroMetric
            metricKey="modeledBalance"
            label={t('metrics.modeledBalance')}
            value={view.modeledBalanceText}
            tone="neutral"
          />
        </div>
        <div
          {...dashboardWidgetAttributes(DRAWDOWN_LAYOUT)}
          className="bg-muted/50 flex min-w-0 flex-col rounded-lg px-3 py-2.5"
        >
          <CurrentDrawdownMetric drawdown={view.currentDrawdown} />
        </div>
      </div>

      {/*
        THE CARRIED-OPENING GUARD, AND ONLY WHEN IT IS LOAD-BEARING.

        A bounded window carries real history into its opening state, so a
        30D card reading $12,310 must never be taken for a period that began
        at the Starting Balance — and the high-water mark the drawdown is
        measured against may have been set before the window opens. That is
        the one sentence a reader cannot reconstruct from the card.

        `kind: 'all'` needs no such warning: nothing was carried, the opening
        IS the declared Starting Balance, and that fact is in the info
        popover. Printing it permanently spent a line saying "this is the
        normal case".
      */}
      {view.opening.kind === 'all' ? null : (
        <p
          data-risk-opening={view.opening.kind}
          className="text-muted-foreground text-xs leading-4"
        >
          {t(`opening.${view.opening.kind}`, { balance: view.opening.balanceText })}
        </p>
      )}

      {/*
        §13 — the note appears only when a Strategy/Setup/Version filter is
        actually active. Standing copy that explains a filter nobody applied
        is clutter; the same fact is always available in the info popover.
      */}
      {view.showsAnalyticalScopeNote ? (
        <p
          data-risk-scope-note
          className="border-border bg-muted/40 text-muted-foreground rounded-md border p-3 text-xs leading-relaxed"
        >
          {t('scopeNote')}
        </p>
      ) : null}

      {view.hasClosedTrades ? (
        <BalanceFigure view={view} />
      ) : (
        /*
          §16 — an Account with a Starting Balance and no closed Trades is
          AVAILABLE, not empty and certainly not an error: every figure above
          is true. A full-height chart of one flat line carries no information
          the sentence below does not, so it is not drawn.
        */
        <div
          data-risk-state="no-trades"
          className="border-border bg-muted/40 flex flex-col gap-1 rounded-md border p-3"
        >
          <p className="text-foreground text-sm font-medium">{t('states.noTradesTitle')}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('states.noTradesDescription')}
          </p>
        </div>
      )}
    </div>
  );
}

function BalanceFigure({ view }: { view: RiskPerformanceAvailableView }) {
  const t = useTranslations('dashboard.riskPerformance');

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="sr-only">{t('chart.ariaLabel')}</figcaption>
      {/*
        THE LEGEND STAYS; THE COUNT BESIDE IT DOES NOT.

        Identity is never colour alone: each entry names its series AND its
        stroke style, so the balance and its high-water reference stay
        separable in greyscale, in print, and under any colour vision. A
        reader must never have to memorise which line is which, so this is
        the one piece of chart chrome that earns permanent space.

        The closed-Trade count rode along in the same row and is not chart
        identity — it is sample context, which now sits in the info popover
        with the other figures the face stopped printing.
      */}
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <LegendItem
          label={t('chart.legendBalance')}
          style="solid"
          swatchClassName="bg-primary h-0.5 rounded-full"
        />
        <LegendItem
          label={t('chart.legendPeak')}
          style="dashed"
          swatchClassName="border-muted-foreground border-t-2 border-dashed"
        />
      </ul>
      <ModeledBalanceChart points={view.points} peakBalance={view.peakBalance} />
      {/* The caption moved into the card's info popover. It explained how the
          line is CONSTRUCTED — a methodology note, not a reading of the
          chart — and the benchmark's charts carry no standing prose at all,
          only an ⓘ and a hover tooltip. */}
      <BalanceFallbackTable view={view} />
    </figure>
  );
}

/**
 * The same series as a real table — visually hidden, fully available to a
 * screen reader and to keyboard users.
 *
 * This is the honest answer to "the chart must be accessible": a tooltip that
 * only opens under a pointer makes the per-point figures pointer-only. The
 * repository already establishes this pattern in `ChartContainer` and in the
 * D5 comparison figure; this section composes its own figure, so it carries
 * the same obligation directly.
 */
function BalanceFallbackTable({ view }: { view: RiskPerformanceAvailableView }) {
  const t = useTranslations('dashboard.riskPerformance');

  return (
    <div className="sr-only">
      <table>
        <caption>{t('chart.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('chart.eventColumn')}</th>
            <th scope="col">{t('chart.dateColumn')}</th>
            <th scope="col">{t('chart.balanceColumn')}</th>
            <th scope="col">{t('chart.changeColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {view.points.map((point) => (
            <tr key={point.key}>
              {/* The event kind is stated in words, so an anchor is never
                  read as a Trade that did not happen. */}
              <th scope="row">{t(`event.${point.kind}`)}</th>
              <td>{point.dateTimeLabel ?? t(`event.${point.kind}`)}</td>
              <td>{point.balanceText}</td>
              <td>{point.deltaText ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegendItem({
  label,
  style,
  swatchClassName,
}: {
  label: string;
  style: 'solid' | 'dashed';
  swatchClassName: string;
}) {
  const tCommon = useTranslations('common');
  return (
    <li className="text-muted-foreground flex items-center gap-2 text-xs">
      {/* A short rule rather than a square, so the swatch itself shows the
          stroke the reader is being asked to find on the plot. */}
      <span aria-hidden="true" className={cn('inline-block w-4 shrink-0', swatchClassName)} />
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground/80">
        ({style === 'dashed' ? tCommon('dashedLine') : tCommon('solidLine')})
      </span>
    </li>
  );
}

function RangeChip({ preset }: { preset: AnalyticsDatePreset }) {
  const t = useTranslations('dashboard.riskPerformance');
  const tFilters = useTranslations('dashboard.filters');
  return (
    // §14 — a LABEL, not a second control. Risk Performance follows the one
    // Dashboard date-range control that already exists above it.
    <span
      data-risk-range={preset}
      className="border-border bg-muted/50 text-muted-foreground rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap"
    >
      <span className="sr-only">{t('rangeLabel')}: </span>
      {tFilters(RANGE_KEY[preset])}
    </span>
  );
}

function HeroMetric({
  metricKey,
  label,
  value,
  tone,
}: {
  metricKey: string;
  label: string;
  value: string;
  tone: RiskMoneyTone;
}) {
  return (
    <div data-risk-metric={metricKey} className="flex min-w-0 flex-col gap-1">
      <dt>
        <MetricLabel variant="plain">{label}</MetricLabel>
      </dt>
      <dd
        className={cn(
          'numeric text-2xl font-semibold tracking-tight break-words',
          TONE_CLASS[tone],
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The three figures the simplified face no longer prints, with their values.
 *
 * Deliberately values and not just definitions: "Max Drawdown answers a
 * different question" is only half an answer if the reader then cannot see
 * what it was. There is no money-Risk Analytics destination today (Analytics'
 * `maximumDrawdownR` is R over a different population, not this), so this
 * popover is the only home these have — recorded as product debt rather than
 * quietly dropped.
 */
function RiskInfoFigures({ view }: { view: RiskPerformanceAvailableView }) {
  const t = useTranslations('dashboard.riskPerformance');
  const tReal = useTranslations('dashboard.real');

  return (
    <dl className="mt-3 flex flex-col gap-1.5">
      <div data-risk-info="peakBalance" className="text-muted-foreground text-xs leading-relaxed">
        {t('infoPeak', { balance: view.peakBalanceText })}
      </div>
      <div data-risk-info="maxDrawdown" className="text-muted-foreground text-xs leading-relaxed">
        {t('infoMaxDrawdown', {
          amount: view.maxDrawdown.amountText,
          percentage: view.maxDrawdown.percentageText ?? tReal('notAvailableShort'),
        })}
      </div>
      <div data-risk-info="closedTrades" className="text-muted-foreground text-xs leading-relaxed">
        {t('infoClosedTrades', { count: view.closedTradeCount })}
      </div>
    </dl>
  );
}

/**
 * §11 — colour is never the only cue and never the whole card.
 *
 * THE PERCENTAGE LEADS AND THE MONEY SUPPORTS IT, which reverses how this
 * rendered before. A drawdown percentage is scale-independent — 0.89% means
 * the same thing on a small account and a large one — while the amount alone
 * means nothing without the balance it came off. The amount stays, named as
 * what it is (how far below the peak), so neither figure has to be inferred.
 *
 * A drawdown that exists is tinted with the restrained negative foreground;
 * a drawdown of exactly zero is neutral, because "you are at your high-water
 * mark" is not bad news. There is no red panel, no gauge, and no score.
 *
 * ZERO IS A STATED STATUS, NOT A BARE ZERO. A card reading 0.00% above
 * $0.00 looks like missing data, especially on a section whose other states
 * genuinely ARE unavailable — so the zero case says so in words. It
 * deliberately does not say "no risk", "safe" or "perfect": standing at the
 * high-water mark says nothing whatever about the risk of the next Trade.
 */
function CurrentDrawdownMetric({ drawdown }: { drawdown: RiskDrawdownView }) {
  const t = useTranslations('dashboard.riskPerformance');
  const tReal = useTranslations('dashboard.real');

  return (
    <div
      data-risk-metric="currentDrawdown"
      data-risk-drawdown={drawdown.isZero ? 'zero' : 'active'}
      className="flex min-w-0 flex-col gap-1"
    >
      <dt>
        <MetricLabel variant="plain" className="break-words">
          {t('metrics.currentDrawdown')}
        </MetricLabel>
      </dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'numeric text-2xl font-semibold tracking-tight break-words',
            drawdown.isZero ? 'text-foreground' : 'text-negative',
          )}
        >
          {/*
            D7A returns a typed unavailable percentage when the reference peak
            is not positive. Rendering `0%` there would state a ratio that was
            deliberately not published — the amount below still carries the
            fact.
          */}
          {drawdown.percentageText ?? tReal('notAvailableShort')}
        </span>
        <span data-risk-drawdown-detail className="text-muted-foreground text-xs leading-4">
          {drawdown.isZero ? t('atHighWaterMark') : t('belowPeak', { amount: drawdown.amountText })}
        </span>
      </dd>
    </div>
  );
}

/**
 * One block, two distinct facts. `unavailable` is a product limitation the
 * reader may be able to act on; `error` is a failure they cannot, which is why
 * only the latter is announced.
 */
function StateBlock({
  state,
  title,
  description,
}: {
  state: 'unavailable' | 'error';
  title: string;
  description: string;
}) {
  return (
    <div
      {...(state === 'error' ? { role: 'alert' } : {})}
      data-risk-state={state}
      className="border-border bg-muted/40 flex flex-col gap-1 rounded-md border p-3"
    >
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  );
}
