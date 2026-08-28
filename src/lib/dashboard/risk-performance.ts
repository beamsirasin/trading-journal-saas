import Decimal from 'decimal.js';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from '@/lib/analytics/filters';
import { netPnl } from '@/lib/calc/net-pnl';
import { isCurrencyCode, parseMoney, type CurrencyCode } from '@/lib/money';

export const RISK_PERFORMANCE_WIDGET_IDS = ['account.balance', 'risk.drawdown'] as const;

export interface ModeledBalanceTradeInput {
  readonly tradeId: string;
  /** The canonical Actual realization instant: `trades.exited_at`, never an Exit-leg/System/bookkeeping timestamp. */
  readonly actualExitedAt: Date | string;
  /** Authoritative Trade-level Actual result. Already net; costs must not be subtracted again. */
  readonly netPnlMinor: bigint | string | null;
  /** The Account currency that gives the stored minor units meaning. */
  readonly baseCurrency: string;
}

export interface ModeledBalanceAccountInput {
  readonly accountId: string;
  readonly source: 'active' | 'explicit';
  readonly baseCurrency: string;
  readonly startingBalance: string | null;
}

export interface RiskPerformanceScopeInput {
  readonly datePreset: AnalyticsDatePreset;
  readonly dateBounds: AnalyticsDateBounds;
  readonly account:
    { readonly kind: 'all' } | ({ readonly kind: 'account' } & ModeledBalanceAccountInput);
  /** Validated Dashboard analytical filters are recorded, but never applied to Account Balance. */
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

export interface RiskPerformanceScope {
  readonly datePreset: AnalyticsDatePreset;
  readonly dateBounds: AnalyticsDateBounds;
  readonly account:
    | { readonly kind: 'all' }
    | {
        readonly kind: 'account';
        readonly accountId: string;
        readonly source: 'active' | 'explicit';
      };
  readonly balanceUniverse: 'selected_account_lifetime_through_as_of';
  readonly analyticalFilters: {
    readonly strategyId: string | null;
    readonly setupId: string | null;
    readonly strategyVersionId: string | null;
    readonly effect: 'not_applied_to_account_balance';
  };
}

export type ModeledBalancePoint =
  | {
      readonly kind: 'opening';
      /** `null` for All because the schema has no trustworthy financial inception timestamp. */
      readonly occurredAt: string | null;
      readonly tradeIds: readonly [];
      readonly deltaMinor: '0';
      readonly balanceMinor: string;
    }
  | {
      readonly kind: 'trade_close';
      readonly occurredAt: string;
      /** More than one ID means exact-identical realization instants were grouped atomically. */
      readonly tradeIds: readonly string[];
      readonly deltaMinor: string;
      readonly balanceMinor: string;
    }
  | {
      readonly kind: 'as_of';
      readonly occurredAt: string;
      readonly tradeIds: readonly [];
      readonly deltaMinor: '0';
      readonly balanceMinor: string;
    };

export type DrawdownPercentage =
  | { readonly status: 'available'; readonly value: string }
  | { readonly status: 'unavailable'; readonly reason: 'non_positive_peak' };

export interface BalanceDrawdown {
  /** Positive magnitude. Zero means the balance is at its carried high-water mark. */
  readonly amountMinor: string;
  /** Percentage against the peak that precedes this exact drawdown/trough. */
  readonly percentage: DrawdownPercentage;
  readonly referencePeakMinor: string;
}

export interface AvailableRiskPerformanceData {
  readonly status: 'available';
  readonly scope: RiskPerformanceScope;
  readonly widgets: typeof RISK_PERFORMANCE_WIDGET_IDS;
  readonly currency: CurrencyCode;
  readonly basis: {
    readonly kind: 'declared_starting_balance';
    /** No financial effective timestamp exists in the current Account schema. */
    readonly effectiveAt: null;
    readonly limitations: readonly [
      'no_cash_ledger',
      'no_unrealized_pnl',
      'starting_balance_changes_are_retroactive',
    ];
  };
  readonly startingBalanceMinor: string;
  readonly openingBalanceMinor: string;
  readonly endingBalanceMinor: string;
  readonly periodNetPnlMinor: string;
  readonly peakBalanceMinor: string;
  readonly currentDrawdown: BalanceDrawdown;
  readonly maxDrawdown: BalanceDrawdown;
  /** Closed authoritative-money Trades whose realization is inside the visible range. */
  readonly closedTradeCount: number;
  readonly completeness: {
    readonly status: 'complete';
    readonly horizon: 'balance_basis_through_as_of';
    readonly checkedClosedTradeCount: number;
  };
  readonly series: readonly ModeledBalancePoint[];
  readonly asOf: string;
}

export type RiskPerformanceUnavailableReason =
  | 'select_single_account'
  | 'missing_starting_balance'
  | 'incomplete_money_history'
  | 'currency_mismatch'
  | 'unsupported_currency_scale';

export type RiskPerformanceIntegrityReason =
  | 'invalid_starting_balance'
  | 'invalid_money_data'
  | 'invalid_actual_exit_timestamp'
  | 'invalid_range';

export type RiskPerformanceData =
  | AvailableRiskPerformanceData
  | {
      readonly status: 'unavailable';
      readonly scope: RiskPerformanceScope;
      readonly reason: RiskPerformanceUnavailableReason;
    }
  | {
      readonly status: 'integrity_error';
      readonly scope: RiskPerformanceScope;
      readonly reason: RiskPerformanceIntegrityReason;
    };

export interface ComposeRiskPerformanceInput {
  readonly scope: RiskPerformanceScopeInput;
  /** Trusted server clock / canonical requested as-of boundary. */
  readonly asOf: Date;
  /** Closed Actual Trade rows through the requested horizon; never Exit legs. */
  readonly trades: readonly ModeledBalanceTradeInput[];
}

interface RealizationGroup {
  readonly occurredAt: string;
  readonly instantKey: string;
  readonly epochMs: number;
  readonly tradeIds: readonly string[];
  readonly deltaMinor: bigint;
}

const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Canonical D7A definition:
 *
 *   Modeled Account Balance = declared Starting Balance
 *                           + cumulative authoritative CLOSED Actual `net_pnl_minor`
 *
 * This is not broker balance or equity. There is no deposit, withdrawal,
 * transfer, credit, bonus, broker-adjustment, open-position, or mark-to-market
 * ledger in the current product, and this function deliberately invents none.
 */
export function composeRiskPerformance(input: ComposeRiskPerformanceInput): RiskPerformanceData {
  const scope = composeScope(input.scope);
  if (input.scope.account.kind === 'all') {
    return { status: 'unavailable', scope, reason: 'select_single_account' };
  }

  const account = input.scope.account;
  if (!isCurrencyCode(account.baseCurrency)) {
    return { status: 'unavailable', scope, reason: 'unsupported_currency_scale' };
  }
  if (account.startingBalance === null || account.startingBalance.trim() === '') {
    return { status: 'unavailable', scope, reason: 'missing_starting_balance' };
  }
  const starting = parseStoredStartingBalance(account.startingBalance, account.baseCurrency);
  if (starting === null || starting < 0n) {
    return { status: 'integrity_error', scope, reason: 'invalid_starting_balance' };
  }

  const asOfMs = input.asOf.getTime();
  if (!Number.isFinite(asOfMs)) {
    return { status: 'integrity_error', scope, reason: 'invalid_range' };
  }
  const range = resolveVisibleRange(input.scope.dateBounds, asOfMs);
  if (range === null) return { status: 'integrity_error', scope, reason: 'invalid_range' };

  const horizon: Array<
    ModeledBalanceTradeInput & {
      readonly occurredAt: string;
      readonly instantKey: string;
      readonly epochMs: number;
    }
  > = [];
  const seenTradeIds = new Set<string>();
  for (const trade of input.trades) {
    if (seenTradeIds.has(trade.tradeId)) {
      return { status: 'integrity_error', scope, reason: 'invalid_money_data' };
    }
    seenTradeIds.add(trade.tradeId);
    const timestamp = canonicalTimestamp(trade.actualExitedAt);
    if (timestamp === null) {
      return { status: 'integrity_error', scope, reason: 'invalid_actual_exit_timestamp' };
    }
    // Future/after-boundary rows do not affect this requested as-of result.
    if (timestamp.epochMs >= range.asOfMs) continue;
    horizon.push({ ...trade, ...timestamp });
  }

  if (horizon.some((trade) => trade.baseCurrency !== account.baseCurrency)) {
    return { status: 'unavailable', scope, reason: 'currency_mismatch' };
  }
  if (horizon.some((trade) => trade.netPnlMinor === null)) {
    return { status: 'unavailable', scope, reason: 'incomplete_money_history' };
  }
  if (
    horizon.some(
      (trade) =>
        typeof trade.netPnlMinor === 'string' && !INTEGER_PATTERN.test(trade.netPnlMinor.trim()),
    )
  ) {
    return { status: 'integrity_error', scope, reason: 'invalid_money_data' };
  }

  // Reuse D1's authoritative-money completeness/single-currency primitive;
  // D7A differs only by supplying the full basis-through-as-of horizon.
  const completeMoney = netPnl(horizon);
  if (completeMoney.status === 'unavailable') {
    const reason =
      completeMoney.reason === 'mixed_currency'
        ? 'currency_mismatch'
        : completeMoney.reason === 'unsupported_currency_scale'
          ? 'unsupported_currency_scale'
          : 'incomplete_money_history';
    return { status: 'unavailable', scope, reason };
  }

  const groups = groupRealizations(horizon);
  let balance = starting;
  let peak = starting;
  for (const group of groups) {
    if (group.epochMs >= range.startMs) break;
    balance += group.deltaMinor;
    if (balance > peak) peak = balance;
  }

  const openingBalance = balance;
  const series: ModeledBalancePoint[] = [
    {
      kind: 'opening',
      occurredAt: range.startIso,
      tradeIds: [],
      deltaMinor: '0',
      balanceMinor: openingBalance.toString(),
    },
  ];
  let maxDrawdown = drawdownAt(peak, balance);
  let periodNetPnl = 0n;
  let closedTradeCount = 0;

  for (const group of groups) {
    if (group.epochMs < range.startMs || group.epochMs >= range.asOfMs) continue;
    balance += group.deltaMinor;
    periodNetPnl += group.deltaMinor;
    closedTradeCount += group.tradeIds.length;
    if (balance > peak) peak = balance;
    const drawdown = drawdownAt(peak, balance);
    if (BigInt(drawdown.amountMinor) > BigInt(maxDrawdown.amountMinor)) maxDrawdown = drawdown;
    series.push({
      kind: 'trade_close',
      occurredAt: group.occurredAt,
      tradeIds: group.tradeIds,
      deltaMinor: group.deltaMinor.toString(),
      balanceMinor: balance.toString(),
    });
  }

  series.push({
    kind: 'as_of',
    occurredAt: new Date(range.asOfMs).toISOString(),
    tradeIds: [],
    deltaMinor: '0',
    balanceMinor: balance.toString(),
  });

  return {
    status: 'available',
    scope,
    widgets: RISK_PERFORMANCE_WIDGET_IDS,
    currency: account.baseCurrency,
    basis: {
      kind: 'declared_starting_balance',
      effectiveAt: null,
      limitations: [
        'no_cash_ledger',
        'no_unrealized_pnl',
        'starting_balance_changes_are_retroactive',
      ],
    },
    startingBalanceMinor: starting.toString(),
    openingBalanceMinor: openingBalance.toString(),
    endingBalanceMinor: balance.toString(),
    periodNetPnlMinor: periodNetPnl.toString(),
    peakBalanceMinor: peak.toString(),
    currentDrawdown: drawdownAt(peak, balance),
    maxDrawdown,
    closedTradeCount,
    completeness: {
      status: 'complete',
      horizon: 'balance_basis_through_as_of',
      checkedClosedTradeCount: horizon.length,
    },
    series,
    asOf: new Date(range.asOfMs).toISOString(),
  };
}

function composeScope(input: RiskPerformanceScopeInput): RiskPerformanceScope {
  return {
    datePreset: input.datePreset,
    dateBounds: input.dateBounds,
    account:
      input.account.kind === 'all'
        ? { kind: 'all' }
        : {
            kind: 'account',
            accountId: input.account.accountId,
            source: input.account.source,
          },
    balanceUniverse: 'selected_account_lifetime_through_as_of',
    analyticalFilters: {
      strategyId: input.strategyId,
      setupId: input.setupId,
      strategyVersionId: input.strategyVersionId,
      effect: 'not_applied_to_account_balance',
    },
  };
}

function parseStoredStartingBalance(value: string, currency: CurrencyCode): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  // NUMERIC(20,10) returns scale-padding zeros. Remove only redundant zeros;
  // a non-zero fractional digit beyond the currency exponent remains and is
  // rejected by canonical `parseMoney` rather than silently rounded.
  const normalized = trimmed.includes('.')
    ? trimmed.replace(/0+$/, '').replace(/\.$/, '')
    : trimmed;
  const parsed = parseMoney(normalized, currency);
  return parsed.ok ? parsed.value.amountMinor : null;
}

