import { Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatStartingBalance } from '@/lib/trading-accounts/presentation';
import { cn } from '@/lib/utils';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';
import { MetricLabel } from '@/components/product/metric';
import { Card, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

/**
 * The honest empty state for a real active Account. It renders only what is
 * known and directs the user to record a Trade; it never substitutes fixture
 * P&L, win rate, expectancy, or chart data.
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
      <ActiveTradingAccountSummaryCard account={account} />

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

/**
 * CONTEXT, NOT A WIDGET.
 *
 * This says which account the figures below belong to. Through D4 it said so
 * in a 173px-tall card whose three facts were spread across the full page
 * width by a `sm:grid-cols-3` — taller than a Basic KPI card, and the most
 * visually prominent thing above the fold, for information nobody reads
 * twice. D4.5 compresses it to a single ~74px bar: identity on the left,
 * the three facts as a right-aligned cluster that stays clustered however
 * wide the canvas gets.
 *
 * Nothing was dropped to get there. Name, subtitle, mode, base currency and
 * starting balance are all still present and still labelled; only their
 * geometry and type scale changed. The account name stays a heading so the
 * labelled region still has a findable title.
 *
 * Below `sm` the bar becomes a stack, which is the one place this may take
 * more than one line.
 */
export function ActiveTradingAccountSummaryCard({
  account,
  className,
}: {
  account: ActiveTradingAccountSummary;
  className?: string;
}) {
  const t = useTranslations('dashboard');
  return (
    <Card
      role="region"
      aria-label={t('activeAccountRegionLabel')}
      data-dashboard-region="account-context"
      className={cn(
        'flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground text-xs leading-4">
          {t('activeAccountSubtitle')}
        </span>
        <CardTitle className="truncate leading-6">{account.name}</CardTitle>
      </div>
      <dl className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2 sm:gap-x-8">
        <SummaryStat
          label={t('accountModeLabel')}
          value={t(`accountModeValues.${account.accountMode}`)}
        />
        <SummaryStat label={t('baseCurrencyLabel')} value={account.baseCurrency} />
        <SummaryStat
          label={t('startingBalanceLabel')}
          value={formatStartingBalance(account.startingBalance, account.baseCurrency)}
        />
      </dl>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt>
        <MetricLabel>{label}</MetricLabel>
      </dt>
      <dd className="text-foreground truncate text-sm leading-5 font-semibold">{value}</dd>
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
        href="/app/accounts"
        className="text-primary-foreground bg-primary hover:bg-primary/90 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
      >
        {t('noActiveAccountCta')}
      </Link>
    </div>
  );
}
