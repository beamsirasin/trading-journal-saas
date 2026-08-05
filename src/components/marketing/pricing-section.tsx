'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { TRIAL_DAYS } from '@/config/plans';
import type { BillingCurrency } from '@/lib/billing';
import type { BillingPresentation } from '@/lib/billing/presentation-types';

import { PricingCard } from './pricing-card';
import { Section, SectionIntro } from './section';

/**
 * Pricing.
 *
 * Three plans (Starter/Trader/Professional — the locked product decision)
 * gated exclusively on active trading-account count: 1/5/15. Every plan
 * shares the exact same feature set (`pricing.sharedFeatures`,
 * `PricingCard`) — the account limit is the only difference between them.
 *
 * The trial notice states the live entitlement policy. A separate VAT notice
 * appears only when the safe server DTO says collection is enabled.
 *
 * `title`/`eyebrow` stay as overridable props, translated already by the
 * caller: the landing page and `/pricing` show the same cards under
 * different headings, and each caller resolves its own heading from its own
 * translation namespace (`pricing.title` vs `pricingPage.sectionTitle`).
 */
export function PricingSection({
  presentation,
  title,
  eyebrow,
  tone = 'surface',
}: {
  presentation: BillingPresentation;
  title?: string;
  eyebrow?: string;
  tone?: 'default' | 'surface';
}) {
  const t = useTranslations('pricing');
  const [currency, setCurrency] = useState<BillingCurrency>(presentation.defaultCurrency);

  return (
    <Section id="pricing" labelledBy="pricing-title" tone={tone}>
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow={eyebrow ?? t('eyebrow')}
          title={title ?? t('title')}
          titleId="pricing-title"
          description={t('description')}
          align="center"
        />

        <fieldset className="mx-auto flex min-w-0 flex-col items-center gap-2">
          <legend className="text-foreground text-sm font-medium">{t('currencyLegend')}</legend>
          <div className="border-border bg-muted/40 inline-flex rounded-lg border p-1">
            {presentation.supportedCurrencies.map((option) => (
              <label
                key={option}
                className="has-[:focus-visible]:ring-ring/50 has-[:checked]:bg-background has-[:checked]:text-foreground text-muted-foreground relative flex min-h-11 min-w-20 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium has-[:focus-visible]:ring-3"
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="pricing-currency"
                  value={option}
                  checked={currency === option}
                  onChange={() => setCurrency(option)}
                />
                {option}
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-center text-xs">{t('currencyNote')}</p>
        </fieldset>

        {/*
          `md:grid-cols-2` matters specifically at tablet (768px): without it,
          the grid stays single-column until `lg` (1024px), so a plan card
          stretches to the full ~700px content width with a full-width
          CTA — noticeably wider than the same card ever renders at mobile or
          desktop. Professional sits alone in the second row at this step, the
          normal shape for three items at two columns.
        */}
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {presentation.plans.map((plan) => (
            <li key={plan.id} className="flex">
              <PricingCard
                plan={plan}
                currency={currency}
                sharedFeatureKeys={presentation.sharedFeatureKeys}
              />
            </li>
          ))}
        </ul>

        <div className="border-border bg-card mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border p-5 sm:flex-row sm:gap-4">
          <Info className="text-info size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-2 text-sm leading-relaxed">
            <p className="text-foreground font-medium">
              {t('trialNoticeTitle', { trialDays: TRIAL_DAYS })}
            </p>
            <p className="text-muted-foreground">
              {t('trialNoticeBody', { trialDays: TRIAL_DAYS })}
            </p>
          </div>
        </div>

        {presentation.vat.enabled ? (
          <p className="text-muted-foreground text-center text-sm">
            {t('vatExclusiveNotice', { rate: presentation.vat.ratePercent })}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
