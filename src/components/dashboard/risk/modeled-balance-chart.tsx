'use client';

import { useTranslations } from 'next-intl';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { RiskBalancePoint } from '@/lib/dashboard/risk-performance-presentation';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

/**
 * THE BALANCE SERIES IS AN IDENTITY, NOT A VERDICT.
 *
 * The line is the product's interaction blue at every value. Green would
 * assert that having a balance is good news and would leave nothing to say
 * when the same line falls; positive/negative colour belongs to the signed
 * outcomes beside the chart — Period P&L, and the drawdown readings — not to
 * the identity of the balance itself.
 *
 * The high-water reference is drawn in the neutral muted foreground so it
 * reads as scaffolding rather than as a second data series.
 */
const BALANCE_STROKE = 'var(--primary)';
const PEAK_STROKE = 'var(--muted-foreground)';

interface BalanceTooltipEntry {
  readonly payload?: RiskBalancePoint | undefined;
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: readonly BalanceTooltipEntry[] | undefined;
}) {
  const t = useTranslations('dashboard.riskPerformance');
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (point === undefined) return null;

  /*
    THE THREE EVENT KINDS ARE NOT THE SAME FACT.

    An `opening` anchor is the balance carried INTO this range and an `as_of`
    anchor is where the range currently ends; neither is a Trade, and neither
    gets a P&L line. Labelling all three "Modeled Balance" would invite the
    reader to count two anchors as two more Trades.
  */
  const heading =
    point.kind === 'opening'
      ? t('tooltip.opening')
      : point.kind === 'as_of'
        ? t('tooltip.ending')
        : t('tooltip.balance');

  return (
    <div className="bg-popover text-popover-foreground border-border shadow-popover max-w-60 rounded-md border px-3 py-2">
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">
        {/* An All-range opening has no instant at all: the schema records no
            trustworthy financial inception date, so the anchor is named
            rather than dated. */}
        {point.dateTimeLabel ?? t(`event.${point.kind}`)}
      </p>
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">{heading}</span>
          <span className="numeric text-foreground ml-auto font-semibold">{point.balanceText}</span>
        </li>
        {point.deltaText === null ? null : (
          <li className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">{t('tooltip.change')}</span>
            <span className="numeric text-foreground ml-auto font-semibold">{point.deltaText}</span>
          </li>
        )}
      </ul>
      {point.tradeCount > 1 ? (
        <p className="text-muted-foreground border-border mt-1.5 border-t pt-1.5 text-xs">
          {t('tooltip.groupedTrades', { count: point.tradeCount })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The canonical D7A balance series, drawn as an event-based step.
 *
 * `type="stepAfter"`, never `monotone` or any spline: a modeled closed
 * balance changes at Trade-close realizations and holds flat between them. A
 * curved interpolation would draw a balance the Account never modeled at
 * every instant between two closes, and would imply continuous movement this
 * product has no data for — there is no mark-to-market anywhere in it.
 *
 * NOTHING IS COMPUTED HERE. Every balance, delta and label arrives already
 * formatted from the pure presentation model; this component only maps
 * canonical coordinates onto an SVG. The x-axis is CATEGORICAL over each
 * point's unique key rather than over a timestamp, for two reasons: several
 * Trades can close on one date (a date axis would collide them), and the All
 * range's opening anchor deliberately has no timestamp to place.
 */
export function ModeledBalanceChart({
  points,
  peakBalance,
}: {
  points: readonly RiskBalancePoint[];
  peakBalance: number;
}) {
  const t = useTranslations('dashboard.riskPerformance');
  const prefersReducedMotion = usePrefersReducedMotion();
  const labels = new Map(points.map((point) => [point.key, point.dateLabel]));

  return (
    <div
      className="h-56 w-full min-w-0 sm:h-64 lg:h-72"
      role="img"
      aria-label={t('chart.ariaLabel')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="key"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            // Thin the labels at narrow widths rather than shrinking or
            // rotating them: fewer readable dates beat many unreadable ones,
            // and neither costs the reader a horizontal pan.
            interval="preserveStartEnd"
            minTickGap={48}
            tickFormatter={(key: string) => labels.get(key) ?? ''}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
            /*
              `['auto', 'auto']` EXPLICITLY, because Recharts' default numeric
              domain is `[0, 'auto']` and that is wrong for a balance. The
              first D7B capture pass proved it: a $10,000–$12,420 account was
              plotted against an axis running 0 · 3,500 · 7,000 · 10,500 ·
              14,000, which squeezed every real movement into a flat band at
              the top of the plot. An account's balance is interesting
              relative to itself, not relative to zero — a zero-anchored
              balance chart hides exactly the drawdown this section is about.
            */
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => compactAxisValue(value)}
          />
          {/*
            The high-water mark, taken straight from D7A's single canonical
            `peakBalanceMinor`. No time series is scanned and no running peak
            is recomputed here — this is one scalar drawn as one line. In a
            bounded range that peak can sit above every visible point, which
            is the truthful reading: the mark was set earlier and the Account
            has not returned to it.

            No inline label. Recharts renders one as a filled box straddling
            the line, which in the first capture pass sat directly on top of
            the plotted balance and hid it. The legend above the chart names
            this stroke and its dash style, which is where the identification
            belongs anyway.
          */}
          <ReferenceLine
            y={peakBalance}
            stroke={PEAK_STROKE}
            strokeDasharray="4 4"
            strokeWidth={1}
            ifOverflow="extendDomain"
          />
          <Tooltip
            content={<BalanceTooltip />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Line
            type="stepAfter"
            dataKey="balance"
            stroke={BALANCE_STROKE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={!prefersReducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Axis ticks only.
 *
 * Recharts hands this the gridline coordinate it chose, which is not a stored
 * figure and has no canonical string — so this is the one place on the section
 * where a balance is rendered without one. It is deliberately unit-less: the
 * currency symbol belongs on the exact figures in the summary and the tooltip,
 * both of which come from canonical minor units.
 *
 * Grouped integers up to 100,000 rather than a rounded `k`: a balance chart's
 * whole range is often narrower than one thousand, and ticks of `10k · 11k ·
 * 11k · 12k` would print the same label for different gridlines.
 */
function compactAxisValue(value: number): string {
  if (!Number.isFinite(value)) return '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${trimTrailingZero(value / 1_000_000)}M`;
  if (magnitude >= 100_000) return `${trimTrailingZero(value / 1_000)}k`;
  return groupInteger(Math.round(value));
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function groupInteger(value: number): string {
  const negative = value < 0;
  const digits = Math.abs(value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}
