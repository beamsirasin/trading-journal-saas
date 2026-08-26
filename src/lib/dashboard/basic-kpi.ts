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

export interface BasicKpiModel {
  readonly widgetId: DashboardWidgetId;
  readonly key: BasicKpiKey;
  readonly layout: DashboardLayoutItem;
  readonly value: BasicKpiValue;
  readonly context: BasicKpiContext;
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

  const models: Record<BasicKpiKey, Pick<BasicKpiModel, 'value' | 'context'>> = {
    netPnl: { value: netPnlValue, context: netPnlContext },
    tradeWin: {
      value: populationEmpty ? EMPTY : neutral(basic.tradeWin.rate, 'percent'),
      context: populationEmpty
        ? NO_CONTEXT
        : {
            kind: 'composition',
            unit: 'trades',
            wins: basic.tradeWin.wins,
            breakEvens: basic.tradeWin.breakEvens,
            losses: basic.tradeWin.losses,
          },
    },
    profitFactor: {
      value: populationEmpty ? EMPTY : neutral(basic.profitFactor, 'factor'),
      context: populationEmpty ? NO_CONTEXT : { kind: 'note', note: 'calculatedFromR' },
    },
    dayWin: {
      value: dayWinValue,
      context:
        !populationEmpty && dayWin.status === 'available'
          ? {
              kind: 'composition',
              unit: 'days',
              wins: dayWin.value.winningDayCount,
              breakEvens: dayWin.value.breakEvenDayCount,
              losses: dayWin.value.losingDayCount,
            }
          : NO_CONTEXT,
    },
    avgWinLoss: {
      value: populationEmpty ? EMPTY : neutral(basic.averageWinLoss.payoffRatio, 'multiple'),
      context:
        !populationEmpty && averageWinR !== null && averageLossR !== null
          ? { kind: 'averages', averageWinR, averageLossR }
          : NO_CONTEXT,
    },
  };

  return BASIC_KPI_KEYS.map((key) => ({
    widgetId: WIDGET_ID[key],
    key,
    layout: dashboardLayoutItem(WIDGET_ID[key]),
    ...models[key],
  })).sort((a, b) => a.layout.order - b.layout.order);
}
