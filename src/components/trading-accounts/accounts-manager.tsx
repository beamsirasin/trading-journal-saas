'use client';

import { ArchiveRestore, CircleAlert, CircleCheck, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { resolveEntitlementGate } from '@/lib/entitlements/resolve';
import {
  archiveTradingAccountAction,
  restoreTradingAccountAction,
  setActiveTradingAccountAction,
} from '@/server/actions/trading-accounts';
import type { EffectiveEntitlement, TradingAccountRecord } from '@/server/auth/dal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link, useRouter } from '@/i18n/navigation';

type FeedbackStatus = 'created' | 'updated' | 'archived' | 'restored' | 'activated';

/**
 * The interactive shell behind `/app/accounts` — server-rendered data in,
 * every mutation (set active / archive / restore) out through the Phase 3B
 * server actions. A single client component rather than one per row: every
 * action needs to `router.refresh()` the whole list afterward (an archive
 * can change which account is active, a restore can change which accounts
 * are eligible to become active), so one shared pending/feedback state is
 * simpler and more correct than three independent islands guessing at each
 * other's effects.
 */
export function AccountsManager({
  activeAccounts,
  archivedAccounts,
  activeAccountId,
  entitlement,
  initialFeedback,
}: {
  activeAccounts: readonly TradingAccountRecord[];
  archivedAccounts: readonly TradingAccountRecord[];
  activeAccountId: string | null;
  /** `null` is the fail-closed anomaly case — treated as "cannot restore right now." */
  entitlement: EffectiveEntitlement | null;
  initialFeedback?: FeedbackStatus;
}) {
  const t = useTranslations('accounts');
  const tEntitlements = useTranslations('entitlements');
  const router = useRouter();
  // Fails closed on a `null` entitlement snapshot — the same helper
  // `accounts/page.tsx`'s Create button and `accounts/new/page.tsx` read,
  // so Restore can never independently drift into failing open again.
  const restoreGate = resolveEntitlementGate(entitlement);
  const [isPending, startTransition] = useTransition();
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    initialFeedback === undefined
      ? null
      : { tone: 'success', message: t(`feedback.${initialFeedback}`) },
  );

  function runAction(
    accountId: string,
    action: () => Promise<{ ok: true } | { ok: false; code: string }>,
    successKey: FeedbackStatus,
  ) {
    setPendingAccountId(accountId);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setFeedback({ tone: 'success', message: t(`feedback.${successKey}`) });
      } else {
        setFeedback({ tone: 'error', message: t(`errors.${result.code}`) });
      }
      setPendingAccountId(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {feedback === null ? null : (
        <div
          role="status"
          aria-live="polite"
          className={
            feedback.tone === 'success'
              ? 'border-positive/25 bg-positive/10 text-positive rounded-lg border p-4 text-sm font-medium'
              : 'border-destructive/25 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm font-medium'
          }
        >
          {feedback.message}
        </div>
      )}

      {entitlement === null ? (
        <div
          role="status"
          aria-label={tEntitlements('unavailableRegionLabel')}
          className="border-warning/30 bg-warning/10 flex items-center gap-3 rounded-lg border p-4 text-sm"
        >
          <CircleAlert className="text-warning size-4 shrink-0" aria-hidden="true" />
          <span className="text-foreground">{t('errors.entitlement_unavailable')}</span>
        </div>
      ) : entitlement.accountLimit === null ? null : (
        <div
          role="status"
          className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm"
        >
          <span className="text-foreground font-medium">{tEntitlements('usage.label')}</span>
          <span className="numeric text-muted-foreground">
            {tEntitlements('usage.value', {
              used: entitlement.activeAccountCount,
              limit: entitlement.accountLimit,
            })}
          </span>
          {entitlement.canCreateAccount ? (
            <span className="text-muted-foreground ml-auto">
              {tEntitlements('usage.remaining', { count: entitlement.remainingAccountSlots })}
            </span>
          ) : (
            <span className="text-warning ml-auto font-medium">
              {tEntitlements('usage.limitReached')}
            </span>
          )}
        </div>
      )}

      <section aria-labelledby="active-accounts-heading" className="flex flex-col gap-4">
        <h2 id="active-accounts-heading" className="text-card-title">
          {t('activeSectionTitle')}
        </h2>
        <ul aria-label={t('activeSectionTitle')} className="grid gap-4 sm:grid-cols-2">
          {activeAccounts.map((account) => (
            <li key={account.id}>
              <AccountCard
                account={account}
                isActive={account.id === activeAccountId}
                isPending={isPending && pendingAccountId === account.id}
                onSetActive={() =>
                  runAction(
                    account.id,
                    () => setActiveTradingAccountAction(account.id),
                    'activated',
                  )
                }
                onArchive={() =>
                  runAction(account.id, () => archiveTradingAccountAction(account.id), 'archived')
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="archived-accounts-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="archived-accounts-heading" className="text-card-title">
            {t('archivedSectionTitle')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('archivedSectionDescription')}</p>
        </div>
        {archivedAccounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noArchivedAccounts')}</p>
        ) : (
          <ul aria-label={t('archivedSectionTitle')} className="grid gap-4 sm:grid-cols-2">
            {archivedAccounts.map((account) => (
              <li key={account.id}>
                <ArchivedAccountCard
                  account={account}
                  isPending={isPending && pendingAccountId === account.id}
                  restoreBlockReason={restoreGate.blockReason}
                  onRestore={() =>
                    runAction(account.id, () => restoreTradingAccountAction(account.id), 'restored')
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AccountCard({
  account,
  isActive,
  isPending,
  onSetActive,
  onArchive,
}: {
  account: TradingAccountRecord;
  isActive: boolean;
  isPending: boolean;
  onSetActive: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations('accounts');
  const tOnboarding = useTranslations('onboarding');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const headingId = `account-card-heading-${account.id}`;

  return (
    <Card role="region" aria-labelledby={headingId} className="flex h-full flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id={headingId}>{account.name}</CardTitle>
          {isActive ? (
            <Badge variant="brand">
              <CircleCheck className="size-3.5" aria-hidden="true" />
              {t('activeStatus')}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {account.brokerName === null ? null : (
            <Field label={t('field.broker')} value={account.brokerName} />
          )}
          {account.platformName === null ? null : (
            <Field label={t('field.platform')} value={account.platformName} />
          )}
          <Field
            label={t('field.mode')}
            value={tOnboarding(`accountModeValues.${account.accountMode}`)}
          />
          <Field label={t('field.currency')} value={account.baseCurrency} />
          <Field
            label={t('field.startingBalance')}
            value={`${account.startingBalance} ${account.baseCurrency}`}
          />
          {account.riskPerTradePercent === null ? null : (
            <Field label={t('field.riskPerTrade')} value={`${account.riskPerTradePercent}%`} />
          )}
          {account.maximumDailyLossPercent === null ? null : (
            <Field
              label={t('field.maximumDailyLoss')}
              value={`${account.maximumDailyLossPercent}%`}
            />
          )}
        </dl>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/app/accounts/${account.id}/edit`}>
              <Pencil className="size-3.5" aria-hidden="true" />
              {t('edit')}
            </Link>
          </Button>
          {isActive ? null : (
            <Button variant="outline" size="sm" disabled={isPending} onClick={onSetActive}>
              {t('setActive')}
            </Button>
          )}
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending} className="text-destructive">
                {t('archive')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('archiveDialogTitle', { name: account.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('archiveDialogDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    setConfirmOpen(false);
                    onArchive();
                  }}
                >
                  {t('archiveConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function ArchivedAccountCard({
  account,
  isPending,
  restoreBlockReason,
  onRestore,
}: {
  account: TradingAccountRecord;
  isPending: boolean;
  /** `null` when restoring is allowed; otherwise the reason to show instead of attempting it. */
  restoreBlockReason: string | null;
  onRestore: () => void;
}) {
  const t = useTranslations('accounts');
  const tOnboarding = useTranslations('onboarding');
  const headingId = `archived-account-card-heading-${account.id}`;
  const restoreReasonId = `archived-account-restore-reason-${account.id}`;

  return (
    <Card role="region" aria-labelledby={headingId} className="bg-muted/30 flex h-full flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id={headingId}>{account.name}</CardTitle>
          <Badge variant="neutral">
            <ArchiveRestore className="size-3.5" aria-hidden="true" />
            {t('archivedStatus')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field
            label={t('field.mode')}
            value={tOnboarding(`accountModeValues.${account.accountMode}`)}
          />
          <Field label={t('field.currency')} value={account.baseCurrency} />
        </dl>
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || restoreBlockReason !== null}
            aria-describedby={restoreBlockReason === null ? undefined : restoreReasonId}
            onClick={onRestore}
            className="self-start"
          >
            {t('restore')}
          </Button>
          {restoreBlockReason === null ? null : (
            <p id={restoreReasonId} className="text-muted-foreground text-xs leading-relaxed">
              {t(`errors.${restoreBlockReason}` as Parameters<typeof t>[0])}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground font-medium">{value}</dd>
    </div>
  );
}
