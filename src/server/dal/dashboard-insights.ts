import 'server-only';

import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';

import type { AnalyticsFilterInput } from '@/lib/analytics/filters';
import type {
  InsightActualTradeInput,
  InsightEmotionInput,
  InsightMistakeInput,
  InsightRuleCheckInput,
  InsightScope,
  InsightSystemTradeInput,
} from '@/lib/dashboard/insight-pillars';
import type { OutcomeValue, RuleCheckStatus } from '@/lib/trades/constants';
import { getDb } from '@/server/db/client';
import {
  emotionTypes,
  mistakeTypes,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
} from '@/server/db/schema';

import {
  dateConditions,
  frameworkConditions,
  resolveAnalyticsQueryContext,
  type AnalyticsFilterErrorCode,
  type AnalyticsReadOptions,
  type AnalyticsReadResult,
} from './analytics';

export const DASHBOARD_INSIGHT_MAJOR_PROJECTIONS = [
  'actual_trades',
  'system_trades',
  'emotions',
  'rule_checks',
  'mistakes',
] as const;
export const DASHBOARD_INSIGHT_MAJOR_PROJECTION_COUNT = DASHBOARD_INSIGHT_MAJOR_PROJECTIONS.length;

export interface DashboardInsightRawData {
  readonly scope: InsightScope;
  readonly actualTrades: readonly InsightActualTradeInput[];
  readonly systemTrades: readonly InsightSystemTradeInput[];
  readonly emotions: readonly InsightEmotionInput[];
  readonly ruleChecks: readonly InsightRuleCheckInput[];
  readonly mistakes: readonly InsightMistakeInput[];
}

export type DashboardInsightReadResult = AnalyticsReadResult<DashboardInsightRawData>;
export type DashboardInsightReadErrorCode = AnalyticsFilterErrorCode;

/**
 * One D8 server boundary with five independent, bounded bulk projections.
 * Actual and System retain their frozen independent date axes. The three
 * many-to-many dimensions remain separate rowsets so joins cannot multiply
 * Trade samples. All reads run in parallel; none runs per category or Trade.
 */
export async function getDashboardInsightRawData(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<DashboardInsightReadResult> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const db = getDb();
  const actualConditions = [
    ...frameworkConditions(context.data),
    isNull(trades.deletedAt),
    eq(trades.status, 'closed'),
    isNotNull(trades.actualR),
    isNotNull(trades.traderOutcome),
    isNotNull(trades.exitedAt),
    ...dateConditions(trades.exitedAt, context.data.filters.dateBounds),
  ];
  const systemConditions = [
    ...frameworkConditions(context.data),
    isNull(trades.deletedAt),
    eq(trades.systemStatus, 'resolved'),
    isNotNull(trades.systemR),
    isNotNull(trades.systemOutcome),
    isNotNull(trades.systemExitedAt),
    ...dateConditions(trades.systemExitedAt, context.data.filters.dateBounds),
  ];

  const [actualRows, systemRows, emotionRows, ruleRows, mistakeRows] = await Promise.all([
    db
      .select({
        tradeId: trades.id,
        actualR: trades.actualR,
        traderOutcome: trades.traderOutcome,
        actualExitedAt: trades.exitedAt,
        systemR: trades.systemR,
        systemOutcome: trades.systemOutcome,
        systemExitedAt: trades.systemExitedAt,
        strategyId: trades.strategyId,
        strategyLabel: strategyVersions.name,
        setupId: trades.setupId,
        setupLabel: strategySetupVersions.name,
        confidence: trades.confidence,
      })
      .from(trades)
      .leftJoin(strategyVersions, eq(strategyVersions.id, trades.strategyVersionId))
      .leftJoin(strategySetupVersions, eq(strategySetupVersions.id, trades.setupVersionId))
      .where(and(...actualConditions))
      .orderBy(asc(trades.exitedAt), asc(trades.id)),
    db
      .select({
        tradeId: trades.id,
        systemR: trades.systemR,
        systemOutcome: trades.systemOutcome,
        systemExitedAt: trades.systemExitedAt,
        strategyId: trades.strategyId,
        strategyLabel: strategyVersions.name,
        setupId: trades.setupId,
        setupLabel: strategySetupVersions.name,
      })
      .from(trades)
      .leftJoin(strategyVersions, eq(strategyVersions.id, trades.strategyVersionId))
      .leftJoin(strategySetupVersions, eq(strategySetupVersions.id, trades.setupVersionId))
      .where(and(...systemConditions))
      .orderBy(asc(trades.systemExitedAt), asc(trades.id)),
    db
      .select({
        tradeId: tradeEmotions.tradeId,
        key: emotionTypes.key,
        label: emotionTypes.label,
        isSystem: emotionTypes.isSystem,
      })
      .from(tradeEmotions)
      .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
      .innerJoin(trades, eq(trades.id, tradeEmotions.tradeId))
      .where(and(...actualConditions))
      .orderBy(asc(trades.exitedAt), asc(trades.id), asc(emotionTypes.sortOrder)),
    db
      .select({
        tradeId: tradeRuleChecks.tradeId,
        ruleKey: tradeRuleChecks.ruleKey,
        title: tradeRuleChecks.title,
        checkStatus: tradeRuleChecks.checkStatus,
        isRequired: tradeRuleChecks.isRequired,
        occurredAt: trades.exitedAt,
      })
      .from(tradeRuleChecks)
      .innerJoin(trades, eq(trades.id, tradeRuleChecks.tradeId))
      .where(and(...actualConditions))
      .orderBy(asc(trades.exitedAt), asc(trades.id), asc(tradeRuleChecks.sortOrder)),
    db
      .select({
        tradeId: tradeMistakes.tradeId,
        mistakeTypeId: tradeMistakes.mistakeTypeId,
        key: mistakeTypes.key,
        label: mistakeTypes.label,
        isSystem: mistakeTypes.isSystem,
      })
      .from(tradeMistakes)
      .innerJoin(mistakeTypes, eq(mistakeTypes.id, tradeMistakes.mistakeTypeId))
      .innerJoin(trades, eq(trades.id, tradeMistakes.tradeId))
      .where(and(...actualConditions))
      .orderBy(asc(trades.exitedAt), asc(trades.id), asc(mistakeTypes.sortOrder)),
  ]);

  return {
    ok: true,
    data: {
      scope: {
        datePreset: context.data.filters.datePreset,
        dateBounds: context.data.filters.dateBounds,
        accountScope: context.data.filters.accountScope,
        strategyId: context.data.filters.strategyId,
        setupId: context.data.filters.setupId,
        strategyVersionId: context.data.filters.strategyVersionId,
      },
      actualTrades: actualRows.map((row) => ({
        ...row,
        actualR: row.actualR as string,
        traderOutcome: row.traderOutcome as OutcomeValue,
        actualExitedAt: (row.actualExitedAt as Date).toISOString(),
        systemOutcome: row.systemOutcome as OutcomeValue | null,
        systemExitedAt: row.systemExitedAt?.toISOString() ?? null,
      })),
      systemTrades: systemRows.map((row) => ({
        ...row,
        systemR: row.systemR as string,
        systemOutcome: row.systemOutcome as OutcomeValue,
        systemExitedAt: (row.systemExitedAt as Date).toISOString(),
      })),
      emotions: emotionRows,
      ruleChecks: ruleRows.map((row) => ({
        ...row,
        checkStatus: row.checkStatus as RuleCheckStatus,
        occurredAt: (row.occurredAt as Date).toISOString(),
      })),
      mistakes: mistakeRows,
    },
  };
}
