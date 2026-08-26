import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { parseDashboardFilterState } from '@/lib/dashboard/filters';
import { getDashboardPageData } from '@/server/services/dashboard';
import { NoActiveTradingAccountRecovery } from '@/components/dashboard/empty-trading-dashboard';
import {
  DashboardDataError,
  DashboardSkeleton,
  RealDashboard,
} from '@/components/dashboard/real-dashboard';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = Record<string, string | string[] | undefined>;
const DATE_LOCALE: Record<string, string> = { en: 'en-GB', th: 'th' };

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

export default async function AppOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('dashboard');

  return (
    /*
      `canvas`, not `wide` (D4.5 §1): the Dashboard is the one surface where a
      1728/1920-class monitor was showing a 1536px column with ~128px of dead
      margin either side. The gutters are unchanged (16/24/32px) — only the
      ceiling moved, so 1280 and 1440 are byte-for-byte what they were and
      only the widths the old cap was actually clipping change.

      `gap-5` puts 20px between the page header and the account context bar,
      which is where the rest of the page's explicit rhythm starts.
    */
    <Container width="canvas" className="flex min-w-0 flex-col gap-5 py-6">
      <PageHeader title={t('title')} description={t('description')} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent locale={locale} rawSearchParams={rawSearchParams} />
      </Suspense>
    </Container>
  );
}

async function DashboardContent({
  locale,
  rawSearchParams,
}: {
  locale: string;
  rawSearchParams: PageSearchParams;
}) {
  const parsed = parseDashboardFilterState(rawSearchParams);
  if (!parsed.ok) return <DashboardDataError />;
  const dashboard = await getDashboardPageData(parsed.state).catch(() => null);
  if (dashboard === null) return <DashboardDataError />;
  if (!dashboard.ok && dashboard.code === 'no_active_trading_account') {
    return <NoActiveTradingAccountRecovery />;
  }
  if (!dashboard.ok) return <DashboardDataError />;

  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';
  return <RealDashboard data={dashboard.data} dateLocale={dateLocale} />;
}
