import { GitCompareArrows } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { DashboardExecutionComparison } from '@/lib/dashboard/execution-comparison';
import { dashboardLayoutItem, dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
import { Card } from '@/components/ui/card';

import {
  CumulativeComparisonChart,
  type ExecutionComparisonChartPoint,
} from './cumulative-comparison-chart';
import { ExecutionGapSummary } from './execution-gap-summary';

const LAYOUT = dashboardLayoutItem('execution.gap');

/**
 * `YYYY-MM-DD` -> a short localised axis label.
 *
 * The date is ALREADY the local calendar date D5A resolved in the workspace's
 * configured analytics timezone, so this only chooses wording — it never
 * re-derives a day from an instant, which is the one way a chart axis can
 * silently disagree with the figures above it.
 *
 * `timeZone: 'UTC'` on a date-only value is not a timezone decision: it stops
 * `Intl` from re-interpreting the midnight this string parses to in the
 * SERVER's zone and shifting the label back a day.
 */
function buildDateLabeller(locale: string): (date: string) => string {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return (date) => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? date : formatter.format(parsed);
  };
}

/**
 * D5 — the Execution Gap section.
 *
 * D4's two cards are INDEPENDENT baselines: System over Population B, Trader
 * over Population A, each answering "what did this side produce" on its own
 * eligible Trades. This section answers the different question that only a
 * paired population can: how much of the System's edge the execution actually
 * captured, and how that difference developed.
 *
 * POPULATION C ONLY, END TO END. Everything on screen comes from
 * `DashboardPageData.comparison` — one server-composed model, no fetch of its
 * own, no second date contract, no formula. The paired totals will not match
 * D4's independent totals and are not meant to: on the deterministic fixture
 * D4 shows +36.25R over 68 System Trades and +23.10R over 66 Trader Trades,
 * while these 64 paired Trades total +35.80R and +22.00R. Reconciling them
 * would destroy the distinction the product exists to make.
 *
 * THREE BEATS, DOWN FROM FIVE. Header, the two headline figures, one
 * cumulative comparison chart. The daily strip and the distribution bar that
 * used to follow are diagnosis rather than detection and are no longer
 * mounted here; see `ExecutionGapBody` for what that did and did not remove.
 * The section still tells one story inside one card, so the eye travels down
 * it once.
 */
export function ExecutionGapSection({
  comparison,
  dateLocale,
  className,
}: {
  comparison: DashboardExecutionComparison;
  dateLocale: string;
  className?: string;
}) {
  const t = useTranslations('dashboard.executionGap');
  const headingId = 'execution-gap-heading';

  return (
    <section
      {...dashboardWidgetAttributes(LAYOUT)}
      aria-labelledby={headingId}
      data-execution-gap-status={comparison.status}
      className={cn('min-w-0', className)}
    >
      <Card data-dashboard-panel="execution-gap" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
        {/*
          The header and the two figures share ONE row from `lg` up.

          They are the same beat — "here is the question, here is the answer" —
          and the section is full width, so stacking them spent an entire 68px
          band on a title with 900px of nothing beside it before the first
          number appeared. Below `lg` they stack.

          With two content-sized cells rather than four stretched ones the row
          is header · figures · ⓘ, and `me-auto` on the figures is what keeps
          the affordance on the far edge without giving either cell width it
          does not need.
        */}
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          {/* The header's fixed share shrank with the sentence it carried —
              a mark and a two-word title, not a mark and a wrapped
              paragraph. */}
          <div className="flex min-w-0 items-center justify-between gap-3 lg:w-[13rem] lg:shrink-0 xl:w-[14rem]">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                <GitCompareArrows className="size-4" aria-hidden="true" />
              </span>
              {/*
                THE DESCRIPTION IS GONE FROM THE FIRST LAYER, AND NOTHING WAS
                LOST WITH IT. `description` read "How much of the System's
                paired edge your execution captured, and how that difference
                developed" — a strictly weaker restatement of `help`, which is
                already one tap away on the ⓘ this header has always carried
                and which says the same thing plus the sign convention and the
                pairing rule. Two texts for one definition, one of them
                permanently occupying card space, is exactly the duplication
                the benchmark's zero-paragraph Dashboard avoids.
              */}
              <div className="min-w-0">
                <h2 id={headingId} className="text-card-title">
                  {t('title')}
                </h2>
              </div>
            </div>
            <div className="lg:hidden">
              <MetricInfo triggerLabel={t('infoTrigger')} title={t('title')}>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('help')}</p>
              </MetricInfo>
            </div>
          </div>

          <ExecutionGapSummary comparison={comparison} className="lg:me-auto" />

          {/* One affordance, rendered on whichever side the layout puts it —
              never two in the DOM at once, which would give a screen reader
              two identical "About Execution Gap" buttons. */}
          <div className="hidden lg:block">
            <MetricInfo triggerLabel={t('infoTrigger')} title={t('title')}>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('help')}</p>
            </MetricInfo>
          </div>
        </div>

        <ExecutionGapBody comparison={comparison} dateLocale={dateLocale} />
      </Card>
    </section>
  );
}

