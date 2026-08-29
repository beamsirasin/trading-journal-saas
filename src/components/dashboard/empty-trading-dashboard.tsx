import { Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatStartingBalance } from '@/lib/trading-accounts/presentation';
import { cn } from '@/lib/utils';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';
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
 * width by a `sm:grid-cols-3`; D4.5 compressed that to a ~74px bar with a
 * left identity block and a right-aligned label/value cluster.
 *
 * THIS PASS MAKES IT A STRIP RATHER THAN A BAR. The D4.5 bar still spent two
 * stacked lines on the left (a four-word caption over the account name) and
 * three stacked label/value pairs on the right, which on a 1440 canvas left
 * roughly 700px of nothing between them — the widest empty region in the
 * first viewport, above the figures the page exists to show. Everything now
 * sits on ONE baseline: the label and the name read as a sentence, mode and
 * currency become chips (a chip IS its own label — "Live" and "USD" need no
 * caption beside a named account), and only the starting balance keeps a
 * visible label, because a bare "$10,000.00" beside an account name is
 * genuinely ambiguous.
 *
 * NOTHING WAS DROPPED, AND NOTHING BECAME COLOUR-ONLY. Every fact and every
 * label is still in the DOM and still associated with its value through the
 * same `<dl>`; the two that lost a VISIBLE caption kept an `sr-only` one, so
 * a screen reader still hears "Account mode: Live", not a loose "Live".
 *
 * It is deliberately NOT a second account selector. The toolbar owns
 * switching; this is read-only context, so it carries no control, no
 * chevron, and no affordance that would invite a click.
 *
 * Below `sm` it becomes a stack, which is the one place this may take more
 * than one line.
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
        'flex min-w-0 flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-muted-foreground shrink-0 text-xs leading-5">
          {t('activeAccountInlineLabel')}
        </span>
        <CardTitle className="min-w-0 truncate text-sm leading-5">{account.name}</CardTitle>
        <dl className="flex min-w-0 flex-wrap items-center gap-1.5">
          <AccountChip
            label={t('accountModeLabel')}
            value={t(`accountModeValues.${account.accountMode}`)}
          />
          <AccountChip label={t('baseCurrencyLabel')} value={account.baseCurrency} />
        </dl>
      </div>
      <dl className="flex min-w-0 shrink-0 items-baseline gap-2">
        <dt className="text-muted-foreground text-xs leading-5">{t('startingBalanceLabel')}</dt>
        <dd className="text-foreground numeric truncate text-sm leading-5 font-semibold">
          {formatStartingBalance(account.startingBalance, account.baseCurrency)}
        </dd>
      </dl>
    </Card>
  );
}

/**
 * One read-only metadata chip.
 *
 * The caption is `sr-only` rather than absent: a chip reading "Live" is
 * unambiguous NEXT TO an account name and nowhere else, and a screen reader
 * gets no such adjacency.
 *
 * `bg-muted`, not `bg-surface-raised`. Both resolve to the frozen `#262626`
 * step in dark, so on the theme this pass is led by they are the same pixel —
 * but in light `--surface-raised` is `#ffffff`, the card's own colour, and
 * the chips vanished into it entirely. `--muted` is the token that is a step
 * off the card in BOTH themes, which is the whole job here. No border either
 * way: a row of bordered pills inside a bordered strip is precisely the
 * nested boxes §14 rules out.
 */
function AccountChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted text-foreground flex shrink-0 items-baseline rounded-md px-1.5 py-0.5">
      <dt className="sr-only">{label}</dt>
      <dd className="text-xs leading-4 font-medium">{value}</dd>
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
