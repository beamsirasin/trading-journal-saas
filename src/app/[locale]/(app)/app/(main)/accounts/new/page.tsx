import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  DEFAULT_BASE_CURRENCY,
  DEFAULT_MAXIMUM_DAILY_LOSS_PERCENT,
  DEFAULT_RISK_PER_TRADE_PERCENT,
} from '@/lib/trading-accounts/constants';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { TradingAccountForm } from '@/components/trading-accounts/trading-account-form';
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
  const tEntitlements = await getTranslations('entitlements');
  const [preferences, entitlement] = await Promise.all([
    getCurrentUserPreferences(),
    getWorkspaceEntitlement(),
  ]);

  // Fail-closed, same posture as the accounts list page: `null` (no
  // entitlement row for a completed workspace) is treated as "cannot create
  // right now," not "cannot tell, so allow it."
  const canCreateAccount = entitlement?.canCreateAccount ?? false;

  if (!canCreateAccount) {
    const reasonCode = entitlement?.blockReason ?? 'entitlement_unavailable';
    return (
      <Container width="prose" className="flex flex-col gap-6 py-8">
        <PageHeader title={t('createAccountTitle')} description={t('createAccountDescription')} />
        <div className="border-warning/30 bg-warning/10 flex flex-col gap-3 rounded-lg border p-5">
          <p className="text-foreground font-medium">{tEntitlements('createUnavailable')}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(`errors.${reasonCode}` as Parameters<typeof t>[0])}
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild variant="outline">
              <Link href="/app/accounts">{t('backToAccounts')}</Link>
            </Button>
            <Button asChild>
              <Link href="/app/plan">{tEntitlements('banner.viewPlans')}</Link>
            </Button>
          </div>
        </div>
      </Container>
    );
  }

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
