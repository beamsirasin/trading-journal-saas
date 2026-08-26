import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import type { NetPnlAvailability } from '@/lib/calc/net-pnl';

import { composeBasicKpis, type BasicKpiKey, type BasicKpiModel } from './basic-kpi';
import type { DashboardPageData, DashboardPerformanceData } from './page-data';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

const AXIS: DashboardPerformanceData = {
  sampleCount: 31,
  outcomeCounts: { wins: 17, breakEvens: 3, losses: 11 },
  totalR: available('9.0000'),
  winRate: available('0.5484'),
  averageR: available('0.2903'),
  expectancyR: available('0.2903'),
  profitFactor: available('3.6400'),
  maximumDrawdownR: available('2.0000'),
};

interface BasicOverrides {
  readonly netPnl?: NetPnlAvailability;
  readonly tradeWin?: Partial<DashboardPageData['basic']['tradeWin']>;
  readonly profitFactor?: AnalyticsMetric;
  readonly dayWinRate?: DashboardPageData['basic']['dayWinRate'];
  readonly averageWinLoss?: Partial<DashboardPageData['basic']['averageWinLoss']>;
}

function page(
  overrides: BasicOverrides = {},
  population: { readonly traderEmpty?: boolean; readonly monetaryResultCount?: number } = {},
): DashboardPageData {
  return {
    availability: {
      trader: population.traderEmpty === true ? 'empty' : 'available',
      system: 'available',
      comparison: 'available',
    },
    coverage: {
      traderTradeCount: 31,
      systemTradeCount: 31,
      pairedTradeCount: 31,
      monetaryResultCount: population.monetaryResultCount ?? 31,
    },
    basic: {
      netPnl: overrides.netPnl ?? { status: 'available', currency: 'USD', totalMinor: '124350' },
      tradeWin: {
        rate: available('0.5484'),
        tradeCount: 31,
        wins: 17,
        breakEvens: 3,
        losses: 11,
        ...overrides.tradeWin,
      },
      profitFactor: overrides.profitFactor ?? available('3.6400'),
      dayWinRate: overrides.dayWinRate ?? {
        status: 'available',
        value: {
          eligibleDayCount: 12,
          winningDayCount: 7,
          breakEvenDayCount: 1,
          losingDayCount: 4,
          rate: '0.5833',
        },
      },
      averageWinLoss: {
        averageWinR: available('2.1200'),
        averageLossR: available('-0.9000'),
        payoffRatio: available('2.3556'),
        ...overrides.averageWinLoss,
      },
    },
    // Unused by `composeBasicKpis`, present only to satisfy the D2 DTO shape.
    system: AXIS,
    trader: AXIS,
  } as unknown as DashboardPageData;
}

function card(models: readonly BasicKpiModel[], key: BasicKpiKey) {
  const model = models.find((candidate) => candidate.key === key);
  if (model === undefined) throw new Error(`missing Basic KPI ${key}`);
  return model;
}

