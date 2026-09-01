import Decimal from 'decimal.js';

import { parseAnalyticsFilters, type AnalyticsDatePreset } from './filters';
import type { AnalyticsMetric, AnalyticsUnavailableReason } from './metrics';

const DisplayDecimal = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

function parseDisplayDecimal(value: string): InstanceType<typeof DisplayDecimal> | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  try {
    const decimal = new DisplayDecimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function signedFixed(decimal: InstanceType<typeof DisplayDecimal>): string {
  const rounded = decimal.toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP);
  const prefix = rounded.greaterThan(0) ? '+' : '';
  return `${prefix}${rounded.toFixed(2)}`;
}

export type AnalyticsDisplayStyle =
  'r' | 'percent' | 'percentage-points' | 'factor' | 'multiple' | 'magnitude';
export type AnalyticsDisplayTone = 'positive' | 'negative' | 'neutral';

export type FormattedAnalyticsMetric =
  | {
      readonly status: 'available';
      readonly text: string;
      readonly tone: AnalyticsDisplayTone;
    }
  | { readonly status: 'unavailable'; readonly reason: AnalyticsUnavailableReason }
  | { readonly status: 'error'; readonly reason: 'data_integrity_error' };

/** Presentation-only formatting; every input is already a canonical metric. */
export function formatAnalyticsMetric(
  metric: AnalyticsMetric,
  style: AnalyticsDisplayStyle,
): FormattedAnalyticsMetric {
  if (metric.status !== 'available') return metric;
  const decimal = parseDisplayDecimal(metric.value);
  if (decimal === null) return { status: 'error', reason: 'data_integrity_error' };

  const tone: AnalyticsDisplayTone = decimal.greaterThan(0)
    ? 'positive'
    : decimal.lessThan(0)
      ? 'negative'
      : 'neutral';
  if (style === 'r') {
    return { status: 'available', text: `${signedFixed(decimal)}R`, tone };
  }
  if (style === 'percent') {
    return {
      status: 'available',
      text: `${decimal.times(100).toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP).toFixed(2)}%`,
      tone,
    };
  }
  if (style === 'percentage-points') {
    // The DIFFERENCE of two rates, which is not itself a rate. 43.75% minus
    // 40.63% is 3.12 percentage points, not 3.12% — the second would invite
    // reading it as a relative change (3.12% OF 43.75%, which is 1.37pp) and
    // the two are routinely confused. Signed, because the direction is the
    // whole content of a difference.
    return {
      status: 'available',
      text: `${decimal
        .times(100)
        .toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP)
        .toFixed(2)} pp`.replace(/^(?!-)/, '+'),
      tone,
    };
  }
  if (style === 'magnitude') {
    // For a metric that is already an unsigned distance rather than a signed
    // outcome — Maximum Drawdown is the case that matters. `r` would render
    // a 2R drawdown as `+2.00R`, which reads as a gain, and would tone it
    // positive. A magnitude has no direction, so it carries neither.
    return {
      status: 'available',
      text: `${decimal.toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP).toFixed(2)}R`,
      tone: 'neutral',
    };
  }
  if (style === 'multiple') {
    // `2.36x` — the payoff-ratio reading of an already-canonical ratio. The
    // same number as `factor`, marked as a multiple so Avg Win/Loss is never
    // misread as an R value or a percentage.
    return {
      status: 'available',
      text: `${decimal.toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP).toFixed(2)}x`,
      tone,
    };
  }
  return {
    status: 'available',
    text: decimal.toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP).toFixed(2),
    tone,
  };
}

/**
 * Compatibility adapter for the legacy range-only Dashboard service. Invalid
 * strings, arrays, and `custom` without its required dates fall back to 90D.
 * The live Dashboard route uses the full Dashboard parser instead.
 */
export function resolveDashboardDatePreset(value: unknown): AnalyticsDatePreset {
  const candidate = value === undefined ? {} : { datePreset: value };
  const parsed = parseAnalyticsFilters(candidate);
  return parsed.ok ? parsed.filters.datePreset : '90d';
}
