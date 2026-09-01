'use client';

import { Check, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import {
  buildDashboardHref,
  type DashboardFilterState,
  type DashboardHrefOptions,
} from '@/lib/dashboard/filters';
import { cn } from '@/lib/utils';
import { setActiveTradingAccountAction } from '@/server/actions/trading-accounts';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';
import { useDashboardStateNavigation } from '@/components/dashboard/dashboard-state-link';

import { ToolbarDisclosure } from './toolbar-disclosure';
import { ToolbarTrigger } from './toolbar-trigger';

/**
 * Toolbar Account selection.
 *
 * TWO DIFFERENT KINDS OF CHOICE, DELIBERATELY.
 *
 *   A named Account  -> the PRODUCT's active-account model. It calls the
 *                       existing `setActiveTradingAccountAction`, which keeps
 *                       its own workspace membership and entitlement checks,
 *                       and then lands on a URL with NO `account` key at all.
 *                       An omitted key means "the trusted persisted active
 *                       Account", so the reader's choice survives every other
 *                       page, every share of the link, and every later
 *                       Dashboard transition.
 *
 *   All accounts     -> an explicit ANALYTICAL scope override, `account=all`,
 *                       which the canonical serializer already owns. It
 *                       persists nothing, because "look across every account
 *                       for a moment" is a question, not a preference.
 *
 * NO ACCOUNT UUID IS EVER WRITTEN INTO THE DASHBOARD URL BY THIS CONTROL. That
 * is the frozen finding: the persisted active Account must not be forced into
 * every link. Selecting a named Account therefore CLEARS any explicit
 * `account=<uuid>` override that a deep link had carried in, rather than
 * rewriting it.
 *
 * The account id travels to a server action, never to a trusted client-side
 * scope decision — the action re-derives workspace and membership from the
 * session, exactly as the shell switcher does.
 */
export function DashboardAccountControl({
  filters,
  accounts,
  activeAccountId,
  href,
  className,
  labelClassName,
}: {
  filters: DashboardFilterState;
  /** Every non-archived Account in the active workspace. */
  accounts: readonly ActiveTradingAccountSummary[];
  /** The persisted active Account, re-validated server-side. `null` before onboarding. */
  activeAccountId: string | null;
  /**
   * Where this control's transitions land, and what non-filter page state
   * rides along. Omitted on the Dashboard, which keeps the `/app` default.
   */
  href?: DashboardHrefOptions;
  className?: string;
  labelClassName?: string;
}) {
  const t = useTranslations('dashboard.toolbar.account');
  const tOnboarding = useTranslations('onboarding');
  const navigate = useDashboardStateNavigation();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);

  const isAllScope = filters.accountScope.kind === 'all';
  const explicitAccountId =
    filters.accountScope.kind === 'account' ? filters.accountScope.accountId : null;
  const selectedAccountId = explicitAccountId ?? activeAccountId;
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const triggerLabel = isAllScope ? t('allAccounts') : (selectedAccount?.name ?? t('noAccount'));

  function handleSelectAll() {
    if (isAllScope) {
      setOpen(false);
      return;
    }
    setOpen(false);
    navigate(buildDashboardHref({ ...filters, accountScope: { kind: 'all' } }, href));
  }

  function handleSelectAccount(accountId: string) {
    // Already both persisted AND unqualified in the URL: nothing to do, and a
    // no-op full document navigation is not nothing.
    if (!isAllScope && explicitAccountId === null && accountId === activeAccountId) {
      setOpen(false);
      return;
    }
    if (isPending) return;
    setPendingAccountId(accountId);
    startTransition(async () => {
      const result = await setActiveTradingAccountAction(accountId);
      setPendingAccountId(null);
      if (!result.ok) return;
      setOpen(false);
      // ONE transition, after the preference has actually been written — so
      // the page that loads reads the account the reader just chose rather
      // than racing the write.
      navigate(buildDashboardHref({ ...filters, accountScope: { kind: 'active' } }, href));
    });
  }

  return (
    <ToolbarDisclosure
      open={open}
      onOpenChange={setOpen}
      title={t('title')}
      popoverClassName="w-72"
      trigger={
        <ToolbarTrigger
          data-dashboard-toolbar-control="account"
          aria-label={t('triggerLabel', { account: triggerLabel })}
          className={className}
          labelClassName={cn('max-w-36', labelClassName)}
          icon={<Wallet className="size-4" aria-hidden="true" />}
        >
          {triggerLabel}
        </ToolbarTrigger>
      }
    >
      <div role="group" aria-label={t('title')} className="flex min-w-0 flex-col gap-1">
        <AccountOption
          label={t('allAccounts')}
          description={t('allAccountsDescription')}
          selected={isAllScope}
          disabled={isPending}
          onSelect={handleSelectAll}
          testValue="all"
        />
        <div className="border-border my-1 border-t" aria-hidden="true" />
        {accounts.map((account) => (
          <AccountOption
            key={account.id}
            label={account.name}
            description={`${tOnboarding(`accountModeValues.${account.accountMode}`)} · ${account.baseCurrency}`}
            selected={!isAllScope && account.id === selectedAccountId}
            disabled={isPending && pendingAccountId !== account.id}
            onSelect={() => handleSelectAccount(account.id)}
            testValue={account.id}
          />
        ))}
      </div>
    </ToolbarDisclosure>
  );
}

function AccountOption({
  label,
  description,
  selected,
  disabled,
  onSelect,
  testValue,
}: {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  testValue: string;
}) {
  const t = useTranslations('dashboard.toolbar.account');
  return (
    <button
      type="button"
      data-dashboard-account-option={testValue}
      aria-current={selected ? 'true' : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'focus-visible:ring-ring flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2',
        'disabled:pointer-events-none disabled:opacity-60',
        selected ? 'bg-secondary' : 'hover:bg-accent',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground truncate text-sm font-medium">{label}</span>
        <span className="text-muted-foreground truncate text-xs">{description}</span>
      </span>
      {selected ? (
        <span className="flex shrink-0 items-center gap-1">
          <Check className="text-primary size-4" aria-hidden="true" />
          <span className="sr-only">{t('current')}</span>
        </span>
      ) : null}
    </button>
  );
}
