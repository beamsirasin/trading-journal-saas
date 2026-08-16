import 'server-only';

import { and, asc, eq, inArray, or } from 'drizzle-orm';

import type { WorkspaceExportSource } from '@/lib/export/workspace-export';
import { getDb } from '@/server/db/client';
import {
  billingTransactions,
  emotionTypes,
  mistakeTypes,
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeExits,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';

export type WorkspaceExportAccessErrorCode = 'workspace_not_found' | 'owner_required';

export class WorkspaceExportAccessError extends Error {
  readonly code: WorkspaceExportAccessErrorCode;

  constructor(code: WorkspaceExportAccessErrorCode) {
    super(`Workspace export access denied: ${code}`);
    this.name = 'WorkspaceExportAccessError';
    this.code = code;
  }
}

/**
 * Complete schema-v1 historical source read. Every select is an explicit
 * allowlist and workspace-scoped; archived and soft-deleted rows are not
 * filtered. The surrounding transaction gives all datasets one consistent
 * database snapshot.
 */
export async function readWorkspaceExportSource(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceExportSource> {
  return getDb().transaction(
    async (tx) => {
      const [membership] = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, 'active'),
          ),
        );
      if (membership === undefined) throw new WorkspaceExportAccessError('workspace_not_found');
      if (membership.role !== 'owner') throw new WorkspaceExportAccessError('owner_required');

      const workspace = await tx
        .select({
          id: workspaces.id,
          name: workspaces.name,
          kind: workspaces.kind,
          onboardingCompletedAt: workspaces.onboardingCompletedAt,
          createdAt: workspaces.createdAt,
          updatedAt: workspaces.updatedAt,
        })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .orderBy(asc(workspaces.id));
      if (workspace.length === 0) throw new WorkspaceExportAccessError('workspace_not_found');

      const accountRows = await tx
        .select({
          id: tradingAccounts.id,
          workspaceId: tradingAccounts.workspaceId,
          name: tradingAccounts.name,
          brokerName: tradingAccounts.brokerName,
          platformName: tradingAccounts.platformName,
          accountMode: tradingAccounts.accountMode,
          baseCurrency: tradingAccounts.baseCurrency,
          startingBalance: tradingAccounts.startingBalance,
          timezone: tradingAccounts.timezone,
          riskPerTradePercent: tradingAccounts.riskPerTradePercent,
          maximumDailyLossPercent: tradingAccounts.maximumDailyLossPercent,
          isArchived: tradingAccounts.isArchived,
          createdAt: tradingAccounts.createdAt,
          updatedAt: tradingAccounts.updatedAt,
        })
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId))
        .orderBy(asc(tradingAccounts.createdAt), asc(tradingAccounts.id));

      const strategyRows = await tx
        .select({
          id: strategies.id,
          workspaceId: strategies.workspaceId,
          currentVersionId: strategies.currentVersionId,
          isArchived: strategies.isArchived,
          createdAt: strategies.createdAt,
          updatedAt: strategies.updatedAt,
        })
        .from(strategies)
        .where(eq(strategies.workspaceId, workspaceId))
        .orderBy(asc(strategies.createdAt), asc(strategies.id));

      const strategyVersionRows = await tx
        .select({
          id: strategyVersions.id,
          workspaceId: strategyVersions.workspaceId,
          strategyId: strategyVersions.strategyId,
          versionNumber: strategyVersions.versionNumber,
          name: strategyVersions.name,
          description: strategyVersions.description,
          notes: strategyVersions.notes,
          changeNote: strategyVersions.changeNote,
          lockedAt: strategyVersions.lockedAt,
          createdAt: strategyVersions.createdAt,
          updatedAt: strategyVersions.updatedAt,
        })
        .from(strategyVersions)
        .where(eq(strategyVersions.workspaceId, workspaceId))
        .orderBy(
          asc(strategyVersions.strategyId),
          asc(strategyVersions.versionNumber),
          asc(strategyVersions.id),
        );

      const setupRows = await tx
        .select({
          id: setups.id,
          workspaceId: setups.workspaceId,
          strategyId: setups.strategyId,
          isArchived: setups.isArchived,
          createdAt: setups.createdAt,
          updatedAt: setups.updatedAt,
        })
        .from(setups)
        .where(eq(setups.workspaceId, workspaceId))
        .orderBy(asc(setups.strategyId), asc(setups.createdAt), asc(setups.id));

      const setupVersionRows = await tx
        .select({
          id: strategySetupVersions.id,
          workspaceId: strategySetupVersions.workspaceId,
          strategyId: strategySetupVersions.strategyId,
          strategyVersionId: strategySetupVersions.strategyVersionId,
          setupId: strategySetupVersions.setupId,
          name: strategySetupVersions.name,
          description: strategySetupVersions.description,
          sortOrder: strategySetupVersions.sortOrder,
          createdAt: strategySetupVersions.createdAt,
          updatedAt: strategySetupVersions.updatedAt,
        })
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.workspaceId, workspaceId))
        .orderBy(
          asc(strategySetupVersions.strategyId),
          asc(strategySetupVersions.strategyVersionId),
          asc(strategySetupVersions.sortOrder),
          asc(strategySetupVersions.id),
        );

      const ruleRows = await tx
        .select({
          id: strategyRules.id,
          workspaceId: strategyRules.workspaceId,
          strategyVersionId: strategyRules.strategyVersionId,
          setupVersionId: strategyRules.setupVersionId,
          ruleKey: strategyRules.ruleKey,
          category: strategyRules.category,
          title: strategyRules.title,
          description: strategyRules.description,
          isRequired: strategyRules.isRequired,
          isPreTradeCheck: strategyRules.isPreTradeCheck,
          sortOrder: strategyRules.sortOrder,
          createdAt: strategyRules.createdAt,
          updatedAt: strategyRules.updatedAt,
        })
        .from(strategyRules)
        .where(eq(strategyRules.workspaceId, workspaceId))
        .orderBy(
          asc(strategyRules.strategyVersionId),
          asc(strategyRules.sortOrder),
          asc(strategyRules.ruleKey),
          asc(strategyRules.id),
        );

      const setupConditionRows = await tx
        .select({
          id: setupConditions.id,
          workspaceId: setupConditions.workspaceId,
          setupId: setupConditions.setupId,
          setupVersionId: setupConditions.setupVersionId,
          conditionKey: setupConditions.conditionKey,
          label: setupConditions.label,
          sortOrder: setupConditions.sortOrder,
          createdAt: setupConditions.createdAt,
          updatedAt: setupConditions.updatedAt,
        })
        .from(setupConditions)
        .where(eq(setupConditions.workspaceId, workspaceId))
        .orderBy(
          asc(setupConditions.setupVersionId),
          asc(setupConditions.sortOrder),
          asc(setupConditions.conditionKey),
        );

      const tradeRows = await tx
        .select({
          id: trades.id,
          workspaceId: trades.workspaceId,
          tradingAccountId: trades.tradingAccountId,
          strategyId: trades.strategyId,
          strategyVersionId: trades.strategyVersionId,
          setupId: trades.setupId,
          setupVersionId: trades.setupVersionId,
          symbol: trades.symbol,
          direction: trades.direction,
          timeframe: trades.timeframe,
          session: trades.session,
          confirmationNotes: trades.confirmationNotes,
          confidence: trades.confidence,
          tradingviewUrl: trades.tradingviewUrl,
          notes: trades.notes,
          reviewNotes: trades.reviewNotes,
          emotionsRecordedAt: trades.emotionsRecordedAt,
          chartAttachmentStorageKey: trades.chartAttachmentStorageKey,
          chartAttachmentUploadedAt: trades.chartAttachmentUploadedAt,
          plannedEntry: trades.plannedEntry,
          plannedStop: trades.plannedStop,
          plannedTarget: trades.plannedTarget,
          plannedPositionSize: trades.plannedPositionSize,
          plannedRiskMinor: trades.plannedRiskMinor,
          plannedRewardMinor: trades.plannedRewardMinor,
          actualResultMode: trades.actualResultMode,
          actualEntry: trades.actualEntry,
          actualInitialStop: trades.actualInitialStop,
          actualExit: trades.actualExit,
          actualPositionSize: trades.actualPositionSize,
          actualInitialRiskMinor: trades.actualInitialRiskMinor,
          grossPnlMinor: trades.grossPnlMinor,
          commissionMinor: trades.commissionMinor,
          feesMinor: trades.feesMinor,
          swapMinor: trades.swapMinor,
          netPnlMinor: trades.netPnlMinor,
          enteredAt: trades.enteredAt,
          exitedAt: trades.exitedAt,
          systemStatus: trades.systemStatus,
          systemResolutionKind: trades.systemResolutionKind,
          systemExitPrice: trades.systemExitPrice,
          systemGrossRInput: trades.systemGrossRInput,
          systemExitedAt: trades.systemExitedAt,
          systemExitReason: trades.systemExitReason,
          systemCostR: trades.systemCostR,
          systemResolvedAt: trades.systemResolvedAt,
          plannedR: trades.plannedR,
          actualR: trades.actualR,
          systemR: trades.systemR,
          traderOutcome: trades.traderOutcome,
          systemOutcome: trades.systemOutcome,
          calcVersion: trades.calcVersion,
          status: trades.status,
          followedPlan: trades.followedPlan,
          deletedAt: trades.deletedAt,
          createdAt: trades.createdAt,
          updatedAt: trades.updatedAt,
        })
        .from(trades)
        .where(eq(trades.workspaceId, workspaceId))
        .orderBy(asc(trades.createdAt), asc(trades.id));

      const checkRows = await tx
        .select({
          id: tradeRuleChecks.id,
          workspaceId: tradeRuleChecks.workspaceId,
          tradeId: tradeRuleChecks.tradeId,
          strategyRuleId: tradeRuleChecks.strategyRuleId,
          strategyVersionId: tradeRuleChecks.strategyVersionId,
          ruleKey: tradeRuleChecks.ruleKey,
          checkStatus: tradeRuleChecks.checkStatus,
          title: tradeRuleChecks.title,
          category: tradeRuleChecks.category,
          isRequired: tradeRuleChecks.isRequired,
          isPreTradeCheck: tradeRuleChecks.isPreTradeCheck,
          sortOrder: tradeRuleChecks.sortOrder,
          createdAt: tradeRuleChecks.createdAt,
          updatedAt: tradeRuleChecks.updatedAt,
        })
        .from(tradeRuleChecks)
        .where(eq(tradeRuleChecks.workspaceId, workspaceId))
        .orderBy(
          asc(tradeRuleChecks.tradeId),
          asc(tradeRuleChecks.sortOrder),
          asc(tradeRuleChecks.ruleKey),
          asc(tradeRuleChecks.id),
        );

      const exitRows = await tx
        .select({
          id: tradeExits.id,
          workspaceId: tradeExits.workspaceId,
          tradeId: tradeExits.tradeId,
          sequence: tradeExits.sequence,
          closedBps: tradeExits.closedBps,
          exitPrice: tradeExits.exitPrice,
          realizedPnlMinor: tradeExits.realizedPnlMinor,
          exitReason: tradeExits.exitReason,
          exitedAt: tradeExits.exitedAt,
          createdAt: tradeExits.createdAt,
          updatedAt: tradeExits.updatedAt,
        })
        .from(tradeExits)
        .where(eq(tradeExits.workspaceId, workspaceId))
        .orderBy(asc(tradeExits.tradeId), asc(tradeExits.sequence), asc(tradeExits.id));

      const mistakeRows = await tx
        .select({
          tradeId: tradeMistakes.tradeId,
          mistakeTypeId: tradeMistakes.mistakeTypeId,
          workspaceId: tradeMistakes.workspaceId,
          note: tradeMistakes.note,
          severityAtTime: tradeMistakes.severityAtTime,
          createdAt: tradeMistakes.createdAt,
          updatedAt: tradeMistakes.updatedAt,
        })
        .from(tradeMistakes)
        .where(eq(tradeMistakes.workspaceId, workspaceId))
        .orderBy(asc(tradeMistakes.tradeId), asc(tradeMistakes.mistakeTypeId));

      const setupConditionCheckRows = await tx
        .select({
          id: tradeSetupConditionChecks.id,
          workspaceId: tradeSetupConditionChecks.workspaceId,
          tradeId: tradeSetupConditionChecks.tradeId,
          setupConditionId: tradeSetupConditionChecks.setupConditionId,
          setupVersionId: tradeSetupConditionChecks.setupVersionId,
          conditionKey: tradeSetupConditionChecks.conditionKey,
          label: tradeSetupConditionChecks.label,
          sortOrder: tradeSetupConditionChecks.sortOrder,
          checkStatus: tradeSetupConditionChecks.checkStatus,
          createdAt: tradeSetupConditionChecks.createdAt,
          updatedAt: tradeSetupConditionChecks.updatedAt,
        })
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.workspaceId, workspaceId))
        .orderBy(
          asc(tradeSetupConditionChecks.tradeId),
          asc(tradeSetupConditionChecks.sortOrder),
          asc(tradeSetupConditionChecks.conditionKey),
        );

      const emotionRows = await tx
        .select({
          tradeId: tradeEmotions.tradeId,
          emotionTypeId: tradeEmotions.emotionTypeId,
          workspaceId: tradeEmotions.workspaceId,
          createdAt: tradeEmotions.createdAt,
        })
        .from(tradeEmotions)
        .where(eq(tradeEmotions.workspaceId, workspaceId))
        .orderBy(asc(tradeEmotions.tradeId), asc(tradeEmotions.emotionTypeId));

      const emotionTypeRows = await tx
        .select({
          id: emotionTypes.id,
          workspaceId: emotionTypes.workspaceId,
          key: emotionTypes.key,
          label: emotionTypes.label,
          isSystem: emotionTypes.isSystem,
          isArchived: emotionTypes.isArchived,
          sortOrder: emotionTypes.sortOrder,
          createdAt: emotionTypes.createdAt,
          updatedAt: emotionTypes.updatedAt,
        })
        .from(emotionTypes)
        .where(or(eq(emotionTypes.workspaceId, workspaceId), eq(emotionTypes.isSystem, true)))
        .orderBy(asc(emotionTypes.isSystem), asc(emotionTypes.sortOrder), asc(emotionTypes.id));

      const referencedMistakeTypeIds = [...new Set(mistakeRows.map((row) => row.mistakeTypeId))];
      const mistakeTypeRows = await tx
        .select({
          id: mistakeTypes.id,
          workspaceId: mistakeTypes.workspaceId,
          key: mistakeTypes.key,
          label: mistakeTypes.label,
          severity: mistakeTypes.severity,
          isSystem: mistakeTypes.isSystem,
          isArchived: mistakeTypes.isArchived,
          sortOrder: mistakeTypes.sortOrder,
          createdAt: mistakeTypes.createdAt,
          updatedAt: mistakeTypes.updatedAt,
        })
        .from(mistakeTypes)
        .where(
          referencedMistakeTypeIds.length === 0
            ? eq(mistakeTypes.workspaceId, workspaceId)
            : or(
                eq(mistakeTypes.workspaceId, workspaceId),
                inArray(mistakeTypes.id, referencedMistakeTypeIds),
              ),
        )
        .orderBy(asc(mistakeTypes.isSystem), asc(mistakeTypes.sortOrder), asc(mistakeTypes.id));

      const billingRows = await tx
        .select({
          id: billingTransactions.id,
          workspaceId: billingTransactions.workspaceId,
          planKey: billingTransactions.planKey,
          billingCurrency: billingTransactions.billingCurrency,
          billingInterval: billingTransactions.billingInterval,
          subtotalMinor: billingTransactions.subtotalMinor,
          vatEnabled: billingTransactions.vatEnabled,
          appliedVatRateBasisPoints: billingTransactions.appliedVatRateBasisPoints,
          vatAmountMinor: billingTransactions.vatAmountMinor,
          totalMinor: billingTransactions.totalMinor,
          status: billingTransactions.status,
          createdAt: billingTransactions.createdAt,
          updatedAt: billingTransactions.updatedAt,
          completedAt: billingTransactions.completedAt,
          failedAt: billingTransactions.failedAt,
        })
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId))
        .orderBy(asc(billingTransactions.createdAt), asc(billingTransactions.id));

      return {
        workspace,
        trading_accounts: accountRows,
        strategies: strategyRows,
        strategy_versions: strategyVersionRows,
        setups: setupRows,
        strategy_setup_versions: setupVersionRows,
        strategy_rules: ruleRows,
        setup_conditions: setupConditionRows,
        mistake_types: mistakeTypeRows,
        emotion_types: emotionTypeRows,
        // The internal private-storage key never leaves this function — only
        // a truthful presence flag is exported (see `workspace-export.ts`'s
        // registry column comment).
        trades: tradeRows.map(({ chartAttachmentStorageKey, ...rest }) => ({
          ...rest,
          hasChartAttachment: chartAttachmentStorageKey !== null,
        })),
        trade_exits: exitRows,
        trade_rule_checks: checkRows,
        trade_setup_condition_checks: setupConditionCheckRows,
        trade_mistakes: mistakeRows,
        trade_emotions: emotionRows,
        billing_transactions: billingRows,
      };
    },
    {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    },
  );
}
