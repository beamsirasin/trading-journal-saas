import { Decimal } from 'decimal.js';

import type { AnalyticsUnavailableReason } from '@/lib/analytics/metrics';
import { formatAnalyticsMetric, type AnalyticsDisplayStyle } from '@/lib/analytics/presentation';
import { formatMoney, fromMinorUnits, type CurrencyCode } from '@/lib/money';

import { neutralMetric, type MetricDisplayValue } from './metric-display';
import type { DashboardPageData } from './page-data';
import { dashboardLayoutItem, type DashboardLayoutItem, type DashboardWidgetId } from './widgets';

/**
 * D3 Basic KPI presentation model.
 *
 * Pure: it reads the already-composed D2 `DashboardPageData.basic` states and
 * turns them into display strings, tones, and translation-shaped context. No
 * formula is recomputed here and nothing in this module reaches a DAL row, a
 * Trade, or a fetch — that is what keeps the five card presenters free of
 * metric-name conditionals while staying unit-testable without React.
 */

/** The five metric identities. Ordering comes from the D2 default layout. */
export const BASIC_KPI_KEYS = [
  'netPnl',
  'tradeWin',
  'profitFactor',
  'dayWin',
  'avgWinLoss',
] as const;

export type BasicKpiKey = (typeof BASIC_KPI_KEYS)[number];

/**
 * Canonical analytics reasons plus the three monetary-availability reasons
 * D1's `netPnl` owns. Both resolve under `dashboard.real.unavailable.*`.
 */
export type BasicKpiUnavailableReason =
  AnalyticsUnavailableReason | 'incomplete' | 'mixed_currency' | 'unsupported_currency_scale';

/** `empty` means no eligible Trader population at all — never an error. */
export type BasicKpiValue = MetricDisplayValue<BasicKpiUnavailableReason>;

export type BasicKpiContext =
  | { readonly kind: 'none' }
  /** `17W · 3BE · 11L`, over Trades or over local trading days. */
  | {
      readonly kind: 'composition';
      readonly unit: 'trades' | 'days';
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    }
  /** The authoritative single currency behind an available Net P&L total. */
  | { readonly kind: 'currency'; readonly currency: CurrencyCode; readonly tradeCount: number }
  /** A short standing note, e.g. "Calculated from R". */
  | { readonly kind: 'note'; readonly note: 'calculatedFromR' }
  /** `+2.12R / -0.90R` — the two canonical averages behind the payoff ratio. */
  | { readonly kind: 'averages'; readonly averageWinR: string; readonly averageLossR: string };

/**
 * The optional micro-visual under a KPI's hero figure.
 *
 * IT IS A PROPORTION OF SOMETHING ALREADY ON THE CARD, OR IT DOES NOT EXIST.
 *
 * R2C §6 permits a micro-visual only where canonical data already supports
 * one, and this union is the whole permitted set. Each variant is a picture
 * of the SAME figures the card's supporting line already prints in words —
 * never a second, quieter analytic.
 *
 * Two of the five metrics deliberately get `none`:
 *
 *   Net P&L        a single signed money total. D1/D2 publish no per-day or
 *                  per-Trade money SERIES for Population A, so a sparkline
 *                  would have to be invented or borrowed from Population C
 *                  (the paired Execution-Gap population), which is a
 *                  different Trade universe. Neither is acceptable.
 *   Profit Factor  one ratio with no published components on this payload
 *                  (`Σ R⁺` and `|Σ R⁻|` are not part of `basic`). A bar of
 *                  one number is decoration.
 *
 * Those two get typography instead, which is exactly what §6 asks for when
 * the data is not there. This module will not fabricate either.
 */
export type BasicKpiMicroVisual =
  | { readonly kind: 'none' }
  /**
   * A three-segment proportion bar over W / BE / L. Truthful as a share of a
   * whole because the three counts PARTITION their population: every closed
   * Trade (or every eligible local trading day) falls in exactly one.
   */
  | {
      readonly kind: 'outcomeSplit';
      readonly unit: 'trades' | 'days';
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    }
  /**
   * Two opposed magnitude bars — the average win against the average loss —
   * which is precisely what the payoff ratio on the card's face measures.
   *
   * `winSharePercent` is an integer 0–100 computed once, with `decimal.js`,
   * from the two canonical NUMERIC strings. It is a BAR WIDTH, not a
   * financial figure: no money or R value on this card is ever derived from
   * it, and the two R averages beside it stay the authoritative text.
   */
  | {
      readonly kind: 'winLossBalance';
      readonly winSharePercent: number;
      readonly averageWinR: string;
      readonly averageLossR: string;
    };

