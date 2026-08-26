import {
  formatAnalyticsMetric,
  type AnalyticsDisplayStyle,
  type AnalyticsDisplayTone,
} from '@/lib/analytics/presentation';

/**
 * The one display shape every Dashboard widget's pure presentation model
 * produces, and the one set of states its components render.
 *
 * `R` is the widget's own unavailable-reason vocabulary: the Basic KPI row
 * adds D1's three monetary-availability reasons to the canonical analytics
 * ones, while the performance cards use the canonical set alone.
 *
 * `empty` is deliberately distinct from `unavailable`. "No eligible Trades in
 * this filter" is one fact about the population; "no losing Trades, so Profit
 * Factor is undefined" is a fact about a single metric over a population that
 * does exist. Collapsing them would make both less truthful.
 */
export type MetricDisplayValue<R extends string> =
  | { readonly status: 'available'; readonly text: string; readonly tone: AnalyticsDisplayTone }
  | { readonly status: 'empty' }
  | { readonly status: 'unavailable'; readonly reason: R }
  | { readonly status: 'error' };

type Metric = Parameters<typeof formatAnalyticsMetric>[0];

/**
 * Formats a canonical metric and keeps whatever tone its sign implies.
 *
 * Reserved for genuinely signed outcome data — a Total R, a Net P&L. Note
 * that the `magnitude` style returns a neutral tone of its own accord, since
 * an unsigned distance has no direction to colour.
 */
export function signedMetric<R extends string>(
  metric: Metric,
  style: AnalyticsDisplayStyle,
): MetricDisplayValue<R> {
  const formatted = formatAnalyticsMetric(metric, style);
  if (formatted.status === 'error') return { status: 'error' };
  if (formatted.status === 'unavailable') {
    return { status: 'unavailable', reason: formatted.reason as R };
  }
  return { status: 'available', text: formatted.text, tone: formatted.tone };
}

/**
 * Formats a canonical metric and forces a neutral tone.
 *
 * A high Win Rate is not inherently good and a low one is not inherently bad
 * (CLAUDE.md §1), and a Profit Factor is not a verdict either. Supporting
 * analytics stay neutral so colour keeps meaning only where the number is a
 * real signed outcome.
 */
export function neutralMetric<R extends string>(
  metric: Metric,
  style: AnalyticsDisplayStyle,
): MetricDisplayValue<R> {
  const formatted = signedMetric<R>(metric, style);
  return formatted.status === 'available' ? { ...formatted, tone: 'neutral' } : formatted;
}

/** A plain already-formatted figure, such as a Trade count. */
export function plainValue<R extends string>(text: string): MetricDisplayValue<R> {
  return { status: 'available', text, tone: 'neutral' };
}
