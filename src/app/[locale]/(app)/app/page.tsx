import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DemoDashboard } from '@/components/dashboard/demo-dashboard';
import { PageHeader } from '@/components/product/page-header';
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
  const t = await getTranslations({ locale: appLocale, namespace: 'dashboard' });

  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app'),
    },
  };
}

/**
 * Application overview.
 *
 * Renders the same `DemoDashboard` as the public `/demo` route, from one
 * component. Two copies of "the dashboard" — a polished marketing one and a
 * thinner in-app one — is how a demo starts promising something the product
 * does not deliver.
 *
 * NO AUTHENTICATION GUARDS THIS ROUTE. That is a Phase 02 concern and is
 * recorded as an open risk in the phase document; it is safe today only
 * because the page holds fixtures rather than anyone's data.
 */
export default async function AppOverviewPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('dashboard');

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <DemoDashboard />
    </Container>
  );
}
