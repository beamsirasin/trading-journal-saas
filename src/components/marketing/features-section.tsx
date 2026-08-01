import { BarChart3, BookOpen, ListChecks, Target, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Section, SectionIntro } from './section';

/**
 * Feature overview.
 *
 * PHASE 1.1 SIMPLIFICATION — six feature cards reduced to the four the
 * brief names as primary capabilities. TradingView links and mobile support
 * are real and still stated, but as one supporting line under the grid
 * rather than two more full cards competing for the same attention as the
 * four that actually differentiate the product.
 */
const FEATURE_KEYS = ['journal', 'playbooks', 'analytics', 'discipline'] as const;

const ICONS: Record<(typeof FEATURE_KEYS)[number], LucideIcon> = {
  journal: BookOpen,
  playbooks: Target,
  analytics: BarChart3,
  discipline: ListChecks,
};

export function FeaturesSection() {
  const t = useTranslations('features');

  return (
    <Section id="features" labelledBy="features-title">
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleId="features-title"
          description={t('description')}
        />

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURE_KEYS.map((key) => {
            const Icon = ICONS[key];
            return (
              <li
                key={key}
                className="bg-card border-border hover:border-brand/40 flex flex-col gap-3 rounded-lg border p-5 transition-colors"
              >
                <span className="bg-brand/10 text-brand flex size-10 items-center justify-center rounded-lg">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-card-title">{t(`items.${key}.title`)}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(`items.${key}.body`)}
                </p>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm leading-relaxed">{t('supportingNote')}</p>
          <p className="text-muted-foreground border-border max-w-3xl border-l-2 pl-4 text-sm leading-relaxed">
            {t('excludedNote')}
          </p>
        </div>
      </div>
    </Section>
  );
}
