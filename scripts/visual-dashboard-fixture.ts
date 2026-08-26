import { createHash } from 'node:crypto';

import Decimal from 'decimal.js';

import { CALC_VERSION } from '@/config/trade-calc';
import {
  classifyOutcome,
  composeTraderCloseV2,
  moneyPlannedR,
  resolveSystemR,
} from '@/lib/calc/trade';
import type { OutcomeValue } from '@/lib/trades/constants';

export const VISUAL_EMPTY_ACCOUNT_NAME = 'Visual — Empty';
export const VISUAL_POPULATED_ACCOUNT_NAME = 'Visual — Populated';
export const VISUAL_FIXTURE_AS_OF = new Date('2026-08-24T16:00:00.000Z');
export const VISUAL_FIXTURE_REFERENCE_INSTANT = new Date('2026-08-26T12:00:00.000Z');
export const VISUAL_FIXTURE_EMAIL = 'beamkattiyot12345@gmail.com';
export const VISUAL_FIXTURE_TRADE_COUNT = 70;
export const VISUAL_FIXTURE_PARTIAL_TRADE_INDICES = new Set([
  5, 11, 18, 24, 31, 39, 46, 52, 58, 63,
]);

export interface VisualSeedTargetIdentity {
  readonly protocol: string;
  readonly host: string;
  readonly port: string | null;
  readonly database: string;
  readonly environment: 'development' | 'test' | 'preview' | 'local';
}

export function assertVisualSeedSafety(
  env: Readonly<Record<string, string | undefined>>,
): VisualSeedTargetIdentity {
  if (env.ALLOW_VISUAL_FIXTURE_SEED !== 'true') {
    throw new Error(
      'REFUSED: set ALLOW_VISUAL_FIXTURE_SEED=true for an intentional visual-fixture run.',
    );
  }
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    throw new Error('REFUSED: production environment classification detected.');
  }
  if (!env.DATABASE_URL) throw new Error('REFUSED: DATABASE_URL is not configured.');

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('REFUSED: DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('REFUSED: DATABASE_URL is not PostgreSQL.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || /(^|[_-])(prod|production)([_-]|$)/i.test(database)) {
    throw new Error('REFUSED: database name is blank or production-like.');
  }
  const marker = database.match(/(^|[_-])(development|dev|test|e2e|preview|local)([_-]|$)/i)?.[2];
  if (!marker) {
    throw new Error('REFUSED: database name does not carry an unmistakable non-production marker.');
  }
  const environment =
    marker.toLowerCase() === 'dev' || marker.toLowerCase() === 'development'
      ? 'development'
      : marker.toLowerCase() === 'preview'
        ? 'preview'
        : marker.toLowerCase() === 'local'
          ? 'local'
          : 'test';
  return {
    protocol: url.protocol,
    host: url.hostname,
    port: url.port || null,
    database,
    environment,
  };
}

/**
 * WHICH POPULATION A FIXTURE TRADE WAS BUILT TO EXERCISE — an authoring
 * label, NOT the canonical population it lands in.
 *
 * The distinction matters because reading these labels as canonical
 * population sizes gives the wrong totals. The label says "this row exists
 * to be the ONLY-A case" or "the ONLY-B case"; a canonical population is
 * every Trade that satisfies the D1 eligibility rule, which includes all 64
 * paired ones.
 *
 *   label 'C'            64 rows   both sides complete -> Paired C
 *   label 'A'             2 rows   Actual complete, System never resolved
 *   label 'B'             2 rows   System resolved on a `planned` Trade
 *   label 'operational'   2 rows   System resolved on a still-`open` Trade
 *
 * Read as EXCLUSIVE membership, which is what the seed report's
 * "A 2 / B 4 / C 64" line means:
 *
 *   A-only   =  2   (label 'A')
 *   B-only   =  4   (label 'B' + label 'operational' — both are System-
 *                    resolved without a complete Actual side)
 *   Paired C = 64   (label 'C')
 *
 * Read as CANONICAL D1 populations, which is what the Dashboard reports:
 *
 *   Trader Population A total = 64 paired +  2 A-only = 66
 *   System Population B total = 64 paired +  4 B-only = 68
 *   Population C (intersection)                       = 64
 *
 * So an independent Trader total and an independent System total are drawn
 * from 66 and 68 Trades respectively, while every paired/comparison figure is
 * drawn from exactly the same 64. Independent totals are therefore NOT
 * expected to equal paired totals, and making them match would break the
 * fixture's whole purpose — see `docs/reviews/dashboard-d5a-execution-comparison.md`.
 *
 * The two `'operational'` rows also carry the Dashboard's open-Trade
 * attention counts, which is why they are labelled for that job rather than
 * for their Population B membership.
 */