describe('composeBasicKpis', () => {
  it('emits the five Basic widgets once each, in default-layout order', () => {
    const models = composeBasicKpis(page());
    expect(models.map((model) => model.widgetId)).toEqual([
      'basic.net-pnl',
      'basic.trade-win-rate',
      'basic.profit-factor',
      'basic.day-win-rate',
      'basic.avg-win-loss',
    ]);
    expect(models.map((model) => model.layout.order)).toEqual([10, 20, 30, 40, 50]);
    expect(new Set(models.map((model) => model.widgetId)).size).toBe(5);
  });

  describe('Net P&L', () => {
    it('formats a positive total with a leading gain sign and positive tone', () => {
      const value = card(composeBasicKpis(page()), 'netPnl').value;
      expect(value).toEqual({ status: 'available', text: '+$1,243.50', tone: 'positive' });
    });

    it('formats a negative total with a leading minus and negative tone', () => {
      const models = composeBasicKpis(
        page({ netPnl: { status: 'available', currency: 'USD', totalMinor: '-124350' } }),
      );
      expect(card(models, 'netPnl').value).toEqual({
        status: 'available',
        text: '-$1,243.50',
        tone: 'negative',
      });
    });

    it('keeps an exactly zero total unsigned and neutral', () => {
      const models = composeBasicKpis(
        page({ netPnl: { status: 'available', currency: 'USD', totalMinor: '0' } }),
      );
      expect(card(models, 'netPnl').value).toEqual({
        status: 'available',
        text: '$0.00',
        tone: 'neutral',
      });
    });

    it('honours a zero-decimal currency scale rather than assuming cents', () => {
      const models = composeBasicKpis(
        page({ netPnl: { status: 'available', currency: 'JPY', totalMinor: '124350' } }),
      );
      expect(card(models, 'netPnl').value).toMatchObject({ text: '+¥124,350' });
    });

    it.each(['incomplete', 'mixed_currency', 'unsupported_currency_scale'] as const)(
      'reports %s truthfully and shows no partial total',
      (reason) => {
        const models = composeBasicKpis(page({ netPnl: { status: 'unavailable', reason } }));
        const model = card(models, 'netPnl');
        expect(model.value).toEqual({ status: 'unavailable', reason });
        // No monetary text, and no currency context that would imply a total.
        expect(model.value).not.toHaveProperty('text');
        expect(model.context).toEqual({ kind: 'none' });
      },
    );

    it('reports an empty population as empty rather than unavailable', () => {
      const models = composeBasicKpis(page({ netPnl: { status: 'empty' } }, { traderEmpty: true }));
      expect(card(models, 'netPnl').value).toEqual({ status: 'empty' });
    });

    it('names the authoritative currency and monetary coverage as context', () => {
      const models = composeBasicKpis(page({}, { monetaryResultCount: 29 }));
      expect(card(models, 'netPnl').context).toEqual({
        kind: 'currency',
        currency: 'USD',
        tradeCount: 29,
      });
    });
  });

  describe('Trade Win %', () => {
    it('presents the supplied canonical rate neutrally with its composition', () => {
      const models = composeBasicKpis(page());
      expect(card(models, 'tradeWin').value).toEqual({
        status: 'available',
        text: '54.84%',
        tone: 'neutral',
      });
      expect(card(models, 'tradeWin').context).toEqual({
        kind: 'composition',
        unit: 'trades',
        wins: 17,
        breakEvens: 3,
        losses: 11,
      });
    });

    it('reflects the break-even Trades D2 already counted in the denominator', () => {
      // 17 / (17 + 3 + 11) = 0.5484 — the counts shown must be the same
      // population the supplied rate was computed over.
      const context = card(composeBasicKpis(page()), 'tradeWin').context;
      if (context.kind !== 'composition') throw new Error('expected composition context');
      expect(context.wins + context.breakEvens + context.losses).toBe(31);
    });

    it('is empty when there is no eligible Trader population', () => {
      const models = composeBasicKpis(page({}, { traderEmpty: true }));
      expect(card(models, 'tradeWin').value).toEqual({ status: 'empty' });
      expect(card(models, 'tradeWin').context).toEqual({ kind: 'none' });
    });
  });

  describe('Profit Factor', () => {
    it('presents the canonical R-based factor neutrally', () => {
      const models = composeBasicKpis(page());
      expect(card(models, 'profitFactor').value).toEqual({
        status: 'available',
        text: '3.64',
        tone: 'neutral',
      });
      expect(card(models, 'profitFactor').context).toEqual({
        kind: 'note',
        note: 'calculatedFromR',
      });
    });

    it('never renders Infinity or a fallback number when there are no losses', () => {
      const models = composeBasicKpis(
        page({ profitFactor: { status: 'unavailable', reason: 'no_losses' } }),
      );
      const value = card(models, 'profitFactor').value;
      expect(value).toEqual({ status: 'unavailable', reason: 'no_losses' });
      expect(JSON.stringify(value)).not.toMatch(/Infinity|null|NaN/);
    });
  });

  describe('Day Win %', () => {
    it('presents the local-day rate neutrally with day counts as context', () => {
      const models = composeBasicKpis(page());
      expect(card(models, 'dayWin').value).toEqual({
        status: 'available',
        text: '58.33%',
        tone: 'neutral',
      });
      expect(card(models, 'dayWin').context).toEqual({
        kind: 'composition',
        unit: 'days',
        wins: 7,
        breakEvens: 1,
        losses: 4,
      });
    });

    it('surfaces no eligible trading days without inventing a rate', () => {
      const models = composeBasicKpis(
        page({ dayWinRate: { status: 'unavailable', reason: 'no_trading_days' } }),
      );
      expect(card(models, 'dayWin').value).toEqual({
        status: 'unavailable',
        reason: 'no_trading_days',
      });
      expect(card(models, 'dayWin').context).toEqual({ kind: 'none' });
    });

    it('is empty when there is no eligible Trader population', () => {
      const models = composeBasicKpis(page({}, { traderEmpty: true }));
      expect(card(models, 'dayWin').value).toEqual({ status: 'empty' });
    });
  });

  describe('Avg Win/Loss Trade', () => {
    it('presents the payoff ratio as a multiple with both averages as context', () => {
      const models = composeBasicKpis(page());
      expect(card(models, 'avgWinLoss').value).toEqual({
        status: 'available',
        text: '2.36x',
        tone: 'neutral',
      });
      expect(card(models, 'avgWinLoss').context).toEqual({
        kind: 'averages',
        averageWinR: '+2.12R',
        averageLossR: '-0.90R',
      });
    });

    it('is explicitly unavailable with no winners', () => {
      const models = composeBasicKpis(
        page({
          averageWinLoss: {
            averageWinR: { status: 'unavailable', reason: 'no_wins' },
            payoffRatio: { status: 'unavailable', reason: 'no_wins' },
          },
        }),
      );
      expect(card(models, 'avgWinLoss').value).toEqual({
        status: 'unavailable',
        reason: 'no_wins',
      });
      expect(card(models, 'avgWinLoss').context).toEqual({ kind: 'none' });
    });

    it('is explicitly unavailable with no losers', () => {
      const models = composeBasicKpis(
        page({
          averageWinLoss: {
            averageLossR: { status: 'unavailable', reason: 'no_losses' },
            payoffRatio: { status: 'unavailable', reason: 'no_losses' },
          },
        }),
      );
      expect(card(models, 'avgWinLoss').value).toEqual({
        status: 'unavailable',
        reason: 'no_losses',
      });
      expect(card(models, 'avgWinLoss').context).toEqual({ kind: 'none' });
    });
  });

  it('keeps every non-monetary headline neutral regardless of how strong it is', () => {
    const models = composeBasicKpis(
      page({
        tradeWin: { rate: available('0.9800') },
        profitFactor: available('12.0000'),
        averageWinLoss: { payoffRatio: available('9.0000') },
      }),
    );
    for (const key of ['tradeWin', 'profitFactor', 'dayWin', 'avgWinLoss'] as const) {
      expect(card(models, key).value).toMatchObject({ tone: 'neutral' });
    }
  });

  it('reports every card as empty — never as an error — for an empty population', () => {
    const models = composeBasicKpis(page({ netPnl: { status: 'empty' } }, { traderEmpty: true }));
    expect(models.map((model) => model.value.status)).toEqual(Array(5).fill('empty'));
    expect(models.map((model) => model.context.kind)).toEqual(Array(5).fill('none'));
  });
});
