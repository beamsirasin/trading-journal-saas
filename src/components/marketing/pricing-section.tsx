import { Info } from 'lucide-react';

import { PLANS, TRIAL_DAYS } from '@/config/plans';

import { PricingCard } from './pricing-card';
import { Section, SectionIntro } from './section';

/**
 * Pricing.
 *
 * Three plans gated primarily on trading-account count, which is the axis
 * recorded in docs/product-spec.md §9. The Elite limit of ten is still an
 * open product question and is marked provisional on the card rather than
 * presented as decided.
 *
 * The notice below the cards is not fine print to be minimised. Payment
 * processing does not exist, and a pricing page that does not say so is
 * making a claim about the product's readiness.
 */
export function PricingSection({
  title = 'Three plans, one free trial',
  eyebrow = 'Pricing',
  tone = 'surface',
}: {
  title?: string;
  eyebrow?: string;
  tone?: 'default' | 'surface';
}) {
  return (
    <Section id="pricing" labelledBy="pricing-title" tone={tone}>
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow={eyebrow}
          title={title}
          titleId="pricing-title"
          description="Plans differ by how many trading accounts you can journal. Every plan includes the full attribution engine — the analysis is the product, so it is not something to withhold from a cheaper tier."
          align="center"
        />

        {/*
          `md:grid-cols-2` matters specifically at tablet (768px): without it,
          the grid stays single-column until `lg` (1024px), so a plan card
          stretches to the full ~700px content width with a full-width
          "Start trial" button — noticeably wider than the same card ever
          renders at mobile or desktop. Held at `md` rather than `sm` (640px)
          because each card carries up to six checklist items plus a button,
          which needs more than a 640px row split two ways. Elite sits alone
          in the second row at this step, the normal shape for three items at
          two columns.
        */}
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li key={plan.id} className="flex">
              <PricingCard plan={plan} />
            </li>
          ))}
        </ul>

        <div className="border-border bg-card mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border p-5 sm:flex-row sm:gap-4">
          <Info className="text-info size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-2 text-sm leading-relaxed">
            <p className="text-foreground font-medium">
              No payment processing is connected to this product yet
            </p>
            <p className="text-muted-foreground">
              Prices have not been set, no card is collected, and nothing can be purchased. The{' '}
              {TRIAL_DAYS}-day trial starts at first login and requires no payment details. Billing
              arrives in a later release, and the amounts above will be published before it does.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
