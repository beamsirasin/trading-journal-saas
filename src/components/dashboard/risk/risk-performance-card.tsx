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
              {/* The two definitions that used to be printed on the card
                  itself: what the Peak figure is, and how the balance line
                  steps. Same wording, one tap away instead of permanently
                  occupying two lines of a card that carries seven figures. */}
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t('peakHint')}</p>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {t('chart.caption')}
              </p>
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
      <div className="grid min-w-0 gap-4 lg:grid-cols-12 lg:gap-6">
        <div
          {...dashboardWidgetAttributes(BALANCE_LAYOUT)}
          className="flex min-w-0 flex-col gap-2 lg:col-span-7"
        >
          {/*
            R2C §32 — the account STATE is the answer this section leads with,
            so it takes the page's raised-surface treatment (see
            `PerformanceCard`): Modeled Balance and the Period P&L that
            produced it sit one plane above the card, and the drawdown
            readings beside them stay on the card as the supporting column
            they are. The chart below remains secondary to both.
          */}
          <dl className="bg-muted/50 grid min-w-0 grid-cols-1 gap-3 rounded-lg px-3 py-2.5 sm:grid-cols-2 sm:gap-6">
            <HeroMetric
              metricKey="modeledBalance"
              label={t('metrics.modeledBalance')}
              value={view.modeledBalanceText}
              tone="neutral"
            />
            <HeroMetric
              metricKey="periodPnl"
              label={t('metrics.periodPnl')}
              value={view.periodNetPnl.text}
              tone={view.periodNetPnl.tone}
            />
          </dl>
          {/*
            §5 — THE ENDING BALANCE IS NOT "STARTING BALANCE + WHAT YOU SEE".

            A bounded window carries real history into its opening state, so
            30D showing $12,310 beside +$1,040 must never be read as a period
            that began at the Starting Balance. This line states the carried
            opening explicitly, which is the one sentence that makes the two
            hero figures reconcile.
          */}
          <p className="text-muted-foreground text-xs leading-4">
            {t(`opening.${view.opening.kind}`, { balance: view.opening.balanceText })}
          </p>
        </div>

        <div
          {...dashboardWidgetAttributes(DRAWDOWN_LAYOUT)}
          className="border-border flex min-w-0 flex-col gap-2 border-t pt-4 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3">
            <DrawdownMetric
              metricKey="currentDrawdown"
              label={t('metrics.currentDrawdown')}
              drawdown={view.currentDrawdown}
            />
            <DrawdownMetric
              metricKey="maxDrawdown"
              label={t('metrics.maxDrawdown')}
              drawdown={view.maxDrawdown}
            />
            {/*
              Peak is SUPPORTING CONTEXT, not a fifth hero and not a card of
              its own: it is the high-water mark the two figures above are
              measured from, so it sits with them, smaller.
            */}
            <div
              data-risk-metric="peakBalance"
              className="col-span-2 flex min-w-0 flex-col gap-0.5"
            >
              <dt>
                <MetricLabel variant="plain">{t('metrics.peakBalance')}</MetricLabel>
              </dt>
              <dd className="numeric text-foreground text-base font-semibold">
                {view.peakBalanceText}
              </dd>
              {/* `peakHint` — "the high-water mark both drawdowns are measured
                  from" — is a definition of the figure above it, sitting
                  permanently beside two figures that already say Drawdown. It
                  is now the third paragraph of this card's info popover. */}
            </div>
          </dl>
        </div>
      </div>

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
      {/* Identity is never colour alone: each entry names its series AND its
          stroke style, so the balance and its high-water reference stay
          separable in greyscale, in print, and under any colour vision. */}
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
        <li className="text-muted-foreground text-xs">
          {t('closedTrades', { count: view.closedTradeCount })}
        </li>
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
 * §11 — colour is never the only cue and never the whole card.
 *
 * A drawdown that exists is tinted with the restrained negative foreground;
 * a drawdown of exactly zero is neutral, because "you are at your high-water
 * mark" is not bad news. Either way the amount and the percentage are read as
 * text, there is no red panel, no gauge, and no score.
 */
function DrawdownMetric({
  metricKey,
  label,
  drawdown,
}: {
  metricKey: string;
  label: string;
  drawdown: RiskDrawdownView;
}) {
  const tReal = useTranslations('dashboard.real');

  return (
    <div
      data-risk-metric={metricKey}
      data-risk-drawdown={drawdown.isZero ? 'zero' : 'active'}
      className="flex min-w-0 flex-col gap-1"
    >
      <dt>
        <MetricLabel variant="plain" className="break-words">
          {label}
        </MetricLabel>
      </dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'numeric text-xl font-semibold tracking-tight break-words',
            drawdown.isZero ? 'text-foreground' : 'text-negative',
          )}
        >
          {drawdown.amountText}
        </span>
        {/*
          D7A returns a typed unavailable percentage when the reference peak
          is not positive. Rendering `0%` there would state a ratio that was
          deliberately not published.
        */}
        <span className="text-muted-foreground numeric text-xs">
          {drawdown.percentageText ?? tReal('notAvailableShort')}
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
