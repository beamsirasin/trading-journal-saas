import { Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ActiveTradingAccountSummary } from '@/server/auth/dal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

/**
 * The honest, real (non-demo) dashboard for `/app`, replacing `DemoDashboard`
 * once onboarding is complete. Renders only what is actually known — the
 * account just created — never an invented P&L, win rate, expectancy, or
 * chart, which is exactly what the fixture-driven demo shows instead. Trade
 * journaling itself is Phase 08+; this makes that explicit rather than
 * leaving an empty gap or, worse, a fabricated number.
 *
 * `useTranslations` rather than `getTranslations` — same reasoning as
 * `TradingAccountIndicator`: `account` is already resolved by the caller, so
 * nothing here needs to be async, and staying synchronous keeps this
 * directly unit-testable without an RSC request context.
 */
export function EmptyTradingDashboard({ account }: { account: ActiveTradingAccountSummary }) {
  const t = useTranslations('dashboard');

  return (
    <div className="flex flex-col gap-6">
      <Card role="region" aria-label={t('activeAccountRegionLabel')}>
        <CardHeader>
          <CardTitle>{account.name}</CardTitle>
          <CardDescription>{t('activeAccountSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <SummaryStat
            label={t('accountModeLabel')}
            value={t(`accountModeValues.${account.accountMode}`)}
          />
          <SummaryStat label={t('baseCurrencyLabel')} value={account.baseCurrency} />
          <SummaryStat
            label={t('startingBalanceLabel')}
            value={`${account.startingBalance} ${account.baseCurrency}`}
          />
        </CardContent>
      </Card>

      <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6 sm:flex-row sm:items-center sm:gap-4">
        <Rocket className="text-primary size-6 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-foreground text-sm font-medium">{t('noTradesTitle')}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('noTradesDescription')}
          </p>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-foreground text-lg font-semibold">{value}</span>
    </div>
  );
}

/**
 * Recovery state (phase brief's "Onboarding complete but active account
 * missing or invalid"): every account in the workspace was archived (or
 * onboarding's own repair logic found nothing usable) after onboarding
 * already completed. Full archive/account management is Phase 3B; this is
 * the safe fallback until then, rather than rendering a page as if an
 * account existed when none does.
 */
export function NoActiveTradingAccountRecovery() {
  const t = useTranslations('dashboard');

  return (
    <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6">
      <p className="text-foreground text-sm font-medium">{t('noActiveAccountTitle')}</p>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('noActiveAccountDescription')}
      </p>
      <Link
        href="/app/onboarding"
        className="text-primary-foreground bg-primary hover:bg-primary/90 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
      >
        {t('noActiveAccountCta')}
      </Link>
    </div>
  );
}
