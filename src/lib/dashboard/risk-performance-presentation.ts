import Decimal from 'decimal.js';

import type { AnalyticsDatePreset } from '@/lib/analytics/filters';
import type {
  BalanceDrawdown,
  ModeledBalancePoint,
  RiskPerformanceData,
  RiskPerformanceIntegrityReason,
  RiskPerformanceUnavailableReason,
} from '@/lib/dashboard/risk-performance';
import { formatMoney, fromMinorUnits, minorUnitScale, type CurrencyCode } from '@/lib/money';
import { formatInstant, parseInstant } from '@/lib/time';

/**
 * D7B presentation model for the shared Risk Performance section.
 *
 * PURE, AND THE ONLY PLACE A D7A FIGURE IS TURNED INTO TEXT.
 *
 * Every number below arrives already canonical from `composeRiskPerformance`
 * — the modeled balance, the period P&L, both drawdown magnitudes, both
 * drawdown percentages and the carried peak. This module formats them once
 * and hands strings to React. It never sums a delta, never divides an amount
 * by a peak, never re-derives an ending balance from an opening balance plus
 * a visible period P&L, and never invents a percentage D7A declined to
 * publish (`non_positive_peak` stays unavailable rather than becoming 0%).
 *
 * The one numeric value that leaves here as a `number` is the SVG coordinate
 * a chart library cannot do without. It is a plotting coordinate, never a
 * financial value, and it always travels beside the canonical text.
 */

export type RiskPerformanceViewErrorReason =
  | RiskPerformanceIntegrityReason
  /** The Risk boundary itself failed — a rejected filter, or a thrown read. */
  | 'service_error'
  /** A canonical minor-unit string the money registry refused to represent. */
  | 'invalid_money_display';

export interface RiskDrawdownView {
  /** Unsigned magnitude, e.g. `$110.00`. A drawdown has no direction to sign. */
  readonly amountText: string;
  /** `0.89%`, or `null` when D7A reported a non-positive reference peak. */
  readonly percentageText: string | null;
  /** Zero drawdown is presented neutrally — see the card's tone rules. */
  readonly isZero: boolean;
}

export type RiskMoneyTone = 'positive' | 'negative' | 'neutral';

export interface RiskBalancePoint {
  /** Stable, unique, and the chart's category key — dates repeat, keys do not. */
  readonly key: string;
  readonly kind: ModeledBalancePoint['kind'];
  /** Plotting coordinate only. The reader is always shown `balanceText`. */
  readonly balance: number;
  readonly balanceText: string;
  /** Signed parent-Trade realization at this point; `null` on anchors. */
  readonly deltaText: string | null;
  readonly deltaTone: RiskMoneyTone;
  /** More than one only when D7A grouped identical realization instants. */
  readonly tradeCount: number;
  /** Short axis label in the workspace timezone; `null` when no instant exists. */
  readonly dateLabel: string | null;
  /** Fuller tooltip label in the workspace timezone. */
  readonly dateTimeLabel: string | null;
}

export interface RiskPerformanceAvailableView {
  readonly status: 'available';
  readonly datePreset: AnalyticsDatePreset;
  readonly currency: CurrencyCode;
  /**
   * How this range's opening balance came to be, so the copy can say the
   * true thing about it and only the true thing:
   *
   *   `all`                  — no bounded opening at all, and no trustworthy
   *                            financial inception instant to date it with
   *   `carried`              — Trades closed BEFORE this range moved the
   *                            balance into it
   *   `at_starting_balance`  — a bounded range that nothing was carried into,
   *                            because no Trade closed before it
   *
   * The third case is why this is not a boolean. Telling the owner of a
   * brand-new Account that their window "was carried in from Trades closed
   * before it" states a history that does not exist.
   */
  readonly opening: {
    readonly kind: 'all' | 'carried' | 'at_starting_balance';
    readonly balanceText: string;
  };
  readonly modeledBalanceText: string;
  readonly periodNetPnl: { readonly text: string; readonly tone: RiskMoneyTone };
  readonly currentDrawdown: RiskDrawdownView;
  readonly maxDrawdown: RiskDrawdownView;
  readonly peakBalanceText: string;
  /** Reference-line coordinate for the carried high-water mark. */
  readonly peakBalance: number;
  readonly closedTradeCount: number;
  /** False for an Account whose modeled balance is still the Starting Balance. */
  readonly hasClosedTrades: boolean;
  readonly points: readonly RiskBalancePoint[];
  /** True when a Strategy/Setup/Version filter is active and does NOT apply here. */
  readonly showsAnalyticalScopeNote: boolean;
}

