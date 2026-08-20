import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { getActiveTradingAccount } from '@/server/auth/dal';
import { getWorkspaceTradeAttentionCounts } from '@/server/dal/trades';
import { getDashboardOverview } from '@/server/services/analytics';
import {
  ActiveTradingAccountSummaryCard,
  NoActiveTradingAccountRecovery,
} from '@/components/dashboard/empty-trading-dashboard';
import {
  DashboardDataError,
  DashboardSkeleton,
  RealDashboard,
} from '@/components/dashboard/real-dashboard';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { range?: string | string[] };
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
  const [{ locale }, { range }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('dashboard');

  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent locale={locale} range={range} />
      </Suspense>
    </Container>
  );
}

async function DashboardContent({ locale, range }: { locale: string; range: unknown }) {
  const [account, dashboard, attention] = await Promise.all([
    getActiveTradingAccount(),
    getDashboardOverview(range),
    getWorkspaceTradeAttentionCounts(),
  ]);
  if (account === null || (!dashboard.ok && dashboard.code === 'no_active_trading_account')) {
    return <NoActiveTradingAccountRecovery />;
  }
  if (!dashboard.ok || dashboard.data.overview.scope.accountScope.kind !== 'account') {
    return (
      <div className="flex flex-col gap-6">
        <ActiveTradingAccountSummaryCard account={account} />
        <DashboardDataError />
      </div>
    );
  }

  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';
  const recentTrades = dashboard.data.recentTrades.map((trade) => ({
    ...trade,
    occurredAtDisplay:
      formatTradeInstant(trade.occurredAt, dashboard.data.overview.scope.timezone, dateLocale) ??
      '—',
  }));
  return (
    <RealDashboard
      account={account}
      overview={dashboard.data.overview}
      recentTrades={recentTrades}
      attention={attention}
    />
  );
}