export interface BasicKpiModel {
  readonly widgetId: DashboardWidgetId;
  readonly key: BasicKpiKey;
  readonly layout: DashboardLayoutItem;
  readonly value: BasicKpiValue;
  readonly context: BasicKpiContext;
  readonly micro: BasicKpiMicroVisual;
}

const WIDGET_ID: Record<BasicKpiKey, DashboardWidgetId> = {
  netPnl: 'basic.net-pnl',
  tradeWin: 'basic.trade-win-rate',
  profitFactor: 'basic.profit-factor',
  dayWin: 'basic.day-win-rate',
  avgWinLoss: 'basic.avg-win-loss',
};

const EMPTY: BasicKpiValue = { status: 'empty' };
const NO_CONTEXT: BasicKpiContext = { kind: 'none' };

/**
 * Signed money, formatted from the authoritative minor-unit total.
 *
 * The gain sign is prepended here rather than delegated to `formatMoney`'s
 * `signDisplay: 'always'`, which places it after the symbol (`$+10.00`) and
 * would also mark a zero total as `+$0.00` — reading as a gain when there was
 * none. So: `+$10.00`, `-$10.00`, `$0.00`, with zero neutral in tone too.
 */
function formatNetPnl(currency: CurrencyCode, totalMinor: string): BasicKpiValue {
  let amountMinor: bigint;
  try {
    amountMinor = BigInt(totalMinor);
  } catch {
    return { status: 'error' };
  }
  const money = fromMinorUnits(amountMinor, currency);
  if (!money.ok) return { status: 'error' };
  const formatted = formatMoney(money.value, { style: 'symbol' });
  return {
    status: 'available',
    text: amountMinor > 0n ? `+${formatted}` : formatted,
    tone: amountMinor > 0n ? 'positive' : amountMinor < 0n ? 'negative' : 'neutral',
  };
}

/**
 * On this row only Net P&L — genuinely signed outcome data — earns
 * positive/negative colour; every other headline is neutral whatever its
 * value. See `neutralMetric` for why.
 */
function neutral(
  metric: Parameters<typeof formatAnalyticsMetric>[0],
  style: AnalyticsDisplayStyle,
): BasicKpiValue {
  return neutralMetric<BasicKpiUnavailableReason>(metric, style);
}

function signedR(metric: Parameters<typeof formatAnalyticsMetric>[0]): string | null {
  const formatted = formatAnalyticsMetric(metric, 'r');
  return formatted.status === 'available' ? formatted.text : null;
}

const NO_MICRO: BasicKpiMicroVisual = { kind: 'none' };

/**
 * The bar for a W/BE/L composition, or `none` when the population is empty.
 *
 * Derived from the SAME context the supporting line prints, so the picture
 * and the sentence can never disagree — a bar sourced independently would be
 * a second place for these three counts to come from. A zero total draws
 * nothing rather than an empty frame.
 */
function microFromComposition(context: BasicKpiContext): BasicKpiMicroVisual {
  if (context.kind !== 'composition') return NO_MICRO;
  if (context.wins + context.breakEvens + context.losses <= 0) return NO_MICRO;
  return {
    kind: 'outcomeSplit',
    unit: context.unit,
    wins: context.wins,
    breakEvens: context.breakEvens,
    losses: context.losses,
  };
}

/**
 * The win side's share of the two averages' combined magnitude, as an integer
 * percent, or `null` when the pair cannot support a bar.
 *
 * `Decimal`, not `Number`: these arrive as canonical `NUMERIC(12,4)` strings
 * and CLAUDE.md §5 bans float arithmetic on them, even for a value that only
 * ever becomes a CSS width. Both magnitudes are taken as absolutes because a
 * loss average is published negative and the bar compares SIZES; a combined
 * magnitude of zero yields `null` rather than a division by zero or a
 * meaningless 50/50 split.
 */
function winSharePercent(
  averageWin: Parameters<typeof formatAnalyticsMetric>[0],
  averageLoss: Parameters<typeof formatAnalyticsMetric>[0],
): number | null {
  if (averageWin.status !== 'available' || averageLoss.status !== 'available') return null;
  let win: Decimal;
  let loss: Decimal;
  try {
    win = new Decimal(averageWin.value).abs();
    loss = new Decimal(averageLoss.value).abs();
  } catch {
    return null;
  }
  const total = win.plus(loss);
  if (!total.isFinite() || total.lessThanOrEqualTo(0)) return null;
  return win.dividedBy(total).times(100).toDecimalPlaces(0).toNumber();
}

