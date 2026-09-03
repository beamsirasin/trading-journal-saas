import { Decimal } from 'decimal.js';

import type { AnalyticsUnavailableReason } from '@/lib/analytics/metrics';
import { formatAnalyticsMetric, type AnalyticsDisplayStyle } from '@/lib/analytics/presentation';
import { formatMoney, fromMinorUnits, type CurrencyCode } from '@/lib/money';

import { neutralMetric, signedMetric, type MetricDisplayValue } from './metric-display';
import type { DashboardPageData } from './page-data';
import { dashboardLayoutItem, type DashboardLayoutItem, type DashboardWidgetId } from './widgets';

/**
 * D3 Basic KPI presentation model.
 *
 * Pure: it reads the already-composed D2 `DashboardPageData` states and turns
 * them into display strings, tones, and translation-shaped context. No formula
 * is recomputed here and nothing in this module reaches a DAL row, a Trade, or
 * a fetch — that is what keeps the five card presenters free of metric-name
 * conditionals while staying unit-testable without React.
 */

/**
 * The five metric identities. Ordering comes from the D2 default layout.
 *
 * THE ROW ANSWERS FIVE QUESTIONS IN ONE PASS, LEFT TO RIGHT: how much money
 * did I make, how many R, how often do I win, what do I plan before entering,
 * and what does an average Trade actually return. Profit Factor, Day Win % and
 * Avg Win / Loss stood here before and are all recombinations or second
 * readings of the same win/loss shape — a beginner reading five figures should
 * not have to hold three of them together to learn anything the first two did
 * not already say. Those three remain canonical and still reach this payload
 * (see `DashboardPageData['basic']`); Analytics is where they are read.
 *
 * `tradeWin` keeps its key and its widget ID: the metric is unchanged
 * canonical trade win rate, and only its TITLE became "Win Rate".
 */
export const BASIC_KPI_KEYS = [
  'netPnl',
  'totalR',
  'tradeWin',
  'avgPlannedRr',
  'avgRPerTrade',
] as const;

export type BasicKpiKey = (typeof BASIC_KPI_KEYS)[number];

/**
 * Canonical analytics reasons, the three monetary-availability reasons D1's
 * `netPnl` owns, and `no_planned_rr`.
 *
 * `no_planned_rr` is this band's own reason rather than a new canonical
 * analytics one: it is not a metric failure over the population but a
 * statement that the PLAN side of these Trades was never filled in. Reporting
 * it as `averageR`'s `no_trades` would claim the range holds no Trades at all,
 * while the four cards beside it were printing figures from those very Trades.
 * All of them resolve under `dashboard.real.unavailable.*`.
 */
export type BasicKpiUnavailableReason =
  | AnalyticsUnavailableReason
  | 'incomplete'
  | 'mixed_currency'
  | 'unsupported_currency_scale'
  | 'no_planned_rr';

/** `empty` means no eligible Trader population at all — never an error. */
export type BasicKpiValue = MetricDisplayValue<BasicKpiUnavailableReason>;

/**
 * The one line printed UNDER a KPI figure — and only one card has one.
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
  | { readonly kind: 'tradeCount'; readonly tradeCount: number }
  /**
   * `No money result on 3 of 11 closed Trades — recorded by price`.
   *
   * The coverage line for a money total that could NOT be stated. It exists
   * because the unavailable card used to say only "Incomplete monetary
   * results" and then withhold its context line entirely, so the reader was
   * told a total was missing, not how much of their history was missing it,
   * and never that their own recording choice was the cause.
   *
   * The cause is safe to name here. This population is
   * `selectTraderEligible`, which is closed Trades only, and a closed Trade
   * reaches `net_pnl_minor = null` by exactly one route: a Price-mode Actual,
   * for which `composeRealizedActual` returns a null `realizedPnlMinor` by
   * design. A closed Money-mode Trade always carries one.
   */
  | { readonly kind: 'missingMoney'; readonly missing: number; readonly total: number };

/** One normalized sparkline vertex, in a 0–100 box. `y` is SVG-down. */
export interface BasicKpiSparkPoint {
  readonly x: number;
  readonly y: number;
}

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
 * exactly what to do when the data is not there. Note that this is precisely
 * the reason Total R CAN have one: R has a published Population A series
 * (`trader.equityCurve`) and money does not.
 */
