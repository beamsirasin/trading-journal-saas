'use client';

import { ArchiveRestore, Layers, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import { archiveSetupAction, restoreSetupAction } from '@/server/actions/strategies';
import type { StrategySetupDetail } from '@/server/dal/strategies';
import { EmptyState } from '@/components/product/empty-state';
import { SectionHeader } from '@/components/product/page-header';
import { SetupFormDialog } from '@/components/strategies/setup-form';
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

/**
 * The Setups section inside a selected Strategy's detail panel. One Setup
 * list rather than separate active/archived sections (Phase 06E brief §8) —
 * each card carries its own effective-availability badge instead, since
 * "individually archived" and "unavailable because the parent Strategy is
 * archived" are two different facts that must never collapse into one.
 */
export function SetupList({
  strategyId,
  isStrategyArchived,
  isCurrentVersionLocked,
  setups,
  ruleCountBySetupId,
  canWrite,
  writeBlockReason,
  onMutated,
}: {
  strategyId: string;
  isStrategyArchived: boolean;
  isCurrentVersionLocked: boolean;
  setups: readonly StrategySetupDetail[];
  ruleCountBySetupId: Readonly<Record<string, number>>;
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
  onMutated: (key: string) => void;
}) {
  const t = useTranslations('strategies');
  const canCreate = canWrite && !isStrategyArchived;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        id="setups-heading"
        title={t('setupsHeading')}
        description={t('setupsDescription')}
        actions={
          // The empty state below already owns the one create action while
          // there are no Setups yet (CLAUDE.md §8's "one clear first
          // action") — showing both here and there would be two
          // identically-labelled buttons for the same action.
          canCreate && setups.length > 0 ? (
            <SetupFormDialog
              mode="create"
              strategyId={strategyId}
              isCurrentVersionLocked={isCurrentVersionLocked}
              defaultSortOrder={setups.length}
              trigger={
                <Button size="sm" className="gap-1.5">
                  <Plus className="size-4" aria-hidden="true" />
                  {t('createSetup')}
                </Button>
              }
              onSuccess={() => onMutated('setupCreated')}
            />
          ) : null
        }
      />

      {isStrategyArchived ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('setupsUnavailableStrategyArchived')}
        </p>
      ) : !canWrite && writeBlockReason !== null ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(`errors.${writeBlockReason}` as Parameters<typeof t>[0])}
        </p>
      ) : null}

      {setups.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('noSetupsTitle')}
          description={t('noSetupsDescription')}
          action={
            canCreate ? (
              <SetupFormDialog
                mode="create"
                strategyId={strategyId}
                isCurrentVersionLocked={isCurrentVersionLocked}
                defaultSortOrder={0}
                trigger={<Button size="sm">{t('createSetup')}</Button>}
                onSuccess={() => onMutated('setupCreated')}
              />
            ) : null
          }
        />
      ) : (
        <ul
          aria-labelledby="setups-heading"
          className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border"
        >
          {setups.map((setup) => (
            <li key={setup.setupId}>
              <SetupCard
                strategyId={strategyId}
                setup={setup}
                isStrategyArchived={isStrategyArchived}
                isCurrentVersionLocked={isCurrentVersionLocked}
                ruleCount={ruleCountBySetupId[setup.setupId] ?? 0}
                canWrite={canWrite}
                onMutated={onMutated}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SetupCard({
  strategyId,
  setup,
  isStrategyArchived,
  isCurrentVersionLocked,
  ruleCount,
  canWrite,
  onMutated,
}: {
  strategyId: string;
  setup: StrategySetupDetail;
  isStrategyArchived: boolean;
  isCurrentVersionLocked: boolean;
  ruleCount: number;
  canWrite: boolean;
  onMutated: (key: string) => void;
}) {
  const t = useTranslations('strategies');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const headingId = `setup-card-heading-${setup.setupId}`;
  const canEdit = canWrite && !isStrategyArchived && !setup.isSetupArchived;
  const canToggleLifecycle = canWrite && !isStrategyArchived;

  async function handleArchive() {
    setIsPending(true);
    const result = await archiveSetupAction({ strategyId, setupId: setup.setupId });
    setIsPending(false);
    if (result.ok) onMutated('setupArchived');
  }

  async function handleRestore() {
    setIsPending(true);
    const result = await restoreSetupAction({ strategyId, setupId: setup.setupId });
    setIsPending(false);
    if (result.ok) onMutated('setupRestored');
  }

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className="flex h-full flex-col rounded-none border-0"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id={headingId}>{setup.name}</CardTitle>
          {setup.isEffectivelyAvailable ? (
            <Badge variant="positive">{t('availableSetups')}</Badge>
          ) : setup.isSetupArchived ? (
            <Badge variant="neutral">
              <ArchiveRestore className="size-3.5" aria-hidden="true" />
              {t('archived')}
            </Badge>
          ) : (
            <Badge variant="warning">{t('unavailableStrategyArchived')}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {setup.description === null ? null : (
          <p className="text-muted-foreground text-sm leading-relaxed">{setup.description}</p>
        )}
        <p className="text-muted-foreground text-xs">{t('ruleCountLabel', { count: ruleCount })}</p>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {canEdit ? (
            <SetupFormDialog
              mode="edit"
              strategyId={strategyId}
              setupId={setup.setupId}
              isCurrentVersionLocked={isCurrentVersionLocked}
              initialValues={{
                name: setup.name,
                description: setup.description ?? '',
                sortOrder: String(setup.sortOrder),
              }}
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Pencil className="size-3.5" aria-hidden="true" />
                  {t('edit')}
                </Button>
              }
              onSuccess={() => onMutated('setupUpdated')}
            />
          ) : null}

          {!setup.isSetupArchived && canToggleLifecycle ? (
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  className="text-destructive"
                >
                  {t('archive')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('archiveSetupDialogTitle', { name: setup.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('archiveSetupDialogDescription')}
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
          ) : null}

          {setup.isSetupArchived ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending || !canToggleLifecycle}
              onClick={() => void handleRestore()}
            >
              {t('restore')}
            </Button>
          ) : null}
        </div>
        {setup.isSetupArchived && !canToggleLifecycle ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('restoreBlockedStrategyArchived')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
