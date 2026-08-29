import { useTranslations } from 'next-intl';

import type { ExecutionComparisonDistribution } from '@/lib/dashboard/execution-comparison';
import { cn } from '@/lib/utils';

/**
 * How the paired Gap fell by sign — three counts, and nothing more.
 *
 * The wording is RELATIVE and comparative on purpose: "Underperformed" and
 * "Outperformed" describe this Trade's result against its own System
 * counterfactual, not the trader. There is no "good Trades"/"bad Trades"
 * here, no grade, no score, and no threshold band, for the same reason
 * CLAUDE.md refuses a Discipline Score: counting which side of zero a Trade
 * fell on is arithmetic, and compressing that into a verdict would be an
 * unapproved judgement dressed as a measurement.
 *
 * R2C §15 — IT IS NOW A SEGMENTED BAR, AND THAT IS ONLY ALLOWED BECAUSE IT IS
 * TRUE. Every paired Trade falls on exactly one side of zero, so the three
 * counts PARTITION the paired population and their widths really are shares
 * of a whole. A stacked bar over a set that overlapped, or that omitted
 * members, would be a lie about the same three numbers — which is why the
 * insight pillars, whose cohorts genuinely do overlap, get no such treatment.
 * The bar renders only when the three actually sum to something; at zero it
 * is skipped rather than drawn empty.
 *
 * It reads as an interpretation of the chart above rather than a legend
 * beside it: same left edge, same three signs, and the same
 * negative/neutral/positive vocabulary the daily bars use.
 *
 * NO PIE, NO DONUT, NO PERCENTAGE LABELS. The counts stay the figures; the
 * bar is only the proportion, and it is 6px tall so it can never outrank the
 * plot it summarises.
 *
 * Colour is never the only channel: each segment is labelled in words beneath
 * it with its own count, and the bar carries a text alternative of its own.
 */
export function GapDistribution({
  distribution,
  className,
}: {
  distribution: ExecutionComparisonDistribution;
  className?: string;
}) {
  const t = useTranslations('dashboard.executionGap');

  const items = [
    {
      key: 'underperformed',
      count: distribution.underperformedCount,
      dot: 'bg-negative',
      segment: 'bg-negative/80',
    },
    {
      key: 'matched',
      count: distribution.matchedCount,
      dot: 'bg-subtle-foreground',
      segment: 'bg-subtle-foreground',
    },
    {
      key: 'outperformed',
      count: distribution.outperformedCount,
      dot: 'bg-positive',
      segment: 'bg-positive/80',
    },
  ] as const;

  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <div
      data-execution-gap-distribution
      className={cn('flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2', className)}
    >
      {total === 0 ? null : (
        <div
          data-execution-gap-distribution-bar
          role="img"
          aria-label={items
            .map((item) => `${t(`distribution.${item.key}`)}: ${item.count}`)
            .join(', ')}
          // Capped, not full-bleed. Stretched across a 1700px card this read
          // as a coloured rule underlining the whole section — louder than the
          // plot it summarises, which inverts the rank §15 asks for. At 13rem
          // beside its own counts it reads as one compact figure.
          className="bg-muted flex h-1.5 w-full max-w-[13rem] shrink-0 overflow-hidden rounded-full"
        >
          {items
            .filter((item) => item.count > 0)
            .map((item) => (
              <span
                key={item.key}
                className={item.segment}
                // Integer counts over an integer total — a share of a
                // partition, never a re-derived metric.
                style={{ width: `${(item.count / total) * 100}%` }}
              />
            ))}
        </div>
      )}
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {items.map((item) => (
          <div
            key={item.key}
            data-execution-gap-distribution-item={item.key}
            className="flex min-w-0 items-center gap-1.5"
          >
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', item.dot)} />
            <dt className="text-muted-foreground text-xs">{t(`distribution.${item.key}`)}</dt>
            <dd className="numeric text-foreground text-xs font-semibold">{item.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
