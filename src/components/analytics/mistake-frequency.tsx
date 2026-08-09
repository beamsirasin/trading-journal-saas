import { useTranslations } from 'next-intl';

import type { MistakeCountModel } from '@/lib/analytics/metrics';
import { Card, CardContent } from '@/components/ui/card';

export function MistakeFrequency({ mistakes }: { mistakes: readonly MistakeCountModel[] }) {
  const t = useTranslations('analytics.real');

  return (
    <Card data-analytics-panel="mistakes">
      <CardContent className="pt-5 sm:pt-6">
        {mistakes.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t('mistakes.emptyTitle')}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('mistakes.emptyDescription')}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-2" aria-label={t('mistakes.listLabel')}>
            {mistakes.map((mistake, index) => (
              <li
                key={mistake.mistakeTypeId}
                className="border-border flex min-w-0 items-center gap-3 rounded-md border p-3"
              >
                <span className="bg-muted text-muted-foreground numeric flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium break-words">
                  {t.has(`mistakeTypes.${mistake.key}`)
                    ? t(`mistakeTypes.${mistake.key}`)
                    : mistake.label}
                </span>
                <span className="bg-primary/10 text-foreground shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
                  {t('mistakes.tradeCount', { count: mistake.tradeCount })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