export type BasicKpiIndicator =
  | { readonly kind: 'none' }
  /**
   * W / BE / L as arcs on a full ring. Truthful as a share of a whole because
   * the three counts PARTITION their population: every eligible closed Trade
   * falls in exactly one.
   */
  | {
      readonly kind: 'outcomeSplit';
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    }
  /**
   * Cumulative ACTUAL R across the scoped population, as a step-free polyline.
   *
   * THE SERIES IS THE FIGURE'S OWN HISTORY, NOT A SECOND ONE. Every vertex is
   * a `cumulativeR` value from `lib/calc`'s `equityCurveR` over Population A,
   * in that engine's canonical order, and its LAST vertex is the Total R
   * printed on the card face. Nothing is smoothed, interpolated, extrapolated
   * or zero-filled; a long population is thinned by dropping vertices, never
   * by averaging them into values no Trade produced.
   *
   * `tone` comes from where the series ends, which is the same sign the figure
   * carries — so the drawing and the number can never disagree.
   */
  | {
      readonly kind: 'cumulativeR';
      readonly tone: 'positive' | 'negative' | 'neutral';
      readonly points: readonly BasicKpiSparkPoint[];
    }
  /**
   * Avg Planned RR as one track split between planned risk and planned reward.
   *
   * `riskSharePercent = 1 / (1 + RR)` — the algebraic restatement of the ratio
   * already on the card's face, not a new quantity: a `1 : 3` plan draws 25%
   * risk against 75% reward. Both components are shares of the PLAN, so unlike
   * a Profit-Factor split there is nothing here that the published figure does
   * not already fully determine.
   */
  | { readonly kind: 'riskRewardSplit'; readonly riskSharePercent: number }
  /**
   * Avg R / Trade as a zero-centred deflection.
   *
   * The question this answers is "is my average Trade above or below zero",
   * which is a direction before it is a magnitude. `fillPercent` is a share of
   * the FULL track measured from its centre, so it never exceeds 50.
   *
   * THE SCALE IS FIXED, NOT FITTED TO THE DATA. The visual domain is
   * ±{@link AVG_R_INDICATOR_DOMAIN_R}R and values outside it are clamped, so
   * the same bar means the same thing on every account and in every date
   * range; a dataset-relative scale would silently redraw a `+0.05R` account
   * as a full deflection. Clamping touches only the drawing — the figure above
   * it remains the real value and stays authoritative.
   */
  | {
      readonly kind: 'divergingBar';
      readonly direction: 'positive' | 'negative' | 'zero';
      readonly fillPercent: number;
    };

/**
 * What the indicator reveals when a reader asks for it.
 *
 * Every figure here is data the card face cannot carry. This type only decides
 * that its home is an affordance rather than a fourth line of small text.
 */
export type BasicKpiDetail =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'outcome';
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    }
  /**
   * The planned ratio in words, plus the size of the population it was
   * averaged over.
   *
   * The coverage line is not decoration. Avg Planned RR is the one card in the
   * band whose denominator can be SMALLER than the others': a Trade recorded
   * with no planned target carries no ratio and is excluded rather than
   * counted as zero. A reader comparing "66 Trades" under Net P&L with this
   * average has exactly one place to find out that it came from 58 of them.
   */
  | { readonly kind: 'plannedRatio'; readonly factor: string; readonly tradeCount: number };

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
  totalR: 'basic.total-r',
  tradeWin: 'basic.trade-win-rate',
  avgPlannedRr: 'basic.avg-planned-rr',
  avgRPerTrade: 'basic.avg-r-per-trade',
};

/**
 * The half-width of the Avg R / Trade indicator's fixed visual domain, in R.
 *
 * ±1R covers the range a per-Trade average realistically occupies — an
 * expectancy above +1R per Trade is exceptional and below -1R is catastrophic
 * — so within it the bar reads as a real magnitude and outside it as "off the
 * scale, in this direction". Documented as a constant because a stable scale
 * is the entire point: the bar has to mean the same thing across accounts,
 * ranges and filters.
 */
