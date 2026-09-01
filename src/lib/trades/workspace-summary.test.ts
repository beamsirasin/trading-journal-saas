import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import type { NetPnlAvailability } from '@/lib/calc/net-pnl';
import type { DashboardPageData } from '@/lib/dashboard/page-data';

import {
  composeTradesSummary,
  TRADES_SUMMARY_KEYS,
  type TradesSummaryKey,
  type TradesSummaryValue,
} from './workspace-summary';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

interface Overrides {
  readonly traderEmpty?: boolean;
  readonly netPnl?: NetPnlAvailability;
  readonly totalR?: AnalyticsMetric;
  readonly winRate?: AnalyticsMetric;
  readonly traderTradeCount?: number;
}

/**
 * The same `as unknown as DashboardPageData` shape the Basic KPI row's own
 * tests use: this module reads four fields off the canonical payload and
 * building the whole thing would test the Dashboard service, not this.
 */
function data(overrides: Overrides = {}): DashboardPageData {
  return {
    availability: {
      trader: overrides.traderEmpty === true ? 'empty' : 'available',
      system: 'available',
      comparison: 'available',
    },
    coverage: {
      traderTradeCount: overrides.traderTradeCount ?? 66,
      systemTradeCount: 66,
      pairedTradeCount: 60,
      monetaryResultCount: 66,
    },
    basic: {
      netPnl: overrides.netPnl ?? { status: 'available', currency: 'USD', totalMinor: '231000' },
      tradeWin: {
        rate: overrides.winRate ?? available('0.4091'),
        tradeCount: 66,
        wins: 27,
        breakEvens: 5,
        losses: 34,
      },
    },
    trader: { totalR: overrides.totalR ?? available('23.1000') },
  } as unknown as DashboardPageData;
}

function value(
  model: readonly { key: TradesSummaryKey; value: TradesSummaryValue }[],
  key: TradesSummaryKey,
) {
  const found = model.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`missing ${key}`);
  return found.value;
}

function text(
  model: readonly { key: TradesSummaryKey; value: TradesSummaryValue }[],
  key: TradesSummaryKey,
) {
  const found = value(model, key);
  if (found.status !== 'available') throw new Error(`${key} is ${found.status}`);
  return found.text;
}

describe('composeTradesSummary — four figures, not five', () => {
  it('publishes exactly Trades, Net P&L, Total R and Win Rate, in that order', () => {
    expect([...TRADES_SUMMARY_KEYS]).toEqual(['tradeCount', 'netPnl', 'totalR', 'winRate']);
    expect(composeTradesSummary(data()).map((model) => model.key)).toEqual([
      ...TRADES_SUMMARY_KEYS,
    ]);
  });

  it('is not a second Dashboard: no Avg Planned RR and no Avg R per Trade', () => {
    const keys = composeTradesSummary(data()).map((model) => model.key) as string[];
    expect(keys).not.toContain('avgPlannedRr');
    expect(keys).not.toContain('avgRPerTrade');
  });
});

describe('composeTradesSummary — the canonical figures, formatted and nothing more', () => {
  it('counts the eligible Trader population', () => {
    expect(text(composeTradesSummary(data({ traderTradeCount: 66 })), 'tradeCount')).toBe('66');
  });

  it('formats Net P&L in the account currency, signed', () => {
    expect(text(composeTradesSummary(data()), 'netPnl')).toBe('+$2,310.00');
  });

  it('formats the ACTUAL Trader Total R, signed', () => {
    expect(text(composeTradesSummary(data()), 'totalR')).toBe('+23.10R');
  });

  it('formats the canonical trade win rate as a percentage', () => {
    expect(text(composeTradesSummary(data()), 'winRate')).toBe('40.91%');
  });

  it('carries the sign of a losing period into the tone', () => {
    const models = composeTradesSummary(
      data({
        netPnl: { status: 'available', currency: 'USD', totalMinor: '-45000' },
        totalR: available('-4.5000'),
      }),
    );
    expect(value(models, 'netPnl')).toMatchObject({ tone: 'negative', text: '-$450.00' });
    expect(value(models, 'totalR')).toMatchObject({ tone: 'negative', text: '-4.50R' });
  });

  it('keeps Win Rate neutral, because a win rate is not a verdict', () => {
    expect(value(composeTradesSummary(data()), 'winRate')).toMatchObject({ tone: 'neutral' });
  });
});

describe('composeTradesSummary — never a fake zero', () => {
  it('reports an empty population as empty on every figure except the count', () => {
    const models = composeTradesSummary(data({ traderEmpty: true, traderTradeCount: 0 }));
    expect(value(models, 'netPnl').status).toBe('empty');
    expect(value(models, 'totalR').status).toBe('empty');
    expect(value(models, 'winRate').status).toBe('empty');
    // A count of nothing is a truthful zero, not an undefined metric.
    expect(value(models, 'tradeCount')).toMatchObject({ status: 'available', text: '0' });
  });

  it('passes a monetary availability reason through rather than printing a total', () => {
    const models = composeTradesSummary(
      data({ netPnl: { status: 'unavailable', reason: 'mixed_currency' } }),
    );
    expect(value(models, 'netPnl')).toEqual({ status: 'unavailable', reason: 'mixed_currency' });
    // The other figures are unaffected: R is currency-free by construction.
    expect(value(models, 'totalR').status).toBe('available');
  });

  it('reports a canonical metric failure as its own reason, never as zero', () => {
    const models = composeTradesSummary(
      data({ winRate: { status: 'unavailable', reason: 'no_trades' } }),
    );
    expect(value(models, 'winRate')).toEqual({ status: 'unavailable', reason: 'no_trades' });
  });

  it('reports corrupt stored data as an error rather than rendering it', () => {
    const models = composeTradesSummary(data({ totalR: available('not-a-number') }));
    expect(value(models, 'totalR').status).toBe('error');
  });
});