export type VisualPopulation = 'A' | 'B' | 'C' | 'operational';

export interface VisualFramework {
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly setups: readonly {
    readonly id: string;
    readonly versionId: string;
    readonly name: string;
  }[];
}

export interface VisualExitBlueprint {
  readonly id: string;
  readonly mutationKey: string;
  readonly sequence: number;
  readonly closedBps: number;
  readonly realizedPnlMinor: bigint;
  readonly exitReason: string;
  readonly exitedAt: Date;
}

export interface VisualTradeBlueprint {
  readonly fixtureIndex: number;
  readonly id: string;
  readonly mutationKey: string;
  readonly population: VisualPopulation;
  readonly tradingAccountId: string;
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly setupId: string | null;
  readonly setupVersionId: string | null;
  readonly strategyAssignedAt: Date | null;
  readonly setupAssignedAt: Date | null;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly timeframe: string;
  readonly session: string;
  readonly confirmationNotes: string;
  readonly confidence: 25 | 50 | 75 | 100;
  readonly notes: string;
  readonly reviewNotes: string | null;
  readonly emotionsRecordedAt: Date | null;
  readonly plannedRiskMinor: bigint;
  readonly plannedRewardMinor: bigint;
  readonly plannedR: string;
  readonly actualResultMode: 'money' | null;
  readonly actualInitialRiskMinor: bigint | null;
  readonly grossPnlMinor: bigint | null;
  readonly commissionMinor: bigint;
  readonly feesMinor: bigint;
  readonly swapMinor: bigint;
  readonly netPnlMinor: bigint | null;
  readonly enteredAt: Date | null;
  readonly exitedAt: Date | null;
  readonly systemStatus: 'pending' | 'resolved';
  readonly systemResolutionKind: 'money_custom' | null;
  readonly systemGrossRInput: string | null;
  readonly systemExitedAt: Date | null;
  readonly systemExitReason: 'manual_system_valid_exit' | null;
  readonly systemCostR: string;
  readonly systemResolvedAt: Date | null;
  readonly actualR: string | null;
  readonly systemR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly calcVersion: number;
  readonly status: 'planned' | 'open' | 'closed';
  readonly followedPlan: boolean | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly exits: readonly VisualExitBlueprint[];
  readonly emotionKeys: readonly string[];
  readonly mistakeKeys: readonly string[];
}

type VisualIdentityPart = string | number;

function deterministicUuid(...namespace: readonly VisualIdentityPart[]): string {
  const hex = createHash('sha256')
    .update(JSON.stringify(['tradechemist', 'visual-dashboard', 'v2', ...namespace]))
    .digest('hex')
    .slice(0, 32);
  const chars = [...hex];
  chars[12] = '7';
  chars[16] = '8';
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function legacyDeterministicUuid(label: string): string {
  const hex = createHash('sha256')
    .update(`tradechemist-visual-v1:${label}`)
    .digest('hex')
    .slice(0, 32);
  const chars = [...hex];
  chars[12] = '7';
  chars[16] = '8';
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export interface VisualOwnerNamespace {
  readonly ownerIdentity: string;
  readonly workspaceId: string;
}

export function visualAccountIdentity(namespace: VisualOwnerNamespace): {
  readonly emptyId: string;
  readonly populatedId: string;
  readonly emptyMutationKey: string;
  readonly populatedMutationKey: string;
} {
  const ownerIdentity = namespace.ownerIdentity.trim().toLowerCase();
  const workspaceId = namespace.workspaceId.trim().toLowerCase();
  if (ownerIdentity.length === 0 || workspaceId.length === 0) {
    throw new Error('Visual fixture owner and workspace identities must be non-empty.');
  }
  return {
    emptyId: deterministicUuid(
      'owner',
      ownerIdentity,
      'workspace',
      workspaceId,
      'account',
      'empty',
    ),
    populatedId: deterministicUuid(
      'owner',
      ownerIdentity,
      'workspace',
      workspaceId,
      'account',
      'populated',
    ),
    emptyMutationKey: deterministicUuid(
      'owner',
      ownerIdentity,
      'workspace',
      workspaceId,
      'account',
      'empty',
      'mutation',
    ),
    populatedMutationKey: deterministicUuid(
      'owner',
      ownerIdentity,
      'workspace',
      workspaceId,
      'account',
      'populated',
      'mutation',
    ),
  };
}

/** Reconciliation-only identities emitted before workspace scoping was added. */
export function legacyVisualAccountIdentity(
  ownerIdentity: string,
): ReturnType<typeof visualAccountIdentity> {
  const normalized = ownerIdentity.trim().toLowerCase();
  return {
    emptyId: legacyDeterministicUuid(`${normalized}:account:empty`),
    populatedId: legacyDeterministicUuid(`${normalized}:account:populated`),
    emptyMutationKey: legacyDeterministicUuid(`${normalized}:account:empty:mutation`),
    populatedMutationKey: legacyDeterministicUuid(`${normalized}:account:populated:mutation`),
  };
}

function visualTradeIdentity(
  accountId: string,
  fixtureIndex: number,
): {
  readonly id: string;
  readonly mutationKey: string;
} {
  return {
    id: deterministicUuid('account', accountId, 'trade', fixtureIndex),
    mutationKey: deterministicUuid('account', accountId, 'trade', fixtureIndex, 'mutation'),
  };
}

export function visualTradeChildIdentity(
  tradeId: string,
  childType: 'exit' | 'rule-check',
  stableIdentity: string | number,
): string {
  return deterministicUuid('trade', tradeId, 'child', childType, stableIdentity);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deterministicShuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target] as T, result[index] as T];
  }
  return result;
}