export const AVG_R_INDICATOR_DOMAIN_R = 1;

/**
 * The most vertices the cumulative-R sparkline draws.
 *
 * A 400-Trade population inside a 56px-wide indicator has roughly seven
 * vertices per visible pixel; keeping them all would cost payload and DOM for
 * a shape no one can see. Thinning DROPS vertices at an even stride and always
 * keeps the first and last, so every point drawn is a real cumulative total
 * and the curve still starts and ends where the population does.
 */
const SPARKLINE_MAX_POINTS = 32;

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
 * A supporting figure, coloured only where its SIGN is the finding.
 *
 * Net P&L, Total R and Avg R / Trade are signed outcomes — "did this make or
 * lose" is the whole content of the number — so they keep the tone their sign
 * implies. Win Rate and Avg Planned RR are levels, not verdicts: a high win
 * rate is not inherently good (CLAUDE.md §1) and a planned ratio is an
 * intention rather than a result, so both stay neutral whatever their value.
 * That is the same rule the rest of the product spends `--positive` /
 * `--negative` by; see `signedMetric` / `neutralMetric`.
 */
function neutral(
  metric: Parameters<typeof formatAnalyticsMetric>[0],
  style: AnalyticsDisplayStyle,
): BasicKpiValue {
  return neutralMetric<BasicKpiUnavailableReason>(metric, style);
}

