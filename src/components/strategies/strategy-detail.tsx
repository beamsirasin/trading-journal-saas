'use client';

import { ArchiveRestore, ArrowLeft, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import { archiveStrategyAction, restoreStrategyAction } from '@/server/actions/strategies';
import type { StrategyDetail } from '@/server/dal/strategies';
import { SectionHeader } from '@/components/product/page-header';
import { RulesManager } from '@/components/strategies/rules-manager';
import { SetupConditionsManager } from '@/components/strategies/setup-conditions-manager';
import { SetupList } from '@/components/strategies/setup-list';
import { StrategyFormDialog } from '@/components/strategies/strategy-form';
import { VersionSummary, type VersionHistoryEntry } from '@/components/strategies/version-summary';
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

export type StrategyDetailView = Omit<StrategyDetail, 'versionHistory'> & {
  readonly versionHistory: readonly VersionHistoryEntry[];
};

/**
 * The right/detail column of `/app/strategies` for the currently selected
 * Strategy — Strategy header/actions, current-Version status, Setups, Rules.
 * Every mutation flows through `onMutated`, which `StrategiesManager` uses to
 * show a feedback message and `router.refresh()` (re-running the Server
 * Component read, the only source of truth for this data).
 */
export function StrategyDetail({
  strategy,
  canWrite,
  writeBlockReason,
  onMutated,
  onBack,
}: {
  strategy: StrategyDetailView;
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
  onMutated: (key: string) => void;
  onBack: () => void;
}) {
  const t = useTranslations('strategies');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const headingId = 'strategy-detail-heading';
  const canEdit = canWrite && !strategy.isStrategyArchived;

  const ruleCountBySetupId: Record<string, number> = {};
  for (const [setupId, rules] of Object.entries(strategy.setupLevelRulesBySetupId)) {
    ruleCountBySetupId[setupId] = rules.length;
  }

  async function handleArchive() {
    setIsPending(true);
    const result = await archiveStrategyAction({ strategyId: strategy.strategyId });
    setIsPending(false);
    if (result.ok) onMutated('strategyArchived');
  }

  async function handleRestore() {
    setIsPending(true);
    const result = await restoreStrategyAction({ strategyId: strategy.strategyId });
    setIsPending(false);
    if (result.ok) onMutated('strategyRestored');
  }

  return (
    <div className="flex flex-col gap-8" role="region" aria-labelledby={headingId}>
      <Button variant="ghost" size="sm" onClick={onBack} className="w-fit gap-1.5 lg:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('backToList')}
      </Button>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-card-title min-w-0 break-words">
                {strategy.currentVersion.name}
              </h2>
              {strategy.isStrategyArchived ? (
                <Badge variant="neutral">
                  <ArchiveRestore className="size-3.5" aria-hidden="true" />
                  {t('archived')}
                </Badge>
              ) : null}
            </div>
            {strategy.currentVersion.description === null ? null : (
              <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
                {strategy.currentVersion.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <StrategyFormDialog
                mode="edit"
                strategyId={strategy.strategyId}
                isCurrentVersionLocked={strategy.currentVersion.isCurrentVersionLocked}
                initialValues={{
                  name: strategy.currentVersion.name,
                  description: strategy.currentVersion.description ?? '',
                  notes: strategy.currentVersion.notes ?? '',
                }}
                trigger={
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Pencil className="size-3.5" aria-hidden="true" />
                    {t('edit')}
                  </Button>
                }
                onSuccess={() => onMutated('strategyUpdated')}
              />
            ) : null}

            {strategy.isStrategyArchived ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || !canWrite}
                onClick={() => void handleRestore()}
              >
                {t('restore')}
              </Button>
            ) : (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending || !canWrite}
                    className="text-destructive"
                  >
                    {t('archive')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('archiveStrategyDialogTitle', { name: strategy.currentVersion.name })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('archiveStrategyDialogDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        setConfirmOpen(false);
                        void handleArchive();
                      }}
                    >
                      {t('archiveConfirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {strategy.isStrategyArchived ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('strategyArchivedNotice')}
          </p>
        ) : !canWrite && writeBlockReason !== null ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(`errors.${writeBlockReason}` as Parameters<typeof t>[0])}
          </p>
        ) : null}

        {strategy.currentVersion.notes === null ? null : (
          <div className="border-border bg-muted/30 rounded-lg border p-3">
            <SectionHeader as="h3" title={t('notesLabel')} />
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {strategy.currentVersion.notes}
            </p>
          </div>
        )}

        <VersionSummary
          versionNumber={strategy.currentVersion.versionNumber}
          isLocked={strategy.currentVersion.isCurrentVersionLocked}
          versionCount={strategy.versionCount}
          versionHistory={strategy.versionHistory}
        />
      </div>

      <SetupList
        strategyId={strategy.strategyId}
        isStrategyArchived={strategy.isStrategyArchived}
        isCurrentVersionLocked={strategy.currentVersion.isCurrentVersionLocked}
        setups={strategy.setups}
        ruleCountBySetupId={ruleCountBySetupId}
        canWrite={canWrite}
        writeBlockReason={writeBlockReason}
        onMutated={onMutated}
      />

      <SetupConditionsManager
        strategyId={strategy.strategyId}
        setups={strategy.setups}
        conditionsBySetupId={strategy.setupConditionsBySetupId}
        isStrategyArchived={strategy.isStrategyArchived}
        isCurrentVersionLocked={strategy.currentVersion.isCurrentVersionLocked}
        canWrite={canWrite}
        onMutated={onMutated}
      />

      <RulesManager
        strategyId={strategy.strategyId}
        isStrategyArchived={strategy.isStrategyArchived}
        isCurrentVersionLocked={strategy.currentVersion.isCurrentVersionLocked}
        strategyLevelRules={strategy.strategyLevelRules}
        setupLevelRulesBySetupId={strategy.setupLevelRulesBySetupId}
        setups={strategy.setups}
        canWrite={canWrite}
        writeBlockReason={writeBlockReason}
        onMutated={onMutated}
      />
    </div>
  );
}
