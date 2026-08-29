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

/**
 * The one line printed UNDER a KPI figure — and after this pass, only one
 * card has one.
 *
 * Through R2C every card carried a permanent supporting line: `27W · 5BE ·
 * 34L`, `USD · 66 Trades`, `Calculated from R`, `+2.27R / -1.12R`. Five cards
 * of label / number / jargon read as a report rather than a dashboard, and
 * "Calculated from R" in particular described the implementation rather than
 * the trader's account. Those breakdowns did not become less true; they moved
 * behind the indicator affordance (see {@link BasicKpiDetail}), which is
 * where a reader goes once the headline figure has done its job.
 *
 * What stays visible is what cannot be inferred from the figure itself: how
 * many Trades produced the money total. The currency went with the rest — the
 * account strip directly above this row already names it, and repeating it
 * five characters from the currency glyph was the clearest single example of
 * the density this pass exists to remove.
 */
export type BasicKpiContext =
  | { readonly kind: 'none' }
  /** `66 Trades` — the size of the population behind an available money total. */
  | { readonly kind: 'tradeCount'; readonly tradeCount: number };

/**
 * The indicator drawn beside a KPI figure.
 *
 * IT IS A PICTURE OF SOMETHING CANONICAL, OR IT DOES NOT EXIST.
 *
 * Each variant encodes figures the payload already publishes, and each states
 * below exactly which published quantity it draws. Nothing here is a second
 * analytic, an estimate, or a series this Dashboard does not have.
 *
 * Net P&L deliberately gets `none`: it is a single signed money total, and
 * D1/D2 publish no per-Trade or per-day money SERIES for Population A. A
 * sparkline would have to be invented outright or borrowed from Population C
 * — the paired Execution-Gap population, a different Trade universe — and
 * neither is acceptable. That card is carried by typography instead, which is
 * exactly what to do when the data is not there.
 */
export type BasicKpiIndicator =
  | { readonly kind: 'none' }
  /**
   * W / BE / L as arcs. Truthful as a share of a whole because the three
   * counts PARTITION their population: every eligible closed Trade, and every
   * eligible local trading day, falls in exactly one.
   *
   * `shape` is the only thing that differs between the two cards using this
   * variant, and it exists so Trade Win % and Day Win % do not read as the
   * same widget printed twice: a full ring counts Trades, a semicircular
   * gauge counts days.
   */
  | {
      readonly kind: 'outcomeSplit';
      readonly shape: 'donut' | 'gauge';
      readonly unit: 'trades' | 'days';
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    }
  /**
   * Profit Factor as a two-part proportion.
   *
   * THE COMPONENTS ARE NOT PUBLISHED, AND THIS BAR DOES NOT PRETEND THEY ARE.
   * Gross positive R and absolute gross negative R are computed inside
   * `lib/calc`'s `profitFactor` and never reach this payload. What IS
   * published is their ratio, and a ratio fixes the proportion exactly:
   *
   *     grossWin / (grossWin + grossLoss)  =  PF / (PF + 1)
   *
   * so the split below is an algebraic restatement of the figure already on
   * the card's face, not a new quantity and not a new analytics contract.
   * Nothing anywhere claims an absolute gross-R amount, because none is
   * known — the popover states the ratio in words and stops there. That is
   * the difference between drawing a published number and inventing a
   * decorative percentage.
   */
  | { readonly kind: 'ratioSplit'; readonly winSharePercent: number }
  /**
   * The average win against the average loss, as two bars whose LENGTHS are
   * their magnitudes: the larger fills the track and the other is drawn to
   * scale beneath it, so a `2.02x` card shows a winner bar twice the loser
   * bar. That is the payoff ratio made visible rather than a second claim
   * about it. Both percentages come from the two canonical `NUMERIC`
   * averages, computed once with `decimal.js`.
   */
  | {
      readonly kind: 'magnitudePair';
      readonly winPercent: number;
      readonly lossPercent: number;
    };

/**
 * What the indicator reveals when a reader asks for it.
 *
 * Every figure here was printed permanently on the card face before this
 * pass. It is the same data from the same source; this type only decides that
 * its home is an affordance rather than a fourth line of small text.
 */
export type BasicKpiDetail =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'outcome';
      readonly unit: 'trades' | 'days';
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    }
  /** The published ratio, formatted, for the "for every 1R lost…" sentence. */
  | { readonly kind: 'ratio'; readonly factor: string }
  | { readonly kind: 'averages'; readonly averageWinR: string; readonly averageLossR: string };