export type RiskPerformanceView =
  | RiskPerformanceAvailableView
  | { readonly status: 'unavailable'; readonly reason: RiskPerformanceUnavailableReason }
  | { readonly status: 'error'; readonly reason: RiskPerformanceViewErrorReason };

export interface ComposeRiskPerformanceViewInput {
  readonly data: RiskPerformanceData;
  /** The workspace analytics timezone the rest of the Dashboard already resolved. */
  readonly timezone: string;
  readonly dateLocale: string;
}

/** A failed Risk boundary — never collapsed into a product limitation. */
export function riskPerformanceServiceError(): RiskPerformanceView {
  return { status: 'error', reason: 'service_error' };
}

export function composeRiskPerformanceView(
  input: ComposeRiskPerformanceViewInput,
): RiskPerformanceView {
  const { data } = input;
  if (data.status === 'unavailable') return { status: 'unavailable', reason: data.reason };
  if (data.status === 'integrity_error') return { status: 'error', reason: data.reason };

  const currency = data.currency;
  const money = (minor: string): string | null => formatMinor(minor, currency, 'unsigned');

  const modeledBalanceText = money(data.endingBalanceMinor);
  const openingBalanceText = money(data.openingBalanceMinor);
  const periodNetPnlText = formatMinor(data.periodNetPnlMinor, currency, 'signed');
  const peakBalanceText = money(data.peakBalanceMinor);
  const currentDrawdown = drawdownView(data.currentDrawdown, currency);
  const maxDrawdown = drawdownView(data.maxDrawdown, currency);
  const peakBalance = coordinate(data.peakBalanceMinor, currency);
  const points = balancePoints(data.series, currency, input.timezone, input.dateLocale);

  if (
    modeledBalanceText === null ||
    openingBalanceText === null ||
    periodNetPnlText === null ||
    peakBalanceText === null ||
    currentDrawdown === null ||
    maxDrawdown === null ||
    peakBalance === null ||
    points === null
  ) {
    // A canonical minor-unit total the money registry cannot represent is an
    // integrity problem, not an empty state: rendering a dash beside four
    // real figures would hide it.
    return { status: 'error', reason: 'invalid_money_display' };
  }

  const filters = data.scope.analyticalFilters;

  return {
    status: 'available',
    datePreset: data.scope.datePreset,
    currency,
    opening: {
      kind:
        data.scope.dateBounds.kind === 'all'
          ? 'all'
          : data.openingBalanceMinor === data.startingBalanceMinor
            ? 'at_starting_balance'
            : 'carried',
      balanceText: openingBalanceText,
    },
    modeledBalanceText,
    periodNetPnl: { text: periodNetPnlText, tone: toneOf(data.periodNetPnlMinor) },
    currentDrawdown,
    maxDrawdown,
    peakBalanceText,
    peakBalance,
    closedTradeCount: data.closedTradeCount,
    hasClosedTrades: data.closedTradeCount > 0,
    points,
    showsAnalyticalScopeNote:
      filters.strategyId !== null || filters.setupId !== null || filters.strategyVersionId !== null,
  };
}

/**
 * `+$1,040.00` / `-$110.00` / `$0.00`.
 *
 * The gain sign is prepended rather than delegated to `formatMoney`'s
 * `signDisplay: 'always'`, which places it after the symbol (`$+10.00`) and
 * would mark an exactly-zero period as `+$0.00` — reading as a gain when
 * there was none. The same rule D3's Net P&L already follows.
 */
