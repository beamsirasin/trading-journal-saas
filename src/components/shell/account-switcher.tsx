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
  canCreateAccount,
}: {
  activeAccount: ActiveTradingAccountSummary;
  accounts: readonly ActiveTradingAccountSummary[];
  /** Gates the "Create account" menu entry only — a navigation link, not a mutation, so the real enforcement still happens on `/app/accounts/new` and at submission. */
  canCreateAccount: boolean;
}) {
  const t = useTranslations('accounts.switcher');
  const tOnboarding = useTranslations('onboarding');
  const tEntitlements = useTranslations('entitlements');
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
        {/*
          Below `sm`, this must cost the header exactly the same 44px budget
          as its icon-only siblings (`LanguageSwitcher`, `ThemeToggle`,
          `AccountMenu` on mobile) — `size="icon"` + `size-11` is that same
          shared pattern. The bordered pill with name/mode text and a chevron
          only appears at `sm:` and up (`sm:w-auto sm:border sm:bg-muted/50
          sm:px-2.5`); at the smallest viewports (Brand's own doc comment
          already documents this header row as having no width left to
          spare), the extra ~20px this control used to cost unconditionally
          — even with its name/mode text already hidden — was enough on its
          own to push the header wider than the viewport.
        */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:border-border sm:bg-muted/50 size-11 gap-2 sm:h-11 sm:w-auto sm:justify-start sm:border sm:px-2.5"
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
          <ChevronDown
            className="text-muted-foreground hidden size-3.5 shrink-0 sm:block"
            aria-hidden="true"
          />
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
          {/*
            Still a real link even when blocked — `/app/accounts/new` is the
            one place that explains WHY creation is unavailable and offers
            next steps (upgrade, view plans). A fully disabled menu item
            here would dead-end the user with no explanation, so this only
            signals unavailability visually (muted, no icon emphasis) rather
            than blocking the click.
          */}
          <Link
            href="/app/accounts/new"
            className={canCreateAccount ? undefined : 'text-muted-foreground'}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('createAccount')}
            {canCreateAccount ? null : (
              <span className="text-muted-foreground ml-auto text-xs">
                {tEntitlements('upgradeRequired')}
              </span>
            )}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
