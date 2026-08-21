import { useTranslations } from 'next-intl';

import type { ContextBreakdownModel } from '@/lib/analytics/metrics';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { Card, CardContent } from '@/components/ui/card';

/**
 * One generic Context breakdown card — reused for Symbol, Direction, Session,
 * and Timeframe (brief §19/§25): a compact row per value (label, Avg R,
 * Trade count, Win Rate), Trader-eligible only (documented decision — see
 * `docs/phases/PHASE-15-ux-simplification.md`). Already sorted by
 * `composeContextBreakdown` (Trade count desc, then value asc — a
 * coverage-first order that does not itself imply a performance ranking).
 */
export function ContextBreakdownPanel({
  title,
  breakdown,
  formatValue,
  emptyLabel,
}: {
  title: string;
  breakdown: ContextBreakdownModel;
  /** Translates a raw stored value (e.g. `'long'`) into display text; identity if omitted. */
  formatValue?: (value: string) => string;
  emptyLabel: string;
}) {
  const t = useTranslations('analytics.real');
  const display = (value: string) => (formatValue === undefined ? value : formatValue(value));

  return (
    <Card data-analytics-panel={`context-${title}`}>
      <CardContent className="pt-5 sm:pt-6">
        {breakdown.groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyLabel}</p>
        ) : (
          <ul className="grid gap-3" aria-label={title}>
            {breakdown.groups.map((group) => (
              <li key={group.value} className="border-border rounded-md border p-3 text-sm">
                <p className="font-medium">{display(group.value)}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <AnalyticsMetricDisplay
                    label={t('axis.avgR')}
                    metric={group.trader.averageR}
                    style="r"
                  />
                  <AnalyticsMetricDisplay
                    label={t('axis.winRate')}
                    metric={group.trader.winRate}
                    style="percent"
                  />
                  <span className="text-muted-foreground self-end text-xs">
                    {t('axis.tradeCount', { count: group.trader.tradeCount })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {breakdown.missingCount === 0 ? null : (
          <p className="text-muted-foreground mt-4 text-xs">
            {t('explore.context.recorded', { count: breakdown.recordedCount })}
            {' · '}
            {t('explore.context.missing', { count: breakdown.missingCount })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