function canonicalTimestamp(
  value: Date | string,
): { readonly occurredAt: string; readonly instantKey: string; readonly epochMs: number } | null {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    if (!Number.isFinite(epochMs)) return null;
    const occurredAt = value.toISOString();
    return { occurredAt, instantKey: occurredAt.replace('Z', '000000Z'), epochMs };
  }

  // DAL strings use fixed UTC microsecond precision. Unit/domain callers may
  // supply fewer digits; padding only the comparison key makes `.123Z` and
  // `.123000Z` the same exact instant while keeping `.123001Z` distinct.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (match === null) return null;
  const epochMs = new Date(value).getTime();
  if (!Number.isFinite(epochMs)) return null;
  const base = match[1] as string;
  const fraction = match[2] ?? '';
  const instantKey = `${base}.${fraction.padEnd(9, '0')}Z`;
  const significant = fraction.replace(/0+$/, '');
  const occurredAt = `${base}.${significant.padEnd(3, '0')}Z`;
  return { occurredAt, instantKey, epochMs };
}

function resolveVisibleRange(
  bounds: AnalyticsDateBounds,
  requestedAsOfMs: number,
): { readonly startMs: number; readonly startIso: string | null; readonly asOfMs: number } | null {
  if (bounds.kind === 'all') {
    return { startMs: Number.NEGATIVE_INFINITY, startIso: null, asOfMs: requestedAsOfMs };
  }
  const startMs = new Date(bounds.start).getTime();
  const endMs = new Date(bounds.endExclusive).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
  const asOfMs = Math.min(requestedAsOfMs, endMs);
  if (asOfMs < startMs) return null;
  return { startMs, startIso: new Date(startMs).toISOString(), asOfMs };
}

