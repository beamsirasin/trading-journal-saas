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

export type AnalyticsDisplayStyle = 'r' | 'percent' | 'factor';
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
  return {
    status: 'available',
    text: decimal.toDecimalPlaces(2, DisplayDecimal.ROUND_HALF_UP).toFixed(2),
    tone,
  };
}

/**
 * The Dashboard accepts one public query value only. Invalid strings and
 * arrays are rejected by the strict 09B contract, then safely fall back to
 * that same contract's default 90D scope.
 */
export function resolveDashboardDatePreset(value: unknown): AnalyticsDatePreset {
  const candidate = value === undefined ? {} : { datePreset: value };
  const parsed = parseAnalyticsFilters(candidate);
  return parsed.ok ? parsed.filters.datePreset : '90d';
}
