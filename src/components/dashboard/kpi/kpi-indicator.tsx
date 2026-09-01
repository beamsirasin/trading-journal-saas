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
 * shapes differ on purpose — a ring, a sparkline, a split track, a zero-centred
 * deflection — so four cards in a row do not read as the same widget printed
 * four times. They stay one family because they share a size band, a palette, a
 * trigger treatment and a popover.
 *
 * IT IS A BUTTON WHERE IT HAS SOMETHING TO SAY. The two cards carrying a
 * breakdown — the Win Rate composition and the Avg Planned RR sentence — open
 * it from a click, a tap, or Enter; a hover-only tooltip would have made that
 * data unreachable on touch and by keyboard, which is why the project's
 * `Popover` exists (see `components/ui/popover.tsx`). The two whose figure
 * already says everything the drawing does stay a plain picture rather than
 * becoming a button that opens an empty panel.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. The drawing itself is `aria-hidden`; where
 * there is a button it carries a real name ("Show Win Rate breakdown"), and the
 * popover states every figure in words with its own label. A reader who sees no
 * colour at all loses nothing — every indicator here restates something the
 * card's own text already carries.
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
      return (
        <OutcomeDonut
          wins={indicator.wins}
          breakEvens={indicator.breakEvens}
          losses={indicator.losses}
        />
      );
    case 'cumulativeR':
      return <CumulativeRSparkline tone={indicator.tone} points={indicator.points} />;
    case 'riskRewardSplit':
      return <RiskRewardSplit riskSharePercent={indicator.riskSharePercent} />;
    case 'divergingBar':
      return <DivergingBar direction={indicator.direction} fillPercent={indicator.fillPercent} />;
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
 * Cumulative ACTUAL R across the scoped population.
 *
 * A POLYLINE, NOT A CHART. There is no axis, no grid, no label, no dot and no
 * tooltip: at 56px wide none of them would be legible, and the figure beside
 * it is where the value is read. What the shape adds is the one thing the
 * total cannot say — whether it arrived steadily, gave most of itself back, or
 * turned around late.
 *
 * `preserveAspectRatio="none"` stretches the normalised 0–100 box to whatever
 * width the card gives, and `vector-effect` keeps the stroke at its real
 * weight through that stretch. The colour is the ENDING sign's semantic token,
 * which is the same sign the figure above carries, so the two cannot disagree.
 */
function CumulativeRSparkline({
  tone,
  points,
}: {
  tone: 'positive' | 'negative' | 'neutral';
  points: readonly { readonly x: number; readonly y: number }[];
}) {
  const stroke =
    tone === 'positive'
      ? 'var(--positive)'
      : tone === 'negative'
        ? 'var(--negative)'
        : 'var(--subtle-foreground)';

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      // The same 56/80px width band as the two bars on this row, at the ring's
      // height, so all four indicators occupy one visual footprint.
      className="h-6 w-14 shrink-0 @[11rem]/kpi:w-20"
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        data-kpi-spark="cumulativeR"
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Avg Planned RR: one track split between planned risk and planned reward.
 *
 * Risk on the left because that is the side a plan commits first, and because
 * left-to-right then reads as the ratio does: 1 of risk, then the reward it
 * was aimed at. The split is `1 / (1 + RR)` — see `BasicKpiIndicator` for why
 * that is the published ratio restated rather than a fabricated component. No
 * tick and no label inside it: the number above it is the figure, and this is
 * only its shape.
 *
 * Geometry unchanged from the split track this replaces — 12px over the same
 * 56/80px container-sized width band, so the row's footprint does not move.
 */
function RiskRewardSplit({ riskSharePercent }: { riskSharePercent: number }) {
  return (
    <span
      className="flex h-3 w-14 shrink-0 overflow-hidden rounded-full bg-(--indicator-track) @[11rem]/kpi:w-20"
      aria-hidden="true"
    >
      <span
        data-kpi-bar="plannedRisk"
        className="bg-negative/85"
        style={{ width: `${riskSharePercent}%` }}
      />
      <span data-kpi-bar="plannedReward" className="bg-positive/85 flex-1" />
    </span>
  );
}

/**
 * Avg R / Trade: a deflection from a centred zero.
 *
 * ONE FACT, DRAWN FIRST: which side of break-even an average Trade lands on.
 * The fill grows out of the centre rule rather than from an edge, so the
 * direction is legible before the length is — a left-anchored bar would have
 * made a small loss and a small gain look alike.
 *
 * The centre rule is always drawn, including at exactly zero, because "no
 * deflection" is only readable against the datum it failed to leave. It uses
 * the same `--subtle-foreground` the charts' zero line does (§9): a datum, not
 * a series.
 */
function DivergingBar({
  direction,
  fillPercent,
}: {
  direction: 'positive' | 'negative' | 'zero';
  fillPercent: number;
}) {
  return (
    <span
      className="relative block h-3 w-14 shrink-0 overflow-hidden rounded-full bg-(--indicator-track) @[11rem]/kpi:w-20"
      aria-hidden="true"
    >
      {direction === 'zero' ? null : (
        <span
          data-kpi-bar={direction === 'positive' ? 'averageGain' : 'averageLoss'}
          className={cn(
            'absolute inset-y-0 rounded-full',
            direction === 'positive' ? 'bg-positive/85 left-1/2' : 'bg-negative/85 right-1/2',
          )}
          style={{ width: `${fillPercent}%` }}
        />
      )}
      <span
        data-kpi-bar="zeroDatum"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-(--subtle-foreground)"
      />
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

  if (detail.kind === 'plannedRatio') {
    return (
      <>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {t('detail.plannedRrSentence', { factor: detail.factor })}
        </p>
        {/*
          The coverage line, because this is the one card whose denominator can
          be smaller than the row's: Trades recorded without a planned target
          carry no ratio and are excluded rather than counted as zero.
        */}
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {t('detail.plannedRrCoverage', { count: detail.tradeCount })}
        </p>
      </>
    );
  }

  const rows = [
    {
      key: 'wins',
      label: t('detail.wins'),
      value: String(detail.wins),
      swatch: 'bg-positive',
    },
    {
      key: 'breakEvens',
      label: t('detail.breakEvens'),
      value: String(detail.breakEvens),
      swatch: 'bg-break-even',
    },
    {
      key: 'losses',
      label: t('detail.losses'),
      value: String(detail.losses),
      swatch: 'bg-negative',
    },
  ] as const;

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