function repeat(value: string, count: number): string[] {
  return Array.from({ length: count }, () => value);
}

const ACTUAL_COMPARABLE = [
  ...deterministicShuffle(
    [
      ...repeat('2.2000', 16),
      ...repeat('2.4000', 7),
      ...repeat('-1.1000', 18),
      ...repeat('-1.1500', 13),
      ...repeat('0.0000', 4),
    ],
    12,
  ),
  '2.4000',
  '-1.1000',
  '0.0000',
  '2.2000',
  '-1.1500',
  '2.4000',
] as const;

const SYSTEM_COMPARABLE = [
  ...deterministicShuffle(
    [
      ...repeat('2.3000', 17),
      ...repeat('2.5000', 8),
      ...repeat('-0.9000', 18),
      ...repeat('-0.9500', 13),
      ...repeat('0.0000', 2),
    ],
    2,
  ),
  '2.5000',
  '-0.9000',
  '0.0000',
  '-0.9500',
  '2.3000',
  '2.3000',
] as const;

const ACTUAL_ONLY = ['2.2000', '-1.1000'] as const;
const SYSTEM_ONLY = ['2.3000', '-0.9000', '-0.9500', '0.0000'] as const;

function dateForIndex(index: number, hour: number, minute = 0): Date {
  const daysAgo = 89 - Math.floor((index * 89) / (VISUAL_FIXTURE_TRADE_COUNT - 1));
  const result = new Date(VISUAL_FIXTURE_AS_OF);
  result.setUTCDate(result.getUTCDate() - daysAgo);
  result.setUTCHours(hour, minute, 0, 0);
  return result;
}

function minorForR(r: string): bigint {
  return BigInt(new Decimal(r).times(10_000).toFixed(0));
}

function buildExitBlueprints(
  tradeId: string,
  index: number,
  actualR: string,
  finalAt: Date,
): VisualExitBlueprint[] {
  const totalMinor = minorForR(actualR);
  const isPartial = VISUAL_FIXTURE_PARTIAL_TRADE_INDICES.has(index);
  const parts: { bps: number; pnl: bigint; reason: string }[] = [];

  if (!isPartial) {
    parts.push({ bps: 10_000, pnl: totalMinor, reason: 'Final close' });
  } else if (index % 4 === 0) {
    const first = (totalMinor * 45n) / 100n;
    parts.push(
      { bps: 4_000, pnl: first, reason: 'Scaled profit' },
      { bps: 6_000, pnl: totalMinor - first, reason: 'Final close' },
    );
  } else if (index % 4 === 1) {
    parts.push(
      { bps: 3_500, pnl: 3_000n, reason: 'Partial profit' },
      { bps: 6_500, pnl: totalMinor - 3_000n, reason: 'Final stop' },
    );
  } else if (index % 4 === 2) {
    parts.push(
      { bps: 3_000, pnl: -2_500n, reason: 'Risk reduction' },
      { bps: 7_000, pnl: totalMinor + 2_500n, reason: 'Final winner' },
    );
  } else {
    const first = totalMinor / 4n;
    const second = totalMinor / 4n;
    parts.push(
      { bps: 2_500, pnl: first, reason: 'Scale out 1' },
      { bps: 2_500, pnl: second, reason: 'Scale out 2' },
      { bps: 5_000, pnl: totalMinor - first - second, reason: 'Final close' },
    );
  }

  return parts.map((part, partIndex) => ({
    id: visualTradeChildIdentity(tradeId, 'exit', partIndex + 1),
    mutationKey: deterministicUuid('trade', tradeId, 'child', 'exit', partIndex + 1, 'mutation'),
    sequence: partIndex + 1,
    closedBps: part.bps,
    realizedPnlMinor: part.pnl,
    exitReason: part.reason,
    exitedAt: new Date(finalAt.getTime() - (parts.length - 1 - partIndex) * 45 * 60_000),
  }));
}