/**
 * Composes the five Basic KPI view models from the D2 payload.
 *
 * When the eligible Trader population is empty every card reports `empty`
 * rather than five separately worded unavailable reasons: "no Trades yet" is
 * one truthful fact about the current filter, not five metric failures.
 */
export function composeBasicKpis(data: DashboardPageData): readonly BasicKpiModel[] {
  const populationEmpty = data.availability.trader === 'empty';
  const basic = data.basic;

  const netPnlValue: BasicKpiValue = populationEmpty
    ? EMPTY
    : basic.netPnl.status === 'empty'
      ? EMPTY
      : basic.netPnl.status === 'unavailable'
        ? { status: 'unavailable', reason: basic.netPnl.reason }
        : formatNetPnl(basic.netPnl.currency, basic.netPnl.totalMinor);

  const netPnlContext: BasicKpiContext =
    netPnlValue.status === 'available' && basic.netPnl.status === 'available'
      ? {
          kind: 'currency',
          currency: basic.netPnl.currency,
          tradeCount: data.coverage.monetaryResultCount,
        }
      : NO_CONTEXT;

  const dayWin = basic.dayWinRate;
  const dayWinValue: BasicKpiValue = populationEmpty
    ? EMPTY
    : dayWin.status === 'available'
      ? neutral({ status: 'available', value: dayWin.value.rate }, 'percent')
      : dayWin.status === 'unavailable'
        ? { status: 'unavailable', reason: dayWin.reason }
        : { status: 'error' };

  const averageWinR = signedR(basic.averageWinLoss.averageWinR);
  const averageLossR = signedR(basic.averageWinLoss.averageLossR);

  const tradeWinContext: BasicKpiContext = populationEmpty
    ? NO_CONTEXT
    : {
        kind: 'composition',
        unit: 'trades',
        wins: basic.tradeWin.wins,
        breakEvens: basic.tradeWin.breakEvens,
        losses: basic.tradeWin.losses,
      };

  const dayWinContext: BasicKpiContext =
    !populationEmpty && dayWin.status === 'available'
      ? {
          kind: 'composition',
          unit: 'days',
          wins: dayWin.value.winningDayCount,
          breakEvens: dayWin.value.breakEvenDayCount,
          losses: dayWin.value.losingDayCount,
        }
      : NO_CONTEXT;

  const payoffShare = populationEmpty
    ? null
    : winSharePercent(basic.averageWinLoss.averageWinR, basic.averageWinLoss.averageLossR);

  const models: Record<BasicKpiKey, Pick<BasicKpiModel, 'value' | 'context' | 'micro'>> = {
    // No series exists for Population A money on this payload, so no
    // sparkline exists either. Typography carries this card (§6).
    netPnl: { value: netPnlValue, context: netPnlContext, micro: NO_MICRO },
    tradeWin: {
      value: populationEmpty ? EMPTY : neutral(basic.tradeWin.rate, 'percent'),
      context: tradeWinContext,
      micro: microFromComposition(tradeWinContext),
    },
    // One ratio, no published components. Typography carries this card too.
    profitFactor: {
      value: populationEmpty ? EMPTY : neutral(basic.profitFactor, 'factor'),
      context: populationEmpty ? NO_CONTEXT : { kind: 'note', note: 'calculatedFromR' },
      micro: NO_MICRO,
    },
    dayWin: {
      value: dayWinValue,
      context: dayWinContext,
      micro: microFromComposition(dayWinContext),
    },
    avgWinLoss: {
      value: populationEmpty ? EMPTY : neutral(basic.averageWinLoss.payoffRatio, 'multiple'),
      context:
        !populationEmpty && averageWinR !== null && averageLossR !== null
          ? { kind: 'averages', averageWinR, averageLossR }
          : NO_CONTEXT,
      micro:
        !populationEmpty && averageWinR !== null && averageLossR !== null && payoffShare !== null
          ? {
              kind: 'winLossBalance',
              winSharePercent: payoffShare,
              averageWinR,
              averageLossR,
            }
          : NO_MICRO,
    },
  };

  return BASIC_KPI_KEYS.map((key) => ({
    widgetId: WIDGET_ID[key],
    key,
    layout: dashboardLayoutItem(WIDGET_ID[key]),
    ...models[key],
  })).sort((a, b) => a.layout.order - b.layout.order);
}
