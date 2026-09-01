import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import type { NetPnlAvailability } from '@/lib/calc/net-pnl';

import { composeBasicKpis, type BasicKpiKey, type BasicKpiModel } from './basic-kpi';
import type { DashboardPageData, DashboardPerformanceData } from './page-data';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

const equity = (...cumulative: readonly string[]): DashboardPerformanceData['equityCurve'] => ({
  status: 'available',
  value: cumulative.map((cumulativeR, index) => ({
    tradeId: `trade-${index}`,
    occurredAt: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    cumulativeR,
  })),
});

const AXIS: DashboardPerformanceData = {
  sampleCount: 31,
  outcomeCounts: { wins: 17, breakEvens: 3, losses: 11 },
  totalR: available('9.0000'),
  winRate: available('0.5484'),
  averageR: available('0.2903'),
  expectancyR: available('0.2903'),
  profitFactor: available('3.6400'),
  maximumDrawdownR: available('2.0000'),
  payoffRatio: available('2.4000'),
  equityCurve: equity('1.0000', '-0.5000', '4.0000', '9.0000'),
};

interface BasicOverrides {
  readonly netPnl?: NetPnlAvailability;
  readonly tradeWin?: Partial<DashboardPageData['basic']['tradeWin']>;
  readonly plannedRr?: Partial<DashboardPageData['basic']['plannedRr']>;
}

