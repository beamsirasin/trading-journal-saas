import { useTranslations } from 'next-intl';

import type { EmotionGroupModel } from '@/lib/analytics/metrics';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Card, CardContent } from '@/components/ui/card';

export function EmotionPerformance({ emotions }: { emotions: readonly EmotionGroupModel[] }) {
  const t = useTranslations('analytics.real');
  const tTrades = useTranslations('trades');

  return (
    <Card data-analytics-panel="emotions">
      <CardContent className="pt-5 sm:pt-6">
        {emotions.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t('emotions.emptyTitle')}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('emotions.emptyDescription')}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3" aria-label={t('emotions.listLabel')}>
            {emotions.map((emotion) => (
              <li key={emotion.key} className="border-border rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {tTrades.has(`emotions.${emotion.key}`)
                    ? tTrades(`emotions.${emotion.key}`)
                    : emotion.label}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <DimensionAxisSummaryBlock axis="trader" summary={emotion.trader} />
                  <DimensionAxisSummaryBlock axis="system" summary={emotion.system} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">{t('emotions.help')}</p>
      </CardContent>
    </Card>
  );
}
