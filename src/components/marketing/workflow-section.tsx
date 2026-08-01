import { useTranslations } from 'next-intl';

import { Section, SectionIntro } from './section';

/**
 * How it works.
 *
 * Describes manual entry honestly and does not mention broker import, MT4/MT5
 * sync, CSV upload, or OCR anywhere — all four are explicitly out of MVP
 * scope (CLAUDE.md §9), and a workflow diagram implying otherwise would be a
 * capability claim the product cannot meet.
 *
 * Step 4 is the one that makes the rest work, and it is also the one a trader
 * is most likely to skip. The wording is deliberately neutral — recording a
 * mistake has to feel like data collection, not a confession, or the data
 * stops being honest and the attribution built on it becomes worthless.
 *
 * PHASE 1.1 SIMPLIFICATION — each step used to carry a full explanatory
 * sentence or two. The brief asks for a concise workflow with no long
 * paragraphs, so each step is now a short phrase; the fuller reasoning above
 * stays in this comment rather than in the page.
 */
const STEP_KEYS = ['record', 'attach', 'select', 'review', 'compare', 'learn'] as const;

export function WorkflowSection() {
  const t = useTranslations('workflow');

  return (
    <Section id="how-it-works" labelledBy="how-it-works-title" tone="surface">
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleId="how-it-works-title"
          description={t('description')}
        />

        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEP_KEYS.map((key, index) => (
            <li key={key} className="flex gap-4">
              <span
                aria-hidden="true"
                className="border-border bg-card text-brand numeric flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="text-card-title">{t(`steps.${key}.title`)}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(`steps.${key}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
