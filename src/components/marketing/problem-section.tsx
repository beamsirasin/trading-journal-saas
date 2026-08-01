import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { Section, SectionIntro } from './section';

/**
 * The problem, and the insight that follows from it.
 *
 * Leads with the uncomfortable case rather than the flattering one: a
 * profitable trade taken against the rules is a worse outcome than a losing
 * trade taken correctly, because the profitable one teaches the trader to
 * repeat the mistake. That claim is the reason the schema stores system and
 * trader outcome as independent fields, so the marketing page and the data
 * model are making the same argument.
 *
 * PHASE 1.1 SIMPLIFICATION — this section used to open with three "+$320 /
 * −$200 / ?" example cards ABOVE the quadrant grid, illustrating the same
 * point twice in two visual formats before the reader reached the actual
 * comparison. The Phase 1.1 brief asks for one strong comparison visual per
 * idea; the quadrant grid is the stronger, more distinctive one — it is the
 * outcome matrix that is the product's actual intellectual property — so the
 * example cards are gone and the section goes straight from the claim to the
 * matrix that proves it.
 */

const QUADRANT_KEYS = [
  { key: 'goodSignal', system: 'win', trader: 'win', emphasis: false },
  { key: 'systemDamaged', system: 'win', trader: 'loss', emphasis: true },
  { key: 'brokeRules', system: 'loss', trader: 'win', emphasis: true },
  { key: 'badSignal', system: 'loss', trader: 'loss', emphasis: false },
] as const;

export function ProblemSection() {
  const t = useTranslations('problem');

  return (
    <Section id="the-problem" labelledBy="the-problem-title" tone="surface">
      <div className="flex flex-col gap-8">
        <SectionIntro
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleId="the-problem-title"
          description={t('description')}
        />

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-card-title">{t('matrixTitle')}</h3>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              {t('matrixDescription')}
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {QUADRANT_KEYS.map((quadrant) => (
              <li
                key={quadrant.key}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-5',
                  quadrant.emphasis ? 'border-brand/40 bg-brand/5' : 'border-border bg-card',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CellTag
                    axis={t('axisSystem')}
                    outcome={quadrant.system}
                    outcomeLabel={quadrant.system === 'win' ? t('outcomeWin') : t('outcomeLoss')}
                  />
                  <CellTag
                    axis={t('axisTrader')}
                    outcome={quadrant.trader}
                    outcomeLabel={quadrant.trader === 'win' ? t('outcomeWin') : t('outcomeLoss')}
                  />
                </div>
                <h4 className="text-foreground font-semibold">
                  {t(`quadrants.${quadrant.key}.title`)}
                </h4>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(`quadrants.${quadrant.key}.body`)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/**
 * The axis name is always spoken, never implied by position or colour — "Win"
 * on its own is ambiguous when two different axes both use the word.
 */
function CellTag({
  axis,
  outcome,
  outcomeLabel,
}: {
  axis: string;
  outcome: 'win' | 'loss';
  outcomeLabel: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        outcome === 'win'
          ? 'border-positive/30 bg-positive/10 text-positive'
          : 'border-negative/30 bg-negative/10 text-negative',
      )}
    >
      {axis} {outcomeLabel}
    </span>
  );
}
