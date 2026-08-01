import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TRIAL_DAYS } from '@/config/plans';
import { DEMO_DEFAULT_RANGE, demoBundle } from '@/lib/demo';
import { DemoDashboard } from '@/components/dashboard/demo-dashboard';
import { DemoBadge } from '@/components/product/demo-badge';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'demoPage' });
  const description = t('description', {
    closedTrades: demoBundle(DEMO_DEFAULT_RANGE).closedTrades,
  });

  return {
    title: t('title'),
    description,
    alternates: localizedAlternates(appLocale, '/demo'),
    openGraph: {
      title: t('title'),
      description,
      type: 'website',
      ...localizedOpenGraph(appLocale, '/demo'),
    },
  };
}

/**
 * Public demo.
 *
 * Renders exactly the same `DemoDashboard` the application shell renders at
 * `/app`, so a visitor is not shown a marketing mock-up that the product does
 * not match. The only difference is the surrounding chrome and the call to
 * action below it.
 */
export default async function DemoPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('demoPage');
  const closedTrades = demoBundle(DEMO_DEFAULT_RANGE).closedTrades;

  return (
    <Container width="wide" className="flex flex-col gap-8 py-10 sm:py-12">
      <PageHeader
        title={t('title')}
        description={t('description', { closedTrades })}
        meta={<DemoBadge />}
        actions={
          <>
            <Button asChild className="min-h-11">
              <Link href="/register">
                {t('ctaTrial', { trialDays: TRIAL_DAYS })}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/#how-it-works">{t('ctaHowItWorks')}</Link>
            </Button>
          </>
        }
      />

      <DemoDashboard />
    </Container>
  );
}
