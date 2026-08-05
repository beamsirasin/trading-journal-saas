import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TRIAL_DAYS } from '@/config/plans';
import { getBillingPresentation } from '@/server/billing/presentation';
import { FaqSection } from '@/components/marketing/faq-section';
import { PricingSection } from '@/components/marketing/pricing-section';
import { Container } from '@/components/shell/container';
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
  const t = await getTranslations({ locale: appLocale, namespace: 'pricingPage' });
  const description = t('description', { trialDays: TRIAL_DAYS });

  return {
    title: t('title'),
    description,
    alternates: localizedAlternates(appLocale, '/pricing'),
    openGraph: {
      title: t('title'),
      description,
      type: 'website',
      ...localizedOpenGraph(appLocale, '/pricing'),
    },
  };
}

/**
 * Pricing page.
 *
 * The heading and cards describe the final equal-feature plan model. The
 * protected CTA owns authenticated checkout and safe callback behavior.
 */
export default async function PricingPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const t = await getTranslations('pricingPage');
  const billingPresentation = getBillingPresentation(appLocale);

  return (
    <>
      <Container className="py-16 sm:py-20">
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="text-page-title text-balance">{t('title')}</h1>
          <p className="text-muted-foreground leading-relaxed text-pretty">
            {t('description', { trialDays: TRIAL_DAYS })}
          </p>
        </div>
      </Container>

      <PricingSection presentation={billingPresentation} title={t('sectionTitle')} />

      <FaqSection />
    </>
  );
}
