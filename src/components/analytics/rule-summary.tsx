import { useTranslations } from 'next-intl';

import type { RuleAnalyticsModel } from '@/lib/analytics/metrics';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { MetricLabel } from '@/components/product/metric';
import { Card, CardContent } from '@/components/ui/card';

export function RuleSummary({ rules }: { rules: RuleAnalyticsModel }) {
  const t = useTranslations('analytics.real');
  const counts = [
    ['followed', rules.followedCount],
    ['violated', rules.violatedCount],
    ['notChecked', rules.notCheckedCount],
    ['notApplicable', rules.notApplicableCount],
    ['evaluated', rules.evaluatedCount],
  ] as const;

  return (
    <Card data-analytics-panel="rules">
      <CardContent className="pt-5 sm:pt-6">
        <dl className="grid gap-5 sm:grid-cols-3">
          <AnalyticsMetricDisplay
            className="border-b pb-5 sm:col-span-3"
            label={t('rules.checksFollowed')}
            metric={rules.checksFollowedRate}
            style="percent"
            prominent
            forceNeutral
          />
          {counts.map(([key, count]) => (
            <div key={key} className="flex min-w-0 flex-col gap-1.5">
              <MetricLabel>{t(`rules.${key}`)}</MetricLabel>
              <span className="numeric text-xl font-semibold">{count}</span>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">{t('rules.help')}</p>
      </CardContent>
    </Card>
  );
}
