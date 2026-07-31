import type { Metadata } from 'next';

import { TRIAL_DAYS } from '@/config/plans';
import { FaqSection } from '@/components/marketing/faq-section';
import { PricingSection } from '@/components/marketing/pricing-section';
import { Container } from '@/components/shell/container';

export const metadata: Metadata = {
  title: 'Pricing',
  description: `Three plans gated on how many trading accounts you journal, with a ${TRIAL_DAYS}-day free trial. Amounts are not set yet and no payment processing is connected.`,
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing · Trading OS',
    description: `Three plans, a ${TRIAL_DAYS}-day free trial, and no card required.`,
    url: '/pricing',
    type: 'website',
  },
};

/**
 * Pricing page.
 *
 * The `<h1>` states the honest position up front rather than burying it under
 * the cards. A visitor who reads only the heading should already know that
 * they cannot buy anything today.
 */
export default function PricingPage() {
  return (
    <>
      <Container className="py-16 sm:py-20">
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="text-page-title text-balance">Plans are set. Prices are not, yet.</h1>
          <p className="text-muted-foreground leading-relaxed text-pretty">
            The three tiers below differ only in how many trading accounts you can journal. Amounts
            have not been approved and no payment provider is connected, so nothing on this page can
            be purchased. The {TRIAL_DAYS}-day trial is free and needs no card.
          </p>
        </div>
      </Container>

      <PricingSection eyebrow="Plans" title="Choose by how many accounts you trade" />

      <FaqSection />
    </>
  );
}
