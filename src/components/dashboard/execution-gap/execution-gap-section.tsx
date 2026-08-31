import { GitCompareArrows } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import {
  composeComparisonTable,
  composeComparisonTablePrecision,
} from '@/lib/dashboard/comparison-table';
import type { DashboardExecutionComparison } from '@/lib/dashboard/execution-comparison';
import { dashboardLayoutItem, dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
import { Card } from '@/components/ui/card';

import { ComparisonTable } from './comparison-table';
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
 * THE SYSTEM-VERSUS-TRADER CARD.
 *
 * One card where the Dashboard used to carry three: a System baseline, a
 * Trader baseline, and this Execution Gap section under a floating
 * "System vs Trader performance" heading. Between them they said one thing
 * three times — the two baselines printed the same three metric names twice
 * with no relationship stated, and the Gap then restated the difference the
 * reader had already been asked to compute by eye across a 24px gutter.
 *
 * THE MERGE IS ONLY HONEST BECAUSE OF THE POPULATION. The two baselines
 * counted Populations B and A: different completeness contracts, each
 * date-anchored to its own exit column, differing by six Trades on the
 * reference fixture. Putting those two sets of figures in one table would
 * have invited a subtraction of numbers that were never counted over the
 * same Trades. Every row here reads `pairedSystemAxis` and
 * `pairedActualAxis` — both Population C, both composed by the same
 * `composePerformanceAxis` the baselines used — so the difference column is
 * like for like. The note under the table says what that pinning cost.
 *
 * POPULATION C ONLY, END TO END. Everything on screen comes from
 * `DashboardPageData.comparison` — one server-composed model, no fetch of its
 * own, no second date contract, no formula. The paired totals do not match
 * what the retired baselines showed and are not meant to: 35.80R and 22.00R
 * here, against +36.25R over 68 System Trades and +23.10R over 66 Trader
 * Trades. Reconciling them would destroy the distinction the product exists
 * to make.
 *
 * A RAIL AND A PLOT, NOT TWO BANDS. The table is a fixed 21rem beside the
 * chart rather than a full-width block above it, for the reason every wide
 * card on this page now follows: three metric names and nine figures have a
 * size of their own, and a share of a 1750px card is not it.
 *
 * The daily strip and the distribution bar remain unmounted — diagnosis
 * rather than detection. See `ExecutionGapBody` for what that did and did
 * not remove.
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
          NAME ON THE LEFT, THE CARD'S ANSWER ON THE RIGHT.

          Execution Gap and System Edge Captured stay in the header rather
          than becoming table rows: they are not row-level facts, they are
          the conclusion, and a reader who takes one thing from this card
          should take those. The table below is the working that produces
          them. Both were briefly slated to move into the table's third
          column; they came back here once that column became a plain
          difference, which cannot express a captured RATIO.

          One `MetricInfo` in the DOM, not one per breakpoint — two would
          give a screen reader the same button twice.
        */}
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
              <GitCompareArrows className="size-4" aria-hidden="true" />
            </span>
            <h2 id={headingId} className="text-card-title min-w-0 truncate">
              {t('title')}
            </h2>
          </div>

          <div className="flex min-w-0 items-start gap-2 sm:shrink-0">
            <ExecutionGapSummary comparison={comparison} />
            <ComparisonInfo comparison={comparison} />
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
  const rows = composeComparisonTable(comparison.summary);

  return (
    <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
      {/*
        THE TABLE IS A RAIL, THE PLOT TAKES THE REST.

        21rem is what three metric names and nine right-aligned figures need
        — `Avg Win / Loss` is the widest label and `-13.80R` the widest cell.
        A fraction of the card would hand the table the surplus again at
        2560, which is the mistake this pass exists to undo. Below `lg` they
        stack and the table goes full width, which is the right shape for a
        table in a narrow column.
      */}
      <ComparisonTable
        rows={rows}
        exclusions={comparison.exclusions}
        className="lg:w-[21rem] lg:shrink-0"
      />

      <figure className="flex min-w-0 flex-1 flex-col gap-2">
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
    </div>
  );
}

/**
 * The card's one affordance, and where the arithmetic lives.
 *
 * Three things a reader can legitimately want and none of which belong on
 * the face: what Execution Gap means, why these totals differ from the ones
 * the two baseline cards used to show, and the canonical figures behind a
 * table that rounds to two places. The third exists because the difference
 * column is rounded once from the difference rather than computed from the
 * rounded figures (CLAUDE.md §5), so a reader checking the subtraction by
 * eye can land one unit out in the last place and deserves to be able to
 * confirm that rather than file a bug.
 */
function ComparisonInfo({ comparison }: { comparison: DashboardExecutionComparison }) {
  const t = useTranslations('dashboard.executionGap');
  const rows = composeComparisonTable(comparison.summary);
  const precision = composeComparisonTablePrecision(rows);
  const unavailable = t('precision.unavailable');

  return (
    <MetricInfo triggerLabel={t('infoTrigger')} title={t('title')}>
      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('help')}</p>
      {comparison.summary.comparableCount > 0 ? (
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {t('populationNote', { count: comparison.summary.comparableCount })}
        </p>
      ) : null}
      <p className="text-foreground mt-3 text-xs font-semibold">{t('precision.heading')}</p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{t('precision.note')}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {precision.map((row) => (
          <li key={row.key} className="numeric text-muted-foreground text-xs leading-4">
            {t('precision.row', {
              metric: t(`table.row.${row.key}`),
              system: row.system ?? unavailable,
              actual: row.actual ?? unavailable,
              delta: row.delta ?? unavailable,
            })}
          </li>
        ))}
      </ul>
    </MetricInfo>
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
