import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getBillingPresentation } from '@/server/billing/presentation';
import { getEffectivePlatformVatConfiguration } from '@/server/services/platform-vat-configuration';
import { AttributionSection } from '@/components/marketing/attribution-section';
import { CtaSection } from '@/components/marketing/cta-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { FeaturesSection } from '@/components/marketing/features-section';
import { Hero } from '@/components/marketing/hero';
import { PricingSection } from '@/components/marketing/pricing-section';
import { ProblemSection } from '@/components/marketing/problem-section';
import { WorkflowSection } from '@/components/marketing/workflow-section';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'metadata' });

  return {
    // The root layout's template appends "· Trading OS". The home page owns
    // its whole title instead, because the template would otherwise produce
    // "Trading OS · Trading OS".
    title: { absolute: t('title') },
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/'),
    },
  };
}

/**
 * Landing page.
 *
 * Section order follows the argument, not a template: state the problem, show
 * that profit cannot resolve it, demonstrate the measurement, explain the
 * work it takes, list what is included, price it, then answer the objections.
 * Features come after the demonstration because a feature list is meaningless
 * until the reader accepts the premise.
 */
export default async function HomePage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const vatConfiguration = await getEffectivePlatformVatConfiguration();
  const billingPresentation = getBillingPresentation(appLocale, vatConfiguration);

  return (
    <>
      <Hero />
      <ProblemSection />
      <AttributionSection />
      <WorkflowSection />
      <FeaturesSection />
      <PricingSection presentation={billingPresentation} />
      <FaqSection />
      <CtaSection />
    </>
  );
}
