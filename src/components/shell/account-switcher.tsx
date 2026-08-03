'use client';

import { Check, ChevronDown, Plus, Settings, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { setActiveTradingAccountAction } from '@/server/actions/trading-accounts';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * Phase 3B's upgrade of Phase 3A's static `TradingAccountIndicator` into a
 * real switcher — every non-archived account in the workspace, selectable,
 * with links into full account management.
 *
 * Switching never navigates to a client-supplied destination (Phase 3B
 * brief: "prefer refreshing the current localized app route... rather than
 * accepting arbitrary client redirect destinations" — the open-redirect
 * concern that instruction guards against). `router.refresh()` re-renders
 * whatever page is currently open with the new active account's data; there
 * is no return-URL parameter anywhere in this component for an attacker to
 * forge.
 */
export function AccountSwitcher({
  activeAccount,
  accounts,
}: {
  activeAccount: ActiveTradingAccountSummary;
  accounts: readonly ActiveTradingAccountSummary[];
}) {
  const t = useTranslations('accounts.switcher');
  const tOnboarding = useTranslations('onboarding');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);

  function handleSelect(accountId: string) {
    if (isPending || accountId === activeAccount.id) {
      setOpen(false);
      return;
    }
    setPendingAccountId(accountId);
    startTransition(async () => {
      await setActiveTradingAccountAction(accountId);
      setPendingAccountId(null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="border-border bg-muted/50 min-h-11 gap-2 border px-2.5"
          aria-label={t('menuLabel')}
        >
          <Wallet className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="text-foreground max-w-32 truncate text-xs font-medium">
              {activeAccount.name}
            </span>
            <span className="text-muted-foreground truncate text-[11px]">
              {tOnboarding(`accountModeValues.${activeAccount.accountMode}`)} ·{' '}
              {activeAccount.baseCurrency}
            </span>
          </span>
          <span className="sr-only">{activeAccount.name}</span>
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="text-muted-foreground text-label font-normal uppercase">
          {t('accountsHeading')}
        </DropdownMenuLabel>
        {accounts.map((account) => {
          const isCurrent = account.id === activeAccount.id;
          return (
            <DropdownMenuItem
              key={account.id}
              onSelect={() => handleSelect(account.id)}
              disabled={isPending && pendingAccountId !== account.id}
              aria-current={isCurrent ? 'true' : undefined}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{account.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {tOnboarding(`accountModeValues.${account.accountMode}`)} · {account.baseCurrency}
                </span>
              </span>
              {isCurrent ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Check className="text-primary size-4" aria-hidden="true" />
                  <span className="sr-only">{t('currentAccount')}</span>
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/app/accounts">
            <Settings className="size-4" aria-hidden="true" />
            {t('manageAccounts')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/app/accounts/new">
            <Plus className="size-4" aria-hidden="true" />
            {t('createAccount')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
