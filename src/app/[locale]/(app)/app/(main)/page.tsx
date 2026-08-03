import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getActiveTradingAccount } from '@/server/auth/dal';
import {
  EmptyTradingDashboard,
  NoActiveTradingAccountRecovery,
} from '@/components/dashboard/empty-trading-dashboard';
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
 * Application overview — real, not the fixture-driven `DemoDashboard` the
 * public `/demo` route still shows. `(app)/app/(main)/layout.tsx` already
 * guarantees onboarding is complete by the time this renders, so an active
 * trading account normally exists; `getActiveTradingAccount()` still
 * re-validates rather than assuming so (see its own doc comment — an
 * account can be archived later, Phase 3B), and this page shows the
 * recovery state instead of pretending one is selected when none is.
 */
export default async function AppOverviewPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('dashboard');
  const account = await getActiveTradingAccount();

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      {account === null ? (
        <NoActiveTradingAccountRecovery />
      ) : (
        <EmptyTradingDashboard account={account} />
      )}
    </Container>
  );
}
