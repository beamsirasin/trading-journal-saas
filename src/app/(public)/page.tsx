import type { Metadata } from 'next';

import { AttributionSection } from '@/components/marketing/attribution-section';
import { CtaSection } from '@/components/marketing/cta-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { FeaturesSection } from '@/components/marketing/features-section';
import { Hero } from '@/components/marketing/hero';
import { PricingSection } from '@/components/marketing/pricing-section';
import { ProblemSection } from '@/components/marketing/problem-section';
import { WorkflowSection } from '@/components/marketing/workflow-section';

export const metadata: Metadata = {
  // The root layout's template appends "· Trading OS". The home page owns its
  // whole title instead, because the template would otherwise produce
  // "Trading OS · Trading OS".
  title: { absolute: 'Trading OS — did the strategy fail, or did you?' },
  description:
    'A trading journal that scores every trade twice: what the strategy would have produced, and what your execution actually produced. The difference is the edge you are leaking.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Trading OS — did the strategy fail, or did you?',
    description:
      'Separate system performance from trader execution. Manual journal, strategy playbooks, and attribution analytics in R.',
    url: '/',
    type: 'website',
  },
};

/**
 * Landing page.
 *
 * Section order follows the argument, not a template: state the problem, show
 * that profit cannot resolve it, demonstrate the measurement, explain the
 * work it takes, list what is included, price it, then answer the objections.
 * Features come after the demonstration because a feature list is meaningless
 * until the reader accepts the premise.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <ProblemSection />
      <AttributionSection />
      <WorkflowSection />
      <FeaturesSection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
