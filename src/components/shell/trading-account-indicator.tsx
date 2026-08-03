import { Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';

/**
 * Phase 3A's minimal active-account indicator — a single account, no
 * switcher. A real switcher (multiple accounts, an interactive menu to
 * change which is active) is explicitly Phase 3B; this deliberately does
 * not simulate one with non-functional options.
 *
 * `useTranslations` rather than the async `getTranslations` — the same
 * choice `DemoBadge` (`src/components/product/demo-badge.tsx`) already
 * makes for a small server-renderable piece of `AppShell`. It keeps this
 * component a plain synchronous function, directly unit-testable with
 * `NextIntlClientProvider` rather than requiring a Next.js RSC request
 * context just to resolve a translation.
 */
export function TradingAccountIndicator({
  account,
  className,
}: {
  account: ActiveTradingAccountSummary;
  className?: string;
}) {
  const t = useTranslations('appNav.account');

  return (
    <div
      className={cn(
        'border-border bg-muted/50 hidden items-center gap-2 rounded-md border px-2.5 py-1.5 sm:flex',
        className,
      )}
    >
      <Wallet className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="sr-only">{t('activeTradingAccount')}</span>
        <span className="text-foreground max-w-32 truncate text-xs font-medium">
          {account.name}
        </span>
        <span className="text-muted-foreground truncate text-[11px]">
          {t(`accountModeValues.${account.accountMode}`)} · {account.baseCurrency}
        </span>
      </div>
    </div>
  );
}
