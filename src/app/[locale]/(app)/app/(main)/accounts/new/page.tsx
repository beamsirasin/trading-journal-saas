import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  DEFAULT_BASE_CURRENCY,
  DEFAULT_MAXIMUM_DAILY_LOSS_PERCENT,
  DEFAULT_RISK_PER_TRADE_PERCENT,
} from '@/lib/trading-accounts/constants';
import { getCurrentUserPreferences } from '@/server/auth/dal';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { TradingAccountForm } from '@/components/trading-accounts/trading-account-form';
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
  const t = await getTranslations({ locale: appLocale, namespace: 'accounts' });

  return {
    title: t('createAccountTitle'),
    description: t('createAccountDescription'),
    alternates: localizedAlternates(appLocale, '/app/accounts/new'),
    openGraph: {
      title: t('createAccountTitle'),
      description: t('createAccountDescription'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/accounts/new'),
    },
  };
}

/**
 * `preferences.timezone` is passed straight through — never refined by a
 * server-side `Intl` call. CLAUDE.md §7 forbids using the server's own
 * local timezone as a stand-in for the user's; `detectBrowserTimeZone()`
 * (`onboarding-wizard.tsx`'s pattern) only means something called from a
 * REAL browser, so that client-side refinement, when it is worth doing,
 * belongs inside `TradingAccountForm` itself, not here.
 */
export default async function NewTradingAccountPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('accounts');
  const preferences = await getCurrentUserPreferences();

  return (
    <Container width="prose" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('createAccountTitle')} description={t('createAccountDescription')} />
      <TradingAccountForm
        mode="create"
        initialValues={{
          name: '',
          brokerName: '',
          platformName: '',
          accountMode: 'live',
          baseCurrency: DEFAULT_BASE_CURRENCY,
          startingBalance: '',
          timezone: preferences.timezone,
          riskPerTradePercent: DEFAULT_RISK_PER_TRADE_PERCENT,
          maximumDailyLossPercent: DEFAULT_MAXIMUM_DAILY_LOSS_PERCENT,
        }}
      />
    </Container>
  );
}
