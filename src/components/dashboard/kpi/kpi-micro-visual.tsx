import { useTranslations } from 'next-intl';

import type { BasicKpiMicroVisual } from '@/lib/dashboard/basic-kpi';
import { cn } from '@/lib/utils';

/**
 * The slim band between a KPI's figure and its context line.
 *
 * IT SHOWS THE SAME NUMBERS THE CARD ALREADY PRINTS. Every variant here is a
 * proportion of figures that are on the card in words directly beneath it —
 * `27W · 5BE · 34L`, `+2.27R / -1.12R` — so the picture and the sentence
 * cannot disagree, and nothing here is a second analytic. `composeBasicKpis`
 * decides whether a variant exists at all; this file only draws it, and draws
 * nothing when the answer is `none`.
 *
 * IT IS 6px TALL, AND THAT IS THE POINT. A KPI card is the page's smallest
 * analytical unit; a chart inside one would outrank the figure it belongs to.
 * This is a proportion, read in a glance, at a weight that never competes
 * with the number above it.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. Each band carries a text alternative
 * naming every segment and its count, and the same counts are printed in the
 * context line for every sighted reader — so the bar can be removed entirely
 * without any information being lost. That is the test a decorative visual
 * has to pass before it is allowed onto this row.
 */
export function KpiMicroVisual({ micro }: { micro: BasicKpiMicroVisual }) {
  const t = useTranslations('dashboard.basicKpi');

  if (micro.kind === 'none') return null;

  if (micro.kind === 'outcomeSplit') {
    const total = micro.wins + micro.breakEvens + micro.losses;
    // `composeBasicKpis` already refuses a zero total; this is the guard that
    // keeps a future contract change from reaching a division here.
    if (total <= 0) return null;
    const segments = [
      { key: 'wins', count: micro.wins, className: 'bg-positive/80' },
      { key: 'breakEvens', count: micro.breakEvens, className: 'bg-break-even/70' },
      { key: 'losses', count: micro.losses, className: 'bg-negative/80' },
    ] as const;

    return (
      <MicroBar
        kind="outcome-split"
        label={t(micro.unit === 'days' ? 'micro.outcomeSplitDays' : 'micro.outcomeSplitTrades', {
          wins: micro.wins,
          breakEvens: micro.breakEvens,
          losses: micro.losses,
        })}
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <span
              key={segment.key}
              data-kpi-micro-segment={segment.key}
              className={segment.className}
              style={{ width: `${(segment.count / total) * 100}%` }}
            />
          ))}
      </MicroBar>
    );
  }

  /*
    TWO OPPOSED MAGNITUDES, WHICH IS WHAT THE PAYOFF RATIO MEASURES. The left
    share is the average win, the right the average loss; a card reading
    `2.02x` shows a left segment twice the right, which is the ratio made
    visible rather than a second claim about it. The split is `winSharePercent`
    — computed once, in `decimal.js`, from the two canonical averages.
  */
  return (
    <MicroBar
      kind="win-loss-balance"
      label={t('micro.winLossBalance', {
        win: micro.averageWinR,
        loss: micro.averageLossR,
      })}
    >
      <span
        data-kpi-micro-segment="averageWin"
        className="bg-positive/80"
        style={{ width: `${micro.winSharePercent}%` }}
      />
      <span data-kpi-micro-segment="averageLoss" className="bg-negative/80 flex-1" />
    </MicroBar>
  );
}

/**
 * The shared frame: a rounded track on the muted surface, clipped so segments
 * inherit its radius. `role="img"` plus a real label is what makes the band
 * available to a screen reader as one described object rather than as three
 * unlabelled boxes.
 */
function MicroBar({
  kind,
  label,
  children,
  className,
}: {
  kind: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-kpi-micro={kind}
      role="img"
      aria-label={label}
      className={cn('bg-muted flex h-1.5 min-w-0 overflow-hidden rounded-full', className)}
    >
      {children}
    </div>
  );
}
