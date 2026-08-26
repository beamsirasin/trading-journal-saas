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
 * The dot is a quiet second channel, never the only one — each count is
 * labelled in words and the three read as one sentence.
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
    },
    {
      key: 'matched',
      count: distribution.matchedCount,
      dot: 'bg-muted-foreground',
    },
    {
      key: 'outperformed',
      count: distribution.outperformedCount,
      dot: 'bg-positive',
    },
  ] as const;

  return (
    <dl
      data-execution-gap-distribution
      className={cn('flex flex-wrap items-center gap-x-6 gap-y-2', className)}
    >
      {items.map((item) => (
        <div
          key={item.key}
          data-execution-gap-distribution-item={item.key}
          className="flex min-w-0 items-center gap-2"
        >
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', item.dot)} />
          <dt className="text-muted-foreground text-xs">{t(`distribution.${item.key}`)}</dt>
          <dd className="numeric text-sm font-semibold">{item.count}</dd>
        </div>
      ))}
    </dl>
  );
}