function signed(
  metric: Parameters<typeof formatAnalyticsMetric>[0],
  style: AnalyticsDisplayStyle,
): BasicKpiValue {
  return signedMetric<BasicKpiUnavailableReason>(metric, style);
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
 * `1 : 3.20` — the planned reward per one unit of planned risk.
 *
 * Spelled as a ratio rather than as a bare `3.20` because that is the form a
 * trader plans in, and because the leading `1` is what names the unit: `3.20`
 * alone is indistinguishable from a Profit Factor or an R value on a row that
 * also carries both. The spacing is fixed here rather than translated — it is
 * a numeric format, like `40.91%` and `+2.00R` beside it, not a sentence.
 */
function formatPlannedRatio(factor: string): string {
  return `1 : ${factor}`;
}

/**
 * The Avg Planned RR bar's risk share, as an integer percent, or `null`.
 *
 * `1 / (1 + RR)`, in `decimal.js` because the input is a canonical
 * `NUMERIC(12,4)` string and CLAUDE.md §5 bans float arithmetic on those even
 * when the result only ever becomes a CSS width. A plan targeting exactly zero
 * reward correctly fills the track with risk. A negative average cannot occur
 * — `plannedR` requires the Target on the profitable side of Entry and
 * `moneyPlannedR` refuses a negative reward — so it is refused here rather
 * than drawn inverted.
 */
function riskSharePercent(metric: Parameters<typeof formatAnalyticsMetric>[0]): number | null {
  if (metric.status !== 'available') return null;
  const ratio = toDecimal(metric.value);
  if (ratio === null || ratio.lessThan(0)) return null;
  return new Decimal(1).dividedBy(ratio.plus(1)).times(100).toDecimalPlaces(0).toNumber();
}

/**
 * The Avg R / Trade deflection: which side of zero, and how far along the
 * fixed ±{@link AVG_R_INDICATOR_DOMAIN_R}R domain.
 *
 * `fillPercent` is a share of the FULL track measured from its centre, so a
 * clamped value reaches 50 and never more.
 */
function divergingBar(
  metric: Parameters<typeof formatAnalyticsMetric>[0],
): { readonly direction: 'positive' | 'negative' | 'zero'; readonly fillPercent: number } | null {
  if (metric.status !== 'available') return null;
  const value = toDecimal(metric.value);
  if (value === null) return null;
  const magnitude = Decimal.min(value.abs(), AVG_R_INDICATOR_DOMAIN_R);
  return {
    direction: value.greaterThan(0) ? 'positive' : value.lessThan(0) ? 'negative' : 'zero',
    fillPercent: magnitude
      .dividedBy(AVG_R_INDICATOR_DOMAIN_R)
      .times(50)
      .toDecimalPlaces(2)
      .toNumber(),
  };
}

/**
 * Thins a series to at most {@link SPARKLINE_MAX_POINTS} vertices by dropping,
 * never by averaging. The first and last are always kept.
 */
function thin<T>(points: readonly T[]): readonly T[] {
  if (points.length <= SPARKLINE_MAX_POINTS) return points;
  const last = points.length - 1;
  const kept: T[] = [];
  for (let slot = 0; slot < SPARKLINE_MAX_POINTS; slot += 1) {
    const index = Math.round((slot * last) / (SPARKLINE_MAX_POINTS - 1));
    const point = points[index];
    if (point !== undefined) kept.push(point);
  }
  return kept;
}

/**
 * The cumulative-R sparkline, or `null` when there is no history to draw.
 *
 * A single Trade produces a single vertex, which is a dot rather than a
 * history — it draws nothing rather than a fabricated flat line, exactly as a
 * zero-population ring draws nothing rather than an empty frame.
 *
 * ZERO IS ALWAYS INSIDE THE VERTICAL DOMAIN. Scaling to the series' own
 * extremes alone would fit a curve that never left profit to the same box as
 * one that never left loss, and the reader would have no way to tell which
 * they were looking at. Anchoring the domain to include zero costs nothing and
 * makes above-water and below-water legible without an axis.
 */
function cumulativeRIndicator(
  metric: DashboardPageData['trader']['equityCurve'],
): BasicKpiIndicator | null {
  if (metric.status !== 'available') return null;
  const parsed: Decimal[] = [];
  for (const point of metric.value) {
    const value = toDecimal(point.cumulativeR);
    if (value === null) return null;
    parsed.push(value);
  }
  if (parsed.length < 2) return null;

  const series = thin(parsed);
  const last = series.length - 1;
  const ending = series[last];
  if (ending === undefined) return null;
  const minimum = Decimal.min(...series, 0);
  const maximum = Decimal.max(...series, 0);
  const span = maximum.minus(minimum);
  const points = series.map((value, index) => ({
    x: new Decimal(index).dividedBy(last).times(100).toDecimalPlaces(2).toNumber(),
    // A zero span means every cumulative total (and zero) coincided: one flat
    // line through the middle, which is what actually happened.
    y: span.isZero()
      ? 50
      : new Decimal(100)
          .minus(value.minus(minimum).dividedBy(span).times(100))
          .toDecimalPlaces(2)
          .toNumber(),
  }));

  return {
    kind: 'cumulativeR',
    tone: ending.greaterThan(0) ? 'positive' : ending.lessThan(0) ? 'negative' : 'neutral',
    points,
  };
}

/**
 * The Trade-outcome ring and the breakdown behind it, or neither.
 *
 * The three counts come from `tradeWin`'s own composition, which
 * `composePerformanceAxis` produced by classifying each eligible closed
 * Trade's stored outcome — never re-derived from the rate above it.
 */
function outcomeIndicator(
  counts: { readonly wins: number; readonly breakEvens: number; readonly losses: number } | null,
): { readonly indicator: BasicKpiIndicator; readonly detail: BasicKpiDetail } {
  if (counts === null) return { indicator: NO_INDICATOR, detail: NO_DETAIL };
  const detail: BasicKpiDetail = { kind: 'outcome', ...counts };
  // A zero population draws nothing rather than an empty frame; the detail
  // still exists, because "0 wins, 0 break-even, 0 losses" is answerable.
  if (counts.wins + counts.breakEvens + counts.losses <= 0) {
    return { indicator: NO_INDICATOR, detail };
  }
  return { indicator: { kind: 'outcomeSplit', ...counts }, detail };
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
  const trader = data.trader;

  const netPnlValue: BasicKpiValue = populationEmpty
    ? EMPTY
    : basic.netPnl.status === 'empty'
      ? EMPTY
      : basic.netPnl.status === 'unavailable'
        ? { status: 'unavailable', reason: basic.netPnl.reason }
        : formatNetPnl(basic.netPnl.currency, basic.netPnl.totalMinor);

  /*
    An unavailable money total is still worth a coverage line — arguably more
    so than an available one. `incomplete` is the only unavailable reason
    this applies to: `mixed_currency` and `unsupported_currency_scale` are
    not about missing results, and the card's own wording already names them.
  */
  const missingMoneyCount = data.coverage.traderTradeCount - data.coverage.monetaryResultCount;
  const netPnlContext: BasicKpiContext =
    netPnlValue.status === 'available' && basic.netPnl.status === 'available'
      ? { kind: 'tradeCount', tradeCount: data.coverage.monetaryResultCount }
      : netPnlValue.status === 'unavailable' &&
          netPnlValue.reason === 'incomplete' &&
          missingMoneyCount > 0
        ? {
            kind: 'missingMoney',
            missing: missingMoneyCount,
            total: data.coverage.traderTradeCount,
          }
        : NO_CONTEXT;

  const tradeWin = outcomeIndicator(
    populationEmpty
      ? null
      : {
          wins: basic.tradeWin.wins,
          breakEvens: basic.tradeWin.breakEvens,
          losses: basic.tradeWin.losses,
        },
  );

  // No planned Trade is not a metric failure over the population — it is the
  // PLAN side never having been filled in. See `BasicKpiUnavailableReason`.
  const plannedRrAvailable = !populationEmpty && basic.plannedRr.tradeCount > 0;
  const plannedRrFactor = plannedRrAvailable ? formatted(basic.plannedRr.average, 'factor') : null;
  const plannedRrValue: BasicKpiValue = populationEmpty
    ? EMPTY
    : basic.plannedRr.tradeCount === 0
      ? { status: 'unavailable', reason: 'no_planned_rr' }
      : plannedRrFactor === null
        ? neutral(basic.plannedRr.average, 'factor')
        : { status: 'available', text: formatPlannedRatio(plannedRrFactor), tone: 'neutral' };

  const riskShare = plannedRrAvailable ? riskSharePercent(basic.plannedRr.average) : null;
  const deflection = populationEmpty ? null : divergingBar(trader.averageR);
  const cumulative = populationEmpty ? null : cumulativeRIndicator(trader.equityCurve);

  const models: Record<
    BasicKpiKey,
    Pick<BasicKpiModel, 'value' | 'emphasis' | 'context' | 'indicator' | 'detail'>
  > = {
    netPnl: {
      value: netPnlValue,
      // The row's lead figure: it is the one number a trader looks for first,
      // and the one that answers the question in the account's own currency.
      emphasis: 'lead',
      context: netPnlContext,
      indicator: NO_INDICATOR,
      detail: NO_DETAIL,
    },
    totalR: {
      // The ACTUAL, realized Trader total — `lib/calc`'s `totalR` over
      // Population A, the same figure the System vs Trader card labels "Actual
      // Total R". Never the System axis and never the paired subset.
      value: populationEmpty ? EMPTY : signed(trader.totalR, 'r'),
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator: cumulative ?? NO_INDICATOR,
      detail: NO_DETAIL,
    },
    tradeWin: {
      value: populationEmpty ? EMPTY : neutral(basic.tradeWin.rate, 'percent'),
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator: tradeWin.indicator,
      detail: tradeWin.detail,
    },
    avgPlannedRr: {
      value: plannedRrValue,
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator:
        riskShare === null
          ? NO_INDICATOR
          : { kind: 'riskRewardSplit', riskSharePercent: riskShare },
      detail:
        plannedRrFactor === null
          ? NO_DETAIL
          : {
              kind: 'plannedRatio',
              factor: plannedRrFactor,
              tradeCount: basic.plannedRr.tradeCount,
            },
    },
    avgRPerTrade: {
      // `averageR` over the SAME Population A as Total R, so the two cards are
      // one figure and its per-Trade reading — never a separately filtered
      // mean, and never a planned or System average.
      value: populationEmpty ? EMPTY : signed(trader.averageR, 'r'),
      emphasis: 'standard',
      context: NO_CONTEXT,
      indicator: deflection === null ? NO_INDICATOR : { kind: 'divergingBar', ...deflection },
      detail: NO_DETAIL,
    },
  };

  return BASIC_KPI_KEYS.map((key) => ({
    widgetId: WIDGET_ID[key],
    key,
    layout: dashboardLayoutItem(WIDGET_ID[key]),
    ...models[key],
  })).sort((a, b) => a.layout.order - b.layout.order);
}
