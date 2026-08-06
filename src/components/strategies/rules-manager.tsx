'use client';

import { CircleCheck, ClipboardList, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import type { StrategyRuleCategory } from '@/lib/strategies/constants';
import { removeStrategyRuleAction } from '@/server/actions/strategies';
import type { StrategyRuleDetail, StrategySetupDetail } from '@/server/dal/strategies';
import { EmptyState } from '@/components/product/empty-state';
import { SectionHeader } from '@/components/product/page-header';
import { RuleFormDialog } from '@/components/strategies/rule-form';
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

/**
 * The Rules section — Strategy-level Rules, then Rules grouped beneath each
 * Setup (Phase 06E brief §9). A Setup with no Rules yet still gets its own
 * (empty) group heading, matching "structured Rules can later support
 * discipline analysis" rather than disappearing entirely.
 */
export function RulesManager({
  strategyId,
  isStrategyArchived,
  isCurrentVersionLocked,
  strategyLevelRules,
  setupLevelRulesBySetupId,
  setups,
  canWrite,
  writeBlockReason,
  onMutated,
}: {
  strategyId: string;
  isStrategyArchived: boolean;
  isCurrentVersionLocked: boolean;
  strategyLevelRules: readonly StrategyRuleDetail[];
  setupLevelRulesBySetupId: Readonly<Record<string, readonly StrategyRuleDetail[]>>;
  setups: readonly StrategySetupDetail[];
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
  onMutated: (key: string) => void;
}) {
  const t = useTranslations('strategies');
  const canCreate = canWrite && !isStrategyArchived;
  const availableSetups = setups
    .filter((setup) => !setup.isSetupArchived)
    .map((setup) => ({ setupId: setup.setupId, name: setup.name }));
  const totalRuleCount =
    strategyLevelRules.length +
    Object.values(setupLevelRulesBySetupId).reduce((sum, rules) => sum + rules.length, 0);
  const nextStrategySortOrder = strategyLevelRules.length;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        id="rules-heading"
        title={t('rulesHeading')}
        description={t('rulesDescription')}
        actions={
          // Same "one create action, not two" reasoning as `SetupList` — the
          // empty state below owns it while there are no Rules yet.
          canCreate && totalRuleCount > 0 ? (
            <RuleFormDialog
              mode="create"
              strategyId={strategyId}
              isCurrentVersionLocked={isCurrentVersionLocked}
              availableSetups={availableSetups}
              defaultSetupId={null}
              defaultSortOrder={nextStrategySortOrder}
              trigger={<Button size="sm">{t('createRule')}</Button>}
              onSuccess={() => onMutated('ruleCreated')}
            />
          ) : null
        }
      />

      {isStrategyArchived ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('rulesUnavailableStrategyArchived')}
        </p>
      ) : !canWrite && writeBlockReason !== null ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(`errors.${writeBlockReason}` as Parameters<typeof t>[0])}
        </p>
      ) : null}

      {totalRuleCount === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t('noRulesTitle')}
          description={t('noRulesDescription')}
          action={
            canCreate ? (
              <RuleFormDialog
                mode="create"
                strategyId={strategyId}
                isCurrentVersionLocked={isCurrentVersionLocked}
                availableSetups={availableSetups}
                defaultSetupId={null}
                defaultSortOrder={0}
                trigger={<Button size="sm">{t('createRule')}</Button>}
                onSuccess={() => onMutated('ruleCreated')}
              />
            ) : null
          }
        />
      ) : (
        <>
          <RuleGroup
            title={t('strategyLevelRulesHeading')}
            rules={strategyLevelRules}
            strategyId={strategyId}
            scopeLabel={t('scopeStrategyLevel')}
            isCurrentVersionLocked={isCurrentVersionLocked}
            canWrite={canCreate}
            onMutated={onMutated}
          />
          {setups.map((setup) => (
            <RuleGroup
              key={setup.setupId}
              title={t('setupLevelRulesHeading', { name: setup.name })}
              rules={setupLevelRulesBySetupId[setup.setupId] ?? []}
              strategyId={strategyId}
              scopeLabel={setup.name}
              isCurrentVersionLocked={isCurrentVersionLocked}
              canWrite={canCreate && !setup.isSetupArchived}
              onMutated={onMutated}
            />
          ))}
        </>
      )}
    </div>
  );
}

function RuleGroup({
  title,
  rules,
  strategyId,
  scopeLabel,
  isCurrentVersionLocked,
  canWrite,
  onMutated,
}: {
  title: string;
  rules: readonly StrategyRuleDetail[];
  strategyId: string;
  scopeLabel: string;
  isCurrentVersionLocked: boolean;
  canWrite: boolean;
  onMutated: (key: string) => void;
}) {
  const t = useTranslations('strategies');
  if (rules.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">{t('noRulesInGroup')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li key={rule.ruleKey}>
            <RuleRow
              rule={rule}
              strategyId={strategyId}
              scopeLabel={scopeLabel}
              isCurrentVersionLocked={isCurrentVersionLocked}
              canWrite={canWrite}
              onMutated={onMutated}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleRow({
  rule,
  strategyId,
  scopeLabel,
  isCurrentVersionLocked,
  canWrite,
  onMutated,
}: {
  rule: StrategyRuleDetail;
  strategyId: string;
  scopeLabel: string;
  isCurrentVersionLocked: boolean;
  canWrite: boolean;
  onMutated: (key: string) => void;
}) {
  const t = useTranslations('strategies');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleRemove() {
    setIsPending(true);
    const result = await removeStrategyRuleAction({ strategyId, ruleKey: rule.ruleKey });
    setIsPending(false);
    if (result.ok) onMutated('ruleRemoved');
  }

  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm font-medium break-words">{rule.title}</span>
            <Badge variant="neutral">{t(`ruleCategories.${rule.category}`)}</Badge>
            {rule.isRequired ? <Badge variant="brand">{t('required')}</Badge> : null}
            {rule.isPreTradeCheck ? (
              <Badge variant="positive">
                <CircleCheck className="size-3.5" aria-hidden="true" />
                {t('preTradeCheck')}
              </Badge>
            ) : null}
          </div>
          {rule.description === null ? null : (
            <p className="text-muted-foreground text-xs leading-relaxed">{rule.description}</p>
          )}
        </div>
        {canWrite ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <RuleFormDialog
              mode="edit"
              strategyId={strategyId}
              ruleKey={rule.ruleKey}
              scopeLabel={scopeLabel}
              isCurrentVersionLocked={isCurrentVersionLocked}
              initialValues={{
                category: rule.category as StrategyRuleCategory,
                title: rule.title,
                description: rule.description ?? '',
                isRequired: rule.isRequired,
                isPreTradeCheck: rule.isPreTradeCheck,
                sortOrder: String(rule.sortOrder),
              }}
              trigger={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('editRuleAria', { title: rule.title })}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
              }
              onSuccess={() => onMutated('ruleUpdated')}
            />
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={isPending}
                  className="text-destructive"
                  aria-label={t('removeRuleAria', { title: rule.title })}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('removeRuleDialogTitle', { title: rule.title })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('removeRuleDialogDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      setConfirmOpen(false);
                      void handleRemove();
                    }}
                  >
                    {t('removeRuleConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>
    </div>
  );
}
