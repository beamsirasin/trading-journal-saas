import { useTranslations } from 'next-intl';

import type { ConditionAnalyticsModel } from '@/lib/analytics/metrics';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Card, CardContent } from '@/components/ui/card';

export function ConditionPerformance({
  conditions,
}: {
  conditions: readonly ConditionAnalyticsModel[];
}) {
  const t = useTranslations('analytics.real');

  return (
    <Card data-analytics-panel="conditions">
      <CardContent className="pt-5 sm:pt-6">
        {conditions.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t('conditions.emptyTitle')}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('conditions.emptyDescription')}
            </p>
          </div>
        ) : (
          <ul className="grid gap-4" aria-label={t('conditions.listLabel')}>
            {conditions.map((condition) => (
              <li
                key={`${condition.setupId}:${condition.conditionKey}`}
                className="border-border rounded-md border p-3"
              >
                <p className="min-w-0 text-sm font-medium break-words">{condition.label}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div
                    className="bg-positive/5 rounded-md p-2.5"
                    data-analytics-condition-status="met"
                  >
                    <p className="text-positive mb-2 text-xs font-semibold">
                      {t('conditions.met')}
                    </p>
                    <div className="grid gap-2">
                      <DimensionAxisSummaryBlock axis="trader" summary={condition.trader.met} />
                      <DimensionAxisSummaryBlock axis="system" summary={condition.system.met} />
                    </div>
                  </div>
                  <div
                    className="bg-negative/5 rounded-md p-2.5"
                    data-analytics-condition-status="notMet"
                  >
                    <p className="text-negative mb-2 text-xs font-semibold">
                      {t('conditions.notMet')}
                    </p>
                    <div className="grid gap-2">
                      <DimensionAxisSummaryBlock axis="trader" summary={condition.trader.notMet} />
                      <DimensionAxisSummaryBlock axis="system" summary={condition.system.notMet} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">{t('conditions.help')}</p>
      </CardContent>
    </Card>
  );
}