function requireCalc<T>(
  label: string,
  result: { ok: true; value: T } | { ok: false; reason: string },
): T {
  if (!result.ok) throw new Error(`${label} failed: ${result.reason}`);
  return result.value;
}

const PLANNED_R = requireCalc('planned R', moneyPlannedR(10_000n, 22_000n));

function systemSnapshot(targetR: string): {
  readonly grossR: string;
  readonly systemR: string;
  readonly outcome: OutcomeValue;
} {
  const costR = '0.0500';
  const grossR = new Decimal(targetR).plus(costR).toFixed(4);
  const systemR = requireCalc(
    'system R',
    resolveSystemR({
      systemStatus: 'resolved',
      systemResolutionKind: 'money_custom',
      direction: 'long',
      plannedEntry: null,
      plannedStop: null,
      plannedRiskMinor: 10_000n,
      plannedRewardMinor: 22_000n,
      systemGrossRInput: grossR,
      systemCostR: costR,
    }),
  );
  const outcome = requireCalc('system outcome', classifyOutcome(systemR));
  return { grossR, systemR, outcome };
}

function contextForIndex(index: number): {
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly timeframe: string;
  readonly session: string;
} {
  return {
    symbol: ['XAUUSD', 'BTCUSD', 'EURUSD'][index % 3] as string,
    direction: index % 2 === 0 ? 'long' : 'short',
    timeframe: ['15m', '1H', '4H'][index % 3] as string,
    session: ['Asia', 'London', 'New York'][index % 3] as string,
  };
}

function behavioralContext(index: number): {
  readonly emotionKeys: readonly string[];
  readonly mistakeKeys: readonly string[];
} {
  const emotionKeys =
    index % 17 === 0
      ? ['revenge']
      : index % 13 === 0
        ? ['fomo']
        : index % 7 === 0
          ? ['fearful']
          : index % 3 === 0
            ? ['calm', 'focused']
            : index % 4 === 0
              ? []
              : ['focused'];
  const mistakeKeys =
    index === 14 || index === 51
      ? ['chased_entry']
      : index === 36
        ? ['revenge_trade']
        : [7, 23, 40, 58].includes(index)
          ? ['early_exit']
          : [];
  return { emotionKeys, mistakeKeys };
}