export interface BasicKpiModel {
  readonly widgetId: DashboardWidgetId;
  readonly key: BasicKpiKey;
  readonly layout: DashboardLayoutItem;
  readonly value: BasicKpiValue;
  /** Whether this card's figure takes the row's lead treatment. */
  readonly emphasis: 'lead' | 'standard';
  readonly context: BasicKpiContext;
  readonly indicator: BasicKpiIndicator;
  readonly detail: BasicKpiDetail;
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
const NO_INDICATOR: BasicKpiIndicator = { kind: 'none' };
const NO_DETAIL: BasicKpiDetail = { kind: 'none' };

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

function formatted(
  metric: Parameters<typeof formatAnalyticsMetric>[0],
  style: AnalyticsDisplayStyle,
): string | null {
  const result = formatAnalyticsMetric(metric, style);
  return result.status === 'available' ? result.text : null;
}

/** A canonical decimal string as a finite `Decimal`, or `null` if it will not parse. */
function toDecimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The Profit Factor bar's win share, as an integer percent, or `null`.
 *
 * `PF / (PF + 1)`, in `decimal.js` because the input is a canonical
 * `NUMERIC(12,4)` string and CLAUDE.md §5 bans float arithmetic on those even
 * when the result only ever becomes a CSS width. A fully losing sample
 * publishes `0.0000`, which correctly yields a 0% win share rather than a
 * failure. A negative factor cannot occur — both gross components enter as
 * magnitudes — so it is refused rather than drawn inverted.
 */
function ratioSharePercent(metric: Parameters<typeof formatAnalyticsMetric>[0]): number | null {
  if (metric.status !== 'available') return null;
  const factor = toDecimal(metric.value);
  if (factor === null || factor.lessThan(0)) return null;
  return factor.dividedBy(factor.plus(1)).times(100).toDecimalPlaces(0).toNumber();
}

/**
 * The two payoff bars, each as a percent of the LARGER magnitude.
 *
 * Scaling to the larger side rather than to their sum is what makes the pair
 * read as "twice as big": at `+2.27R` against `-1.12R` the winner fills the
 * track and the loser reaches 49% of it. A share-of-total split would have
 * drawn 67/33 — a true statement, about a different question than the one the
 * `2.02x` above it asks.
 *
 * Both magnitudes are absolute because a loss average is published negative
 * and this compares SIZES. A larger magnitude of zero yields `null` rather
 * than a division by zero.
 */
function magnitudePair(
  averageWin: Parameters<typeof formatAnalyticsMetric>[0],
  averageLoss: Parameters<typeof formatAnalyticsMetric>[0],
): { readonly winPercent: number; readonly lossPercent: number } | null {
  if (averageWin.status !== 'available' || averageLoss.status !== 'available') return null;
  const win = toDecimal(averageWin.value);
  const loss = toDecimal(averageLoss.value);
  if (win === null || loss === null) return null;
  const winMagnitude = win.abs();
  const lossMagnitude = loss.abs();
  const larger = Decimal.max(winMagnitude, lossMagnitude);
  if (larger.lessThanOrEqualTo(0)) return null;
  const percent = (magnitude: Decimal): number =>
    magnitude.dividedBy(larger).times(100).toDecimalPlaces(0).toNumber();
  return { winPercent: percent(winMagnitude), lossPercent: percent(lossMagnitude) };
}

/**
 * An outcome composition's indicator and detail, or neither.
 *
 * DAY COUNTS COME FROM THE DAY-LEVEL SUMMARY, NEVER FROM `tradeWin`. The
 * caller passes `dayWinRate`'s own `winningDayCount`/`breakEvenDayCount`/
 * `losingDayCount`, which `lib/calc/day-win-rate` produces by grouping
 * Population A on Actual `exited_at` in the workspace timezone, summing each
 * local day's R, and classifying the DAY. On a data set holding exactly one
 * Trade per day the two compositions coincide — that is arithmetic, not a
 * wiring mistake — and where a day holds two Trades they diverge, which is
 * the case this separation exists to keep correct.
 */
function outcomeIndicator(
  unit: 'trades' | 'days',
  counts: { readonly wins: number; readonly breakEvens: number; readonly losses: number } | null,
): { readonly indicator: BasicKpiIndicator; readonly detail: BasicKpiDetail } {
  if (counts === null) return { indicator: NO_INDICATOR, detail: NO_DETAIL };
  const detail: BasicKpiDetail = { kind: 'outcome', unit, ...counts };
  // A zero population draws nothing rather than an empty frame; the detail
  // still exists, because "0 wins, 0 break-even, 0 losses" is answerable.
  if (counts.wins + counts.breakEvens + counts.losses <= 0) {
    return { indicator: NO_INDICATOR, detail };
  }
  return {
    indicator: {
      kind: 'outcomeSplit',
      shape: unit === 'days' ? 'gauge' : 'donut',
      unit,
      ...counts,
    },
    detail,
  };
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
      ? { kind: 'tradeCount', tradeCount: data.coverage.monetaryResultCount }
      : NO_CONTEXT;

  const dayWin = basic.dayWinRate;
  const dayWinValue: BasicKpiValue = populationEmpty
    ? EMPTY
    : dayWin.status === 'available'
      ? neutral({ status: 'available', value: dayWin.value.rate }, 'percent')
      : dayWin.status === 'unavailable'
        ? { status: 'unavailable', reason: dayWin.reason }
        : { status: 'error' };

  const averageWinR = formatted(basic.averageWinLoss.averageWinR, 'r');
  const averageLossR = formatted(basic.averageWinLoss.averageLossR, 'r');
  // `factor`, not `r`: the sentence this feeds already supplies the unit
  // ("…produced 1.61R"), and the `r` style would have signed it into
  // "+1.61R", which reads as an R outcome rather than as a ratio.
  const profitFactorText = formatted(basic.profitFactor, 'factor');

  const tradeWin = outcomeIndicator(
    'trades',
    populationEmpty
      ? null
      : {
          wins: basic.tradeWin.wins,
          breakEvens: basic.tradeWin.breakEvens,
          losses: basic.tradeWin.losses,
        },
  );

  const dayWinOutcome = outcomeIndicator(
    'days',
    !populationEmpty && dayWin.status === 'available'
      ? {
          wins: dayWin.value.winningDayCount,
          breakEvens: dayWin.value.breakEvenDayCount,
          losses: dayWin.value.losingDayCount,
        }
      : null,
  );

  const ratioShare = populationEmpty ? null : ratioSharePercent(basic.profitFactor);
  const payoff = populationEmpty
    ? null
    : magnitudePair(basic.averageWinLoss.averageWinR, basic.averageWinLoss.averageLossR);

  const models: Record<
    BasicKpiKey,
    Pick<BasicKpiModel, 'value' | 'emphasis' | 'context' | 'indicator' | 'detail'>
  > = {
    netPnl: {
      value: netPnlValue,
      // The row's lead figure: it is the one number a trader looks for first,
      // and the only one that is genuinely signed.
      emphasis: 'lead',
      context: netPnlContext,
      indicator: NO_INDICATOR,
      detail: NO_DETAIL,
    },
    tradeWin: {
      value: populationEmpty ? EMPTY : neutral(basic.tradeWin.rate, 'percent'),
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator: tradeWin.indicator,
      detail: tradeWin.detail,
    },
    profitFactor: {
      value: populationEmpty ? EMPTY : neutral(basic.profitFactor, 'factor'),
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator:
        ratioShare === null ? NO_INDICATOR : { kind: 'ratioSplit', winSharePercent: ratioShare },
      detail:
        populationEmpty || profitFactorText === null
          ? NO_DETAIL
          : { kind: 'ratio', factor: profitFactorText },
    },
    dayWin: {
      value: dayWinValue,
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator: dayWinOutcome.indicator,
      detail: dayWinOutcome.detail,
    },
    avgWinLoss: {
      value: populationEmpty ? EMPTY : neutral(basic.averageWinLoss.payoffRatio, 'multiple'),
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator:
        payoff === null
          ? NO_INDICATOR
          : {
              kind: 'magnitudePair',
              winPercent: payoff.winPercent,
              lossPercent: payoff.lossPercent,
            },
      detail:
        !populationEmpty && averageWinR !== null && averageLossR !== null
          ? { kind: 'averages', averageWinR, averageLossR }
          : NO_DETAIL,
    },
  };

  return BASIC_KPI_KEYS.map((key) => ({
    widgetId: WIDGET_ID[key],
    key,
    layout: dashboardLayoutItem(WIDGET_ID[key]),
    ...models[key],
  })).sort((a, b) => a.layout.order - b.layout.order);
}
