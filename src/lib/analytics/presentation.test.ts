import { describe, expect, it } from 'vitest';

import { formatAnalyticsMetric, resolveDashboardDatePreset } from './presentation';

describe('Dashboard analytics presentation formatting', () => {
  it.each([
    ['18.4000', '+18.40R', 'positive'],
    ['-3.1000', '-3.10R', 'negative'],
    ['0.0000', '0.00R', 'neutral'],
  ] as const)('formats R value %s as %s', (value, text, tone) => {
    expect(formatAnalyticsMetric({ status: 'available', value }, 'r')).toEqual({
      status: 'available',
      text,
      tone,
    });
  });

  it.each([
    ['0.4100', '41.00%', 'positive'],
    ['0.6400', '64.00%', 'positive'],
    ['1.2500', '125.00%', 'positive'],
    ['-0.2000', '-20.00%', 'negative'],
  ] as const)('formats unclamped ratio %s as %s', (value, text, tone) => {
    expect(formatAnalyticsMetric({ status: 'available', value }, 'percent')).toEqual({
      status: 'available',
      text,
      tone,
    });
  });

  it('formats Profit Factor without inventing Infinity', () => {
    expect(formatAnalyticsMetric({ status: 'available', value: '1.8200' }, 'factor')).toEqual({
      status: 'available',
      text: '1.82',
      tone: 'positive',
    });
    expect(formatAnalyticsMetric({ status: 'unavailable', reason: 'no_losses' }, 'factor')).toEqual(
      { status: 'unavailable', reason: 'no_losses' },
    );
  });

  it('preserves unavailable and sanitized integrity states instead of displaying zero', () => {
    expect(formatAnalyticsMetric({ status: 'unavailable', reason: 'no_trades' }, 'r')).toEqual({
      status: 'unavailable',
      reason: 'no_trades',
    });
    expect(
      formatAnalyticsMetric({ status: 'error', reason: 'data_integrity_error' }, 'percent'),
    ).toEqual({ status: 'error', reason: 'data_integrity_error' });
  });

  it('treats malformed available values as sanitized integrity errors', () => {
    expect(formatAnalyticsMetric({ status: 'available', value: 'NaN' }, 'r')).toEqual({
      status: 'error',
      reason: 'data_integrity_error',
    });
  });
});

describe('Dashboard date preset normalization', () => {
  it.each(['30d', '90d', 'all'] as const)('accepts %s through the strict contract', (range) => {
    expect(resolveDashboardDatePreset(range)).toBe(range);
  });

  it.each([undefined, '7d', 'ytd', ['30d'], { datePreset: 'all' }])(
    'falls invalid public value %j back to 90d',
    (range) => {
      expect(resolveDashboardDatePreset(range)).toBe('90d');
    },
  );
});