export function buildVisualTradeBlueprints(params: {
  readonly populatedAccountId: string;
  readonly framework: VisualFramework;
}): readonly VisualTradeBlueprint[] {
  if (params.framework.setups.length < 3) {
    throw new Error('The visual fixture requires at least three usable Setup snapshots.');
  }

  const blueprints: VisualTradeBlueprint[] = [];
  for (let index = 0; index < VISUAL_FIXTURE_TRADE_COUNT; index += 1) {
    const tradeIdentity = visualTradeIdentity(params.populatedAccountId, index);
    const isComparable = index < 64;
    const isActualOnly = index >= 64 && index < 66;
    const isPlannedSystemOnly = index >= 66 && index < 68;
    const isOpenSystemOnly = index >= 68;
    const population: VisualPopulation = isComparable
      ? 'C'
      : isActualOnly
        ? 'A'
        : isPlannedSystemOnly
          ? 'B'
          : 'operational';
    const actualTargetR = isComparable
      ? (ACTUAL_COMPARABLE[index] as string)
      : isActualOnly
        ? (ACTUAL_ONLY[index - 64] as string)
        : null;
    const systemTargetR = isComparable
      ? (SYSTEM_COMPARABLE[index] as string)
      : isActualOnly
        ? null
        : (SYSTEM_ONLY[index - 66] as string);
    const isClassified = !isPlannedSystemOnly;
    const setup = params.framework.setups[index % 3] as VisualFramework['setups'][number];
    const context = contextForIndex(index);
    const enteredAt = isPlannedSystemOnly ? null : dateForIndex(index, 8, (index % 4) * 10);
    const exitedAt = actualTargetR === null ? null : dateForIndex(index, 12, (index % 4) * 10);
    const createdAt = dateForIndex(index, 6, index % 4);
    const exits =
      actualTargetR === null
        ? []
        : buildExitBlueprints(tradeIdentity.id, index, actualTargetR, exitedAt as Date);
    const actualSnapshot =
      actualTargetR === null
        ? null
        : requireCalc(
            `actual trade ${index}`,
            composeTraderCloseV2({
              actualResultMode: 'money',
              direction: context.direction,
              actualInitialRiskMinor: 10_000n,
              exits,
            }),
          );
    const netPnlMinor =
      actualTargetR === null
        ? null
        : exits.reduce((total, exit) => total + exit.realizedPnlMinor, 0n);
    const commissionMinor = actualTargetR === null ? 0n : 75n;
    const feesMinor = actualTargetR === null ? 0n : 25n;
    const swapMinor = actualTargetR === null || index % 3 !== 0 ? 0n : 25n;
    const system = systemTargetR === null ? null : systemSnapshot(systemTargetR);
    const systemExitedAt = system === null ? null : dateForIndex(index, 13, (index % 4) * 10);
    const behavior = behavioralContext(index);
    const reviewNotes =
      actualTargetR === null
        ? null
        : index === 65
          ? null
          : index % 11 === 0
            ? 'Exited early after hesitation; review confirms the original system target remained valid.'
            : index % 9 === 0
              ? 'FOMO was present, but risk stayed defined and the post-trade review is complete.'
              : 'Reviewed against the plan; execution notes and outcome are complete.';
    const updatedAt = new Date(
      Math.max(
        createdAt.getTime(),
        enteredAt?.getTime() ?? 0,
        exitedAt?.getTime() ?? 0,
        systemExitedAt?.getTime() ?? 0,
      ) +
        60 * 60_000,
    );

    blueprints.push({
      fixtureIndex: index,
      id: tradeIdentity.id,
      mutationKey: tradeIdentity.mutationKey,
      population,
      tradingAccountId: params.populatedAccountId,
      strategyId: isClassified ? params.framework.strategyId : null,
      strategyVersionId: isClassified ? params.framework.strategyVersionId : null,
      setupId: isClassified ? setup.id : null,
      setupVersionId: isClassified ? setup.versionId : null,
      strategyAssignedAt: isClassified ? createdAt : null,
      setupAssignedAt: isClassified ? createdAt : null,
      ...context,
      confirmationNotes: `Deterministic visual fixture #${String(index + 1).padStart(2, '0')}: ${context.session} ${context.timeframe} confirmation.`,
      confidence: [50, 75, 100, 75, 25][index % 5] as 25 | 50 | 75 | 100,
      notes:
        index % 8 === 0
          ? 'Execution deliberately includes a small visual-fixture imperfection.'
          : 'Canonical visual fixture trade.',
      reviewNotes,
      emotionsRecordedAt: actualTargetR === null ? null : updatedAt,
      plannedRiskMinor: 10_000n,
      plannedRewardMinor: 22_000n,
      plannedR: PLANNED_R,
      actualResultMode: isPlannedSystemOnly ? null : 'money',
      actualInitialRiskMinor: isPlannedSystemOnly ? null : 10_000n,
      grossPnlMinor:
        netPnlMinor === null ? null : netPnlMinor + commissionMinor + feesMinor + swapMinor,
      commissionMinor,
      feesMinor,
      swapMinor,
      netPnlMinor,
      enteredAt,
      exitedAt,
      systemStatus: system === null ? 'pending' : 'resolved',
      systemResolutionKind: system === null ? null : 'money_custom',
      systemGrossRInput: system?.grossR ?? null,
      systemExitedAt,
      systemExitReason: system === null ? null : 'manual_system_valid_exit',
      systemCostR: system === null ? '0.0000' : '0.0500',
      systemResolvedAt:
        systemExitedAt === null ? null : new Date(systemExitedAt.getTime() + 30 * 60_000),
      actualR: actualSnapshot?.actualR ?? null,
      systemR: system?.systemR ?? null,
      traderOutcome: actualSnapshot?.traderOutcome ?? null,
      systemOutcome: system?.outcome ?? null,
      calcVersion: CALC_VERSION,
      status: isPlannedSystemOnly ? 'planned' : isOpenSystemOnly ? 'open' : 'closed',
      followedPlan: actualTargetR === null ? null : index % 8 !== 0,
      createdAt,
      updatedAt,
      exits,
      ...behavior,
    });
  }
  return blueprints;
}

export const __visualFixtureTestUtils = {
  deterministicUuid,
  actualComparable: ACTUAL_COMPARABLE,
  systemComparable: SYSTEM_COMPARABLE,
};
