'use client';

import { useTranslations } from 'next-intl';

import type { BasicKpiDetail, BasicKpiIndicator, BasicKpiKey } from '@/lib/dashboard/basic-kpi';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The visual indicator on a Basic KPI card, and the breakdown behind it.
 *
 * ONE AFFORDANCE, FOUR SHAPES.
 *
 * Each card's indicator draws a quantity the payload already publishes (see
 * `BasicKpiIndicator` for which, per variant, and why Net P&L has none). The
 * shapes differ on purpose — a ring, a gauge, a split track, a pair of
 * magnitude bars — so five cards in a row do not read as the same widget
 * printed five times. They stay one family because they share a size band, a
 * palette, a trigger treatment and a popover.
 *
 * IT IS A BUTTON, NOT A HOVER TARGET. Everything the cards stopped printing
 * permanently — `27W · 5BE · 34L`, `+2.27R / -1.12R`, the Profit Factor
 * sentence — lives one click, tap, or Enter away. A hover-only tooltip would
 * have made that data unreachable on touch and by keyboard, which is why the
 * project's `Popover` exists (see `components/ui/popover.tsx`).
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. The drawing itself is `aria-hidden`; the
 * button carries a real name ("Show Trade Win breakdown"), and the popover
 * states every figure in words with its own label. A reader who sees no
 * colour at all loses nothing.
 */