function ExecutionGapBody({
  comparison,
  dateLocale,
}: {
  comparison: DashboardExecutionComparison;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.executionGap');

  // An integrity failure and an empty population are DIFFERENT facts. Saying
  // "no comparable Trades yet" when a stored R failed to parse would send the
  // reader off to record more Trades to fix a problem more Trades cannot fix.
  if (comparison.status === 'error') {
    return (
      <p
        role="alert"
        data-execution-gap-state="error"
        className="border-border bg-muted/40 text-muted-foreground rounded-md border p-3 text-sm leading-relaxed"
      >
        {t('states.error')}
      </p>
    );
  }

  if (comparison.status === 'empty') {
    // No axes, no gridlines, no empty plot frame: a chart of nothing still
    // looks like a chart, and invites the reader to interpret its emptiness.
    return (
      <div
        data-execution-gap-state="empty"
        className="border-border bg-muted/40 flex flex-col gap-1 rounded-md border p-3"
      >
        <p className="text-foreground text-sm font-medium">{t('states.emptyTitle')}</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('states.emptyDescription')}
        </p>
      </div>
    );
  }

  // Labelled HERE, on the server, so the charts receive plain serializable
  // data. A function prop cannot cross the server/client boundary, and the
  // label belongs next to the timezone resolution anyway.
  const labelFor = buildDateLabeller(dateLocale);
  const chartPoints: readonly ExecutionComparisonChartPoint[] = comparison.dailySeries.map(
    (point) => ({ ...point, dateLabel: labelFor(point.date) }),
  );

  /*
    ONE VISUALISATION, DOWN FROM THREE.

    The Daily Gap strip and the Gap Distribution bar are no longer rendered on
    the Dashboard. Both are day-by-day / shape-of-the-population diagnostics —
    DIAGNOSE material — and this section's job is the two headline figures
    above plus the one question a chart answers better than a number can:
    WHEN did the two curves start to diverge?

    NOTHING WAS DELETED. `comparison.dailySeries` and
    `comparison.distribution` are still composed by D5A and still on the
    payload; `daily-gap-chart.tsx` and `gap-distribution.tsx` are still in the
    tree, still typed, still translated, and still correct — they are simply
    not mounted here. That is deliberate: the eventual Analytics
    execution-gap view is where they belong, and deleting working components
    now would only mean rewriting them then. No DTO field was pruned to match
    the UI (§27).

    The screen-reader fallback table keeps every column it had, including the
    per-day gap and the paired count, so removing two visuals removes no
    information from assistive technology.
  */
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="sr-only">{t('chart.cumulativeCaption')}</figcaption>
      {/*
        The legend is the whole of this row now — the daily strip's caption
        that used to sit opposite it went with the strip.

        Identity is never colour alone: each entry names its stroke style, so
        the two lines stay separable in greyscale and under any colour vision.
      */}
      <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
        <LegendItem
          label={t('series.system')}
          note={t('series.systemNote')}
          swatchClassName="bg-primary"
        />
        <LegendItem
          label={t('series.actual')}
          note={t('series.actualNote')}
          swatchClassName="bg-foreground"
        />
      </ul>
      <CumulativeComparisonChart points={chartPoints} />
      <ComparisonFallbackTable points={chartPoints} />
    </figure>
  );
}

function LegendItem({
  label,
  note,
  swatchClassName,
}: {
  label: string;
  note: string;
  swatchClassName: string;
}) {
  return (
    <li className="text-muted-foreground flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', swatchClassName)}
      />
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground/80">({note})</span>
    </li>
  );
}

/**
 * The same numbers as a real table, visually hidden but fully available to a
 * screen reader and to keyboard users.
 *
 * This is the honest answer to "the chart must be accessible": an SVG with
 * ARIA labels bolted on is not navigable, and a tooltip that only opens under
 * a pointer makes essential data pointer-only. The repository already
 * establishes this pattern (`ChartContainer`'s `tableFallback`); this section
 * composes its own figure, so it carries the same obligation directly.
 */
function ComparisonFallbackTable({ points }: { points: readonly ExecutionComparisonChartPoint[] }) {
  const t = useTranslations('dashboard.executionGap');
  const tReal = useTranslations('dashboard.real');
  const cell = (value: string) => {
    const formatted = formatAnalyticsMetric({ status: 'available', value }, 'r');
    return formatted.status === 'available' ? formatted.text : tReal('notAvailableShort');
  };

  return (
    <div className="sr-only">
      <table>
        <caption>{t('chart.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('chart.dateColumn')}</th>
            <th scope="col">{t('chart.pairedColumn')}</th>
            <th scope="col">{t('chart.cumulativeSystemColumn')}</th>
            <th scope="col">{t('chart.cumulativeActualColumn')}</th>
            <th scope="col">{t('chart.cumulativeGapColumn')}</th>
            <th scope="col">{t('chart.dailyGapColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.dateLabel}</th>
              <td>{point.pairedTradeCount}</td>
              <td>{cell(point.cumulativeSystemR)}</td>
              <td>{cell(point.cumulativeActualR)}</td>
              <td>{cell(point.cumulativeExecutionGapR)}</td>
              <td>{cell(point.executionGapR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
