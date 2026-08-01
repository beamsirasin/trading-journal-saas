import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TRIAL_DAYS } from '@/config/plans';

import { Section, SectionIntro } from './section';

/**
 * FAQ.
 *
 * Built on native `<details>`/`<summary>` rather than an accordion component.
 * The native element is keyboard operable, exposes correct expanded state to
 * assistive tech, works with JavaScript disabled, and is searchable by the
 * browser's find-in-page — which a JS accordion with hidden panels is not.
 * A Radix Accordion would add a client component and a dependency to
 * reimplement all of that slightly worse.
 *
 * Answers state the MVP scope as it actually is. Every "no" here is a real
 * limitation (CLAUDE.md §9), and softening one into "not yet" would be an
 * implied roadmap commitment.
 */

const FAQ_KEYS = [
  'whyManual',
  'brokerImport',
  'systemPerformance',
  'traderPerformance',
  'tradingViewLinks',
  'freeTrial',
  'mobile',
  'aiAnalysis',
] as const;

export function FaqSection() {
  const t = useTranslations('faq');

  return (
    <Section id="faq" labelledBy="faq-title" width="prose">
      <div className="flex flex-col gap-10">
        <SectionIntro eyebrow={t('eyebrow')} title={t('title')} titleId="faq-title" />

        <ul className="flex flex-col gap-3">
          {FAQ_KEYS.map((key) => (
            <li key={key}>
              <details className="group border-border bg-card rounded-lg border">
                <summary className={cnSummary}>
                  {/*
                    A heading inside the summary, following the ARIA authoring
                    practice for disclosures: the native element supplies the
                    button semantics and expanded state, and the heading makes
                    each question reachable by heading navigation. h3 sits
                    correctly under the section's h2.
                  */}
                  <h3 className="text-foreground font-medium">{t(`items.${key}.question`)}</h3>
                  <ChevronDown
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                  {/* The default triangle is removed in CSS by the class
                      below; hiding it there alone leaves a stray marker in
                      some browsers, hence the explicit ::-webkit rule. */}
                </summary>
                <p className="text-muted-foreground px-5 pb-5 text-sm leading-relaxed">
                  {key === 'freeTrial'
                    ? t('items.freeTrial.answer', { trialDays: TRIAL_DAYS })
                    : t(`items.${key}.answer`)}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const cnSummary = [
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4',
  'rounded-lg text-left',
  'focus-visible:outline-ring',
  '[&::-webkit-details-marker]:hidden',
].join(' ');