function formatMinor(
  minor: string,
  currency: CurrencyCode,
  sign: 'signed' | 'unsigned',
): string | null {
  const amountMinor = toBigInt(minor);
  if (amountMinor === null) return null;
  const money = fromMinorUnits(amountMinor, currency);
  if (!money.ok) return null;
  const text = formatMoney(money.value, { style: 'symbol' });
  return sign === 'signed' && amountMinor > 0n ? `+${text}` : text;
}

function toBigInt(minor: string): bigint | null {
  try {
    return BigInt(minor);
  } catch {
    return null;
  }
}

function toneOf(minor: string): RiskMoneyTone {
  const amountMinor = toBigInt(minor);
  if (amountMinor === null) return 'neutral';
  return amountMinor > 0n ? 'positive' : amountMinor < 0n ? 'negative' : 'neutral';
}

function drawdownView(drawdown: BalanceDrawdown, currency: CurrencyCode): RiskDrawdownView | null {
  const amountText = formatMinor(drawdown.amountMinor, currency, 'unsigned');
  if (amountText === null) return null;
  return {
    amountText,
    // D7A's value is ALREADY a percentage (`0.8857` means 0.8857%), so it is
    // only rounded for display and never multiplied by 100 again — which is
    // exactly what the shared analytics `percent` style would have done.
    percentageText:
      drawdown.percentage.status === 'available'
        ? `${new Decimal(drawdown.percentage.value)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2)}%`
        : null,
    isZero: drawdown.amountMinor === '0',
  };
}

/**
 * Minor units to a plot coordinate.
 *
 * Deliberately the ONLY float in this module. `Number` is unsafe for money
 * and safe for an SVG y-position, and every point carries the exact string
 * beside it, so nothing a reader ever sees passes through here.
 */
function coordinate(minor: string, currency: CurrencyCode): number | null {
  const amountMinor = toBigInt(minor);
  if (amountMinor === null) return null;
  const value = Number(amountMinor) / Number(minorUnitScale(currency));
  return Number.isFinite(value) ? value : null;
}

function balancePoints(
  series: readonly ModeledBalancePoint[],
  currency: CurrencyCode,
  timezone: string,
  dateLocale: string,
): readonly RiskBalancePoint[] | null {
  const points: RiskBalancePoint[] = [];
  for (const [index, point] of series.entries()) {
    const balanceText = formatMinor(point.balanceMinor, currency, 'unsigned');
    const balance = coordinate(point.balanceMinor, currency);
    if (balanceText === null || balance === null) return null;
    const deltaText =
      point.kind === 'trade_close' ? formatMinor(point.deltaMinor, currency, 'signed') : null;
    if (point.kind === 'trade_close' && deltaText === null) return null;
    points.push({
      key: `p${index}`,
      kind: point.kind,
      balance,
      balanceText,
      deltaText,
      deltaTone: point.kind === 'trade_close' ? toneOf(point.deltaMinor) : 'neutral',
      tradeCount: point.tradeIds.length,
      dateLabel: label(point.occurredAt, timezone, dateLocale, 'date'),
      dateTimeLabel: label(point.occurredAt, timezone, dateLocale, 'datetime'),
    });
  }
  return points;
}

/**
 * Labels in the WORKSPACE timezone (CLAUDE.md §7) — never the server's zone
 * and never the browser's, which is also why this resolves here on the server
 * rather than inside the client chart.
 *
 * `null` in, `null` out: D7A publishes no opening instant for the All range
 * because the schema has no trustworthy financial inception timestamp, and a
 * label must not manufacture one.
 */
function label(
  occurredAt: string | null,
  timezone: string,
  dateLocale: string,
  style: 'date' | 'datetime',
): string | null {
  if (occurredAt === null) return null;
  const instant = parseInstant(occurredAt);
  if (!instant.ok) return null;
  const formatted = formatInstant(instant.value, timezone, { style, locale: dateLocale });
  return formatted.ok ? formatted.value : null;
}