export function KpiIndicator({
  metricKey,
  indicator,
  detail,
}: {
  metricKey: BasicKpiKey;
  indicator: BasicKpiIndicator;
  detail: BasicKpiDetail;
}) {
  const t = useTranslations('dashboard.basicKpi');

  if (indicator.kind === 'none') return null;

  const drawing = <IndicatorDrawing indicator={indicator} />;

  // An indicator with nothing to reveal stays a picture rather than becoming
  // a button that opens an empty panel.
  if (detail.kind === 'none') {
    return (
      <span data-kpi-indicator={indicator.kind} className="block">
        {drawing}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        data-kpi-indicator={indicator.kind}
        aria-label={t(`${metricKey}.indicatorTrigger`)}
        className={cn(
          // Negative margin so the 6px hit padding does not widen the card's
          // figure row: the target grows, the layout does not move.
          '-m-1.5 flex shrink-0 cursor-pointer rounded-md p-1.5 transition-colors',
          'hover:bg-muted focus-visible:ring-ring data-[state=open]:bg-muted outline-none focus-visible:ring-2',
        )}
      >
        {drawing}
      </PopoverTrigger>
      <PopoverContent align="end" data-slot="kpi-indicator-content" className="w-60">
        <p className="text-foreground text-sm font-semibold">{t(`${metricKey}.label`)}</p>
        <KpiDetail detail={detail} />
      </PopoverContent>
    </Popover>
  );
}

function IndicatorDrawing({ indicator }: { indicator: BasicKpiIndicator }) {
  switch (indicator.kind) {
    case 'none':
      return null;
    case 'outcomeSplit':
      return indicator.shape === 'gauge' ? (
        <OutcomeGauge
          wins={indicator.wins}
          breakEvens={indicator.breakEvens}
          losses={indicator.losses}
        />
      ) : (
        <OutcomeDonut
          wins={indicator.wins}
          breakEvens={indicator.breakEvens}
          losses={indicator.losses}
        />
      );
    case 'ratioSplit':
      return <RatioSplit winSharePercent={indicator.winSharePercent} />;
    case 'magnitudePair':
      return (
        <MagnitudePair winPercent={indicator.winPercent} lossPercent={indicator.lossPercent} />
      );
  }
}

/**
 * The three arc lengths, in the `pathLength={100}` units both ring shapes use.
 *
 * `pathLength` normalises the geometry so a segment's dash length IS its
 * percentage — no circumference, no π, and the same arithmetic serves a full
 * circle and a half one. Shares are integer counts over an integer total: a
 * partition expressed as parts of itself, never a re-derived metric.
 */
function arcSegments(wins: number, breakEvens: number, losses: number) {
  const total = wins + breakEvens + losses;
  const parts = [
    { key: 'wins', count: wins, stroke: 'var(--positive)' },
    { key: 'breakEvens', count: breakEvens, stroke: 'var(--break-even)' },
    { key: 'losses', count: losses, stroke: 'var(--negative)' },
  ] as const;

  let consumed = 0;
  return parts
    .filter((part) => part.count > 0)
    .map((part) => {
      const length = (part.count / total) * 100;
      const offset = consumed;
      consumed += length;
      return { key: part.key, stroke: part.stroke, length, offset };
    });
}

/** Trade outcomes: a full ring, opening at twelve o'clock. */
function OutcomeDonut({
  wins,
  breakEvens,
  losses,
}: {
  wins: number;
  breakEvens: number;
  losses: number;
}) {
  const segments = arcSegments(wins, breakEvens, losses);

  return (
    <svg viewBox="0 0 36 36" className="size-10 shrink-0" aria-hidden="true" focusable="false">
      <circle
        cx="18"
        cy="18"
        r="15.5"
        pathLength={100}
        fill="none"
        stroke="var(--indicator-track)"
        strokeWidth="5"
      />
      {segments.map((segment) => (
        <circle
          key={segment.key}
          data-kpi-arc={segment.key}
          cx="18"
          cy="18"
          r="15.5"
          pathLength={100}
          fill="none"
          stroke={segment.stroke}
          strokeWidth="5"
          strokeDasharray={`${segment.length} ${100 - segment.length}`}
          strokeDashoffset={-segment.offset}
          transform="rotate(-90 18 18)"
        />
      ))}
    </svg>
  );
}

/**
 * Trading-day outcomes: the same three shares on a half arc.
 *
 * A DIFFERENT SHAPE FOR A DIFFERENT POPULATION, WHICH IS THE POINT. Trade Win
 * % and Day Win % often land within a point or two of each other, and on a
 * data set holding one Trade per day they coincide exactly. Two identical
 * rings side by side would invite the reader to treat them as one figure
 * duplicated; a ring and a gauge keep "per Trade" and "per day" legible as
 * two different questions at a glance.
 */
function OutcomeGauge({
  wins,
  breakEvens,
  losses,
}: {
  wins: number;
  breakEvens: number;
  losses: number;
}) {
  const segments = arcSegments(wins, breakEvens, losses);
  const arc = 'M 4 21 A 17 17 0 0 1 38 21';

  return (
    <svg viewBox="0 0 42 24" className="h-7 w-12 shrink-0" aria-hidden="true" focusable="false">
      <path d={arc} pathLength={100} fill="none" stroke="var(--indicator-track)" strokeWidth="5" />
      {segments.map((segment) => (
        <path
          key={segment.key}
          data-kpi-arc={segment.key}
          d={arc}
          pathLength={100}
          fill="none"
          stroke={segment.stroke}
          strokeWidth="5"
          strokeDasharray={`${segment.length} ${100 - segment.length}`}
          strokeDashoffset={-segment.offset}
        />
      ))}
    </svg>
  );
}

/**
 * Profit Factor: one track split between the winning and losing sides.
 *
 * The split is `PF / (PF + 1)` — see `BasicKpiIndicator` for why that is the
 * published ratio restated rather than a fabricated component. No tick, no
 * percentage label: the number above it is the figure, and this is only its
 * shape.
 */
function RatioSplit({ winSharePercent }: { winSharePercent: number }) {
  return (
    <span
      // Container-sized, like the figure beside it: 56px on a cramped
      // five-across desktop card, 80px once the card can spare it. Both steps
      // grew with the card's new vertical padding, so the indicator keeps
      // reading as a data element rather than as decoration — the benchmark's
      // KPI indicators (donut, partial ring, ratio bar) all carry real mass
      // against their 120px card, and a hairline would not.
      className="flex h-3 w-14 shrink-0 overflow-hidden rounded-full bg-(--indicator-track) @[11rem]/kpi:w-20"
      aria-hidden="true"
    >
      <span
        data-kpi-bar="ratioWin"
        className="bg-positive/85"
        style={{ width: `${winSharePercent}%` }}
      />
      <span data-kpi-bar="ratioLoss" className="bg-negative/85 flex-1" />
    </span>
  );
}

/**
 * Average win against average loss, drawn to scale.
 *
 * Two independent bars rather than one split track, because these are two
 * magnitudes and not two shares of a whole — and because the card next to it
 * already uses a split track, and repeating it here would lose the variety
 * the row was rebuilt for.
 */
function MagnitudePair({ winPercent, lossPercent }: { winPercent: number; lossPercent: number }) {
  return (
    <span className="flex w-14 shrink-0 flex-col gap-2 @[11rem]/kpi:w-20" aria-hidden="true">
      <span className="flex h-2 overflow-hidden rounded-full bg-(--indicator-track)">
        <span
          data-kpi-bar="averageWin"
          className="bg-positive/85 rounded-full"
          style={{ width: `${winPercent}%` }}
        />
      </span>
      <span className="flex h-2 overflow-hidden rounded-full bg-(--indicator-track)">
        <span
          data-kpi-bar="averageLoss"
          className="bg-negative/85 rounded-full"
          style={{ width: `${lossPercent}%` }}
        />
      </span>
    </span>
  );
}

/**
 * The revealed breakdown.
 *
 * Plain words, not the card's old shorthand: "Wins 27", never `27W`. The
 * abbreviations were compact enough to sit under a figure and opaque enough
 * that a reader had to already know the product to decode them, which is the
 * trade this pass reverses.
 */
function KpiDetail({ detail }: { detail: BasicKpiDetail }) {
  const t = useTranslations('dashboard.basicKpi');

  if (detail.kind === 'none') return null;

  if (detail.kind === 'ratio') {
    return (
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
        {t('detail.ratioSentence', { factor: detail.factor })}
      </p>
    );
  }

  const rows =
    detail.kind === 'outcome'
      ? ([
          {
            key: 'wins',
            label: t(detail.unit === 'days' ? 'detail.winningDays' : 'detail.wins'),
            value: String(detail.wins),
            swatch: 'bg-positive',
          },
          {
            key: 'breakEvens',
            label: t(detail.unit === 'days' ? 'detail.breakEvenDays' : 'detail.breakEvens'),
            value: String(detail.breakEvens),
            swatch: 'bg-break-even',
          },
          {
            key: 'losses',
            label: t(detail.unit === 'days' ? 'detail.losingDays' : 'detail.losses'),
            value: String(detail.losses),
            swatch: 'bg-negative',
          },
        ] as const)
      : ([
          {
            key: 'averageWin',
            label: t('detail.averageWin'),
            value: detail.averageWinR,
            swatch: 'bg-positive',
          },
          {
            key: 'averageLoss',
            label: t('detail.averageLoss'),
            value: detail.averageLossR,
            swatch: 'bg-negative',
          },
        ] as const);

  return (
    <dl className="mt-2 flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.key} data-kpi-detail-row={row.key} className="flex items-center gap-2">
          <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', row.swatch)} />
          <dt className="text-muted-foreground min-w-0 text-sm">{row.label}</dt>
          <dd className="numeric text-foreground ml-auto text-sm font-semibold">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