function page(
  overrides: BasicOverrides = {},
  population: {
    readonly traderEmpty?: boolean;
    readonly monetaryResultCount?: number;
    readonly trader?: Partial<DashboardPerformanceData>;
  } = {},
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
      plannedRr: { average: available('3.2000'), tradeCount: 28, ...overrides.plannedRr },
      // Still composed, no longer carded — see `DashboardPageData['basic']`.
      profitFactor: available('3.6400'),
      dayWinRate: {
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
      },
    },
    system: AXIS,
    trader: { ...AXIS, ...population.trader },
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
      'basic.total-r',
      'basic.trade-win-rate',
      'basic.avg-planned-rr',
      'basic.avg-r-per-trade',
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

    it('reports an empty population as empty rather than unavailable', () => {
      const models = composeBasicKpis(page({ netPnl: { status: 'empty' } }, { traderEmpty: true }));
      expect(card(models, 'netPnl').value).toEqual({ status: 'empty' });
    });

    it('keeps the monetary coverage count as its one visible supporting line', () => {
      const models = composeBasicKpis(page({}, { monetaryResultCount: 27 }));
      expect(card(models, 'netPnl').context).toEqual({ kind: 'tradeCount', tradeCount: 27 });
    });

    it('draws no indicator, because no Population A money series is published', () => {
      const models = composeBasicKpis(page());
      expect(card(models, 'netPnl').indicator).toEqual({ kind: 'none' });
      expect(card(models, 'netPnl').emphasis).toBe('lead');
    });
  });

  describe('Total R', () => {
    /*
      THE ACTUAL AXIS, NOT THE SYSTEM ONE AND NOT THE PAIRED SUBSET. The
      fixture's Trader axis totals +9R while its System axis and every paired
      figure are free to differ; this card must follow `trader.totalR` and
      nothing else, which is what makes it the same number the System vs
      Trader card labels "Actual Total R".
    */
    it('reads the Trader axis total and signs it', () => {
      const value = card(composeBasicKpis(page()), 'totalR').value;
      expect(value).toEqual({ status: 'available', text: '+9.00R', tone: 'positive' });
    });

    it('colours a losing total negative and leaves an exactly flat one neutral', () => {
      const losing = composeBasicKpis(page({}, { trader: { totalR: available('-4.5000') } }));
      expect(card(losing, 'totalR').value).toEqual({
        status: 'available',
        text: '-4.50R',
        tone: 'negative',
      });

      const flat = composeBasicKpis(page({}, { trader: { totalR: available('0.0000') } }));
      expect(card(flat, 'totalR').value).toEqual({
        status: 'available',
        text: '0.00R',
        tone: 'neutral',
      });
    });

    it('draws the canonical cumulative-R series, ending where the figure does', () => {
      const indicator = card(composeBasicKpis(page()), 'totalR').indicator;
      expect(indicator).toMatchObject({ kind: 'cumulativeR', tone: 'positive' });
      if (indicator.kind !== 'cumulativeR') throw new Error('expected a sparkline');
      // Four vertices, spread evenly across the box, first to last.
      expect(indicator.points.map((point) => point.x)).toEqual([0, 33.33, 66.67, 100]);
      // The domain spans -0.5R..9R and always includes zero; the lowest value
      // sits at the bottom (y=100) and the highest at the top (y=0).
      expect(indicator.points[1]?.y).toBe(100);
      expect(indicator.points[3]?.y).toBe(0);
    });

    it('takes the sparkline colour from where the series ENDS, not where it went', () => {
      const models = composeBasicKpis(
        page(
          {},
          {
            trader: {
              totalR: available('-2.0000'),
              equityCurve: equity('5.0000', '3.0000', '-2.0000'),
            },
          },
        ),
      );
      expect(card(models, 'totalR').indicator).toMatchObject({
        kind: 'cumulativeR',
        tone: 'negative',
      });
    });

    it('draws nothing rather than a fabricated line for a single-Trade history', () => {
      const models = composeBasicKpis(page({}, { trader: { equityCurve: equity('1.0000') } }));
      expect(card(models, 'totalR').indicator).toEqual({ kind: 'none' });
      // The figure is still there — the drawing is the optional half.
      expect(card(models, 'totalR').value).toMatchObject({ status: 'available' });
    });

    it('keeps a flat series on one middle line rather than dividing by a zero span', () => {
      const models = composeBasicKpis(
        page({}, { trader: { totalR: available('0.0000'), equityCurve: equity('0', '0', '0') } }),
      );
      const indicator = card(models, 'totalR').indicator;
      expect(indicator).toMatchObject({ kind: 'cumulativeR', tone: 'neutral' });
      if (indicator.kind !== 'cumulativeR') throw new Error('expected a sparkline');
      expect(indicator.points.every((point) => point.y === 50)).toBe(true);
    });

    it('thins a long history by dropping vertices, keeping the first and the last', () => {
      const long = Array.from({ length: 400 }, (_, index) => String(index + 1));
      const models = composeBasicKpis(page({}, { trader: { equityCurve: equity(...long) } }));
      const indicator = card(models, 'totalR').indicator;
      if (indicator.kind !== 'cumulativeR') throw new Error('expected a sparkline');
      expect(indicator.points.length).toBeLessThanOrEqual(32);
      expect(indicator.points[0]?.x).toBe(0);
      expect(indicator.points.at(-1)?.x).toBe(100);
      // Every kept vertex is a real cumulative total: the last is the maximum
      // of the series, so it sits at the top of the box.
      expect(indicator.points.at(-1)?.y).toBe(0);
    });

    it('has nothing to reveal, so its indicator stays a picture', () => {
      expect(card(composeBasicKpis(page()), 'totalR').detail).toEqual({ kind: 'none' });
    });
  });

  describe('Win Rate', () => {
    it('presents the supplied canonical rate neutrally with no supporting line', () => {
      const model = card(composeBasicKpis(page()), 'tradeWin');
      expect(model.value).toEqual({ status: 'available', text: '54.84%', tone: 'neutral' });
      expect(model.context).toEqual({ kind: 'none' });
    });

    it('keeps its widget identity, because only the TITLE changed', () => {
      expect(card(composeBasicKpis(page()), 'tradeWin').widgetId).toBe('basic.trade-win-rate');
    });

    it('draws Trade outcomes as a ring and reveals them in words', () => {
      const model = card(composeBasicKpis(page()), 'tradeWin');
      expect(model.indicator).toEqual({
        kind: 'outcomeSplit',
        wins: 17,
        breakEvens: 3,
        losses: 11,
      });
      expect(model.detail).toEqual({ kind: 'outcome', wins: 17, breakEvens: 3, losses: 11 });
    });

    it('reflects the break-even Trades D2 already counted in the denominator', () => {
      const models = composeBasicKpis(
        page({ tradeWin: { wins: 5, breakEvens: 4, losses: 1, rate: available('0.5000') } }),
      );
      expect(models.find((model) => model.key === 'tradeWin')?.indicator).toMatchObject({
        breakEvens: 4,
      });
    });

    it('is empty when there is no eligible Trader population', () => {
      const models = composeBasicKpis(page({}, { traderEmpty: true }));
      expect(card(models, 'tradeWin').value).toEqual({ status: 'empty' });
      expect(card(models, 'tradeWin').indicator).toEqual({ kind: 'none' });
    });
  });

  describe('Avg Planned RR', () => {
    it('spells the plan as a ratio against one unit of risk', () => {
      const value = card(composeBasicKpis(page()), 'avgPlannedRr').value;
      expect(value).toEqual({ status: 'available', text: '1 : 3.20', tone: 'neutral' });
    });

    it('stays neutral however ambitious the plan is — a plan is not a result', () => {
      const models = composeBasicKpis(page({ plannedRr: { average: available('9.0000') } }));
      expect(card(models, 'avgPlannedRr').value).toMatchObject({
        text: '1 : 9.00',
        tone: 'neutral',
      });
    });

    it('splits the bar as 1 / (1 + RR), the published ratio restated', () => {
      // A 1:3 plan is one part risk against three parts reward.
      const models = composeBasicKpis(page({ plannedRr: { average: available('3.0000') } }));
      expect(card(models, 'avgPlannedRr').indicator).toEqual({
        kind: 'riskRewardSplit',
        riskSharePercent: 25,
      });
    });

    it('fills the track with risk for a plan that targeted no reward at all', () => {
      const models = composeBasicKpis(page({ plannedRr: { average: available('0.0000') } }));
      expect(card(models, 'avgPlannedRr').indicator).toEqual({
        kind: 'riskRewardSplit',
        riskSharePercent: 100,
      });
    });

    /*
      THE DENOMINATOR IS THE POINT OF THIS DETAIL. Avg Planned RR is averaged
      over Trades that actually carry a planned target, which can be fewer than
      the Trades every other card in the row counts. That fact has one home,
      and it is here.
    */
    it('reveals the ratio in words together with the population it came from', () => {
      const models = composeBasicKpis(page({}, { monetaryResultCount: 31 }));
      expect(card(models, 'avgPlannedRr').detail).toEqual({
        kind: 'plannedRatio',
        factor: '3.20',
        tradeCount: 28,
      });
    });

    it('says no Trade was planned rather than inventing a 0 : 0 ratio', () => {
      const models = composeBasicKpis(
        page({
          plannedRr: { average: { status: 'unavailable', reason: 'no_trades' }, tradeCount: 0 },
        }),
      );
      const model = card(models, 'avgPlannedRr');
      expect(model.value).toEqual({ status: 'unavailable', reason: 'no_planned_rr' });
      expect(model.indicator).toEqual({ kind: 'none' });
      expect(model.detail).toEqual({ kind: 'none' });
    });

    it('never reports a populated range as having no Trades at all', () => {
      const models = composeBasicKpis(
        page({
          plannedRr: { average: { status: 'unavailable', reason: 'no_trades' }, tradeCount: 0 },
        }),
      );
      expect(card(models, 'avgPlannedRr').value).not.toMatchObject({ reason: 'no_trades' });
      // ...while the four cards beside it keep printing figures from those
      // very Trades.
      expect(card(models, 'totalR').value).toMatchObject({ status: 'available' });
    });

    it('is empty when there is no eligible Trader population', () => {
      const models = composeBasicKpis(page({}, { traderEmpty: true }));
      expect(card(models, 'avgPlannedRr').value).toEqual({ status: 'empty' });
    });
  });

  describe('Avg R / Trade', () => {
    it('reads the canonical mean R of the same population Total R sums', () => {
      const value = card(composeBasicKpis(page()), 'avgRPerTrade').value;
      expect(value).toEqual({ status: 'available', text: '+0.29R', tone: 'positive' });
    });

    it('deflects right from zero for a profitable average', () => {
      const models = composeBasicKpis(page({}, { trader: { averageR: available('0.5000') } }));
      // Half of the ±1R domain is half of the track's half: 25% of the whole.
      expect(card(models, 'avgRPerTrade').indicator).toEqual({
        kind: 'divergingBar',
        direction: 'positive',
        fillPercent: 25,
      });
    });

    it('deflects left for a losing average', () => {
      const models = composeBasicKpis(page({}, { trader: { averageR: available('-0.3000') } }));
      expect(card(models, 'avgRPerTrade').indicator).toEqual({
        kind: 'divergingBar',
        direction: 'negative',
        fillPercent: 15,
      });
    });

    it('shows the zero datum alone at exactly break-even', () => {
      const models = composeBasicKpis(page({}, { trader: { averageR: available('0.0000') } }));
      expect(card(models, 'avgRPerTrade').indicator).toEqual({
        kind: 'divergingBar',
        direction: 'zero',
        fillPercent: 0,
      });
      expect(card(models, 'avgRPerTrade').value).toMatchObject({ text: '0.00R', tone: 'neutral' });
    });

    /*
      A FIXED SCALE MEANS SOME VALUES RUN OFF IT, AND THE FIGURE STAYS TRUE.
      Clamping is a property of the drawing only: `+2.40R` still prints in
      full, and the bar simply reads "off the scale, upward".
    */
    it('clamps the bar outside ±1R while printing the real figure', () => {
      const models = composeBasicKpis(page({}, { trader: { averageR: available('2.4000') } }));
      expect(card(models, 'avgRPerTrade').indicator).toEqual({
        kind: 'divergingBar',
        direction: 'positive',
        fillPercent: 50,
      });
      expect(card(models, 'avgRPerTrade').value).toMatchObject({ text: '+2.40R' });

      const losing = composeBasicKpis(page({}, { trader: { averageR: available('-7.0000') } }));
      expect(card(losing, 'avgRPerTrade').indicator).toMatchObject({ fillPercent: 50 });
      expect(card(losing, 'avgRPerTrade').value).toMatchObject({ text: '-7.00R' });
    });

    it('has nothing to reveal, so its indicator stays a picture', () => {
      expect(card(composeBasicKpis(page()), 'avgRPerTrade').detail).toEqual({ kind: 'none' });
    });
  });

  it('spends sign colour only where the sign IS the finding', () => {
    const models = composeBasicKpis(
      page({
        tradeWin: { rate: available('0.9800') },
        plannedRr: { average: available('12.0000') },
      }),
    );
    // A 98% win rate and a 1:12 plan are levels, not verdicts.
    for (const key of ['tradeWin', 'avgPlannedRr'] as const) {
      expect(card(models, key).value).toMatchObject({ tone: 'neutral' });
    }
    // The three signed outcomes keep their direction.
    for (const key of ['netPnl', 'totalR', 'avgRPerTrade'] as const) {
      expect(card(models, key).value).toMatchObject({ tone: 'positive' });
    }
  });

  it('reports every card as empty — never as an error — for an empty population', () => {
    const models = composeBasicKpis(page({ netPnl: { status: 'empty' } }, { traderEmpty: true }));
    expect(models.map((model) => model.value.status)).toEqual(Array(5).fill('empty'));
    expect(models.map((model) => model.context.kind)).toEqual(Array(5).fill('none'));
    expect(models.map((model) => model.indicator.kind)).toEqual(Array(5).fill('none'));
    expect(models.map((model) => model.detail.kind)).toEqual(Array(5).fill('none'));
  });
});
