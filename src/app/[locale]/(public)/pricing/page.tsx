import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TRIAL_DAYS } from '@/config/plans';
import { FaqSection } from '@/components/marketing/faq-section';
import { PricingSection } from '@/components/marketing/pricing-section';
import { Container } from '@/components/shell/container';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricingPage' });
  const description = t('description', { trialDays: TRIAL_DAYS });

  return {
    title: t('title'),
    description,
    alternates: { canonical: '/pricing' },
    openGraph: {
      title: t('title'),
      description,
      url: '/pricing',
      type: 'website',
    },
  };
}

/**
 * Pricing page.
 *
 * The `<h1>` states the honest position up front rather than burying it under
 * the cards. A visitor who reads only the heading should already know that
 * they cannot buy anything today.
 */
export default async function PricingPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('pricingPage');

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

      <PricingSection title={t('sectionTitle')} />

      <FaqSection />
    </>
  );
}
