import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  hasLegacyExclusions,
  type LegacyAnalyticsCoverage,
} from '@/lib/analytics/canonical-population';
import { cn } from '@/lib/utils';

/**
 * THE ONE SENTENCE THAT KEEPS AN EMPTY OR SMALLER FIGURE HONEST.
 *
 * Canonical R and System figures leave legacy evidence out (Add Trade contract
 * §25, §28). Without saying so, a trader with a year of closed Trades would see
 * "No eligible Trades yet" and conclude the journal lost them. This names how
 * many were left out and why, once per page, beside the figures it explains —
 * never as a zero, a loss or a warning, because nothing is wrong with them.
 *
 * The same note names closed Trades with no final exit time (contract §13):
 * inside a date range they are left out; otherwise they are in every total
 * and only the time-ordered figures leave them out.
 *
 * Renders nothing when nothing was left out.
 */
export function LegacyCoverageNote({
  coverage,
  className,
}: {
  coverage: LegacyAnalyticsCoverage;
  className?: string;
}) {
  const t = useTranslations('analytics.legacyCoverage');
  if (!hasLegacyExclusions(coverage)) return null;

  return (
    <p
      role="note"
      data-legacy-coverage=""
      data-legacy-actual={coverage.excludedActualCount}
      data-legacy-system={coverage.excludedSystemCount}
      data-undated={coverage.undatedClosedCount}
      className={cn('text-muted-foreground flex min-w-0 items-start gap-2 text-sm', className)}
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {[
          coverage.excludedActualCount > 0
            ? t('actual', { count: coverage.excludedActualCount })
            : null,
          coverage.excludedSystemCount > 0
            ? t('system', { count: coverage.excludedSystemCount })
            : null,
          // Undated Trades are in the totals unless a date range is active.
          coverage.undatedClosedCount > 0
            ? t(coverage.dateRangeActive ? 'undatedInRange' : 'undatedAll', {
                count: coverage.undatedClosedCount,
              })
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' ')}
      </span>
    </p>
  );
}