function groupRealizations(
  trades: readonly (ModeledBalanceTradeInput & {
    readonly occurredAt: string;
    readonly instantKey: string;
    readonly epochMs: number;
  })[],
): readonly RealizationGroup[] {
  const grouped = new Map<
    string,
    { occurredAt: string; epochMs: number; tradeIds: string[]; deltaMinor: bigint }
  >();
  for (const trade of trades) {
    const existing = grouped.get(trade.instantKey) ?? {
      occurredAt: trade.occurredAt,
      epochMs: trade.epochMs,
      tradeIds: [],
      deltaMinor: 0n,
    };
    existing.tradeIds.push(trade.tradeId);
    existing.deltaMinor += BigInt(trade.netPnlMinor as bigint | string);
    grouped.set(trade.instantKey, existing);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([instantKey, group]) => ({
      occurredAt: group.occurredAt,
      instantKey,
      epochMs: group.epochMs,
      tradeIds: [...group.tradeIds].sort(),
      deltaMinor: group.deltaMinor,
    }));
}

function drawdownAt(peak: bigint, balance: bigint): BalanceDrawdown {
  const amount = peak - balance;
  return {
    amountMinor: amount.toString(),
    percentage:
      peak <= 0n
        ? { status: 'unavailable', reason: 'non_positive_peak' }
        : {
            status: 'available',
            value: new Decimal(amount.toString())
              .div(peak.toString())
              .times(100)
              .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
              .toFixed(4),
          },
    referencePeakMinor: peak.toString(),
  };
}
