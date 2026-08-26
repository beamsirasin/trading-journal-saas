import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';

import type { DashboardPageData, DashboardPerformanceData } from './page-data';
import {
  composePerformanceCards,
  PERFORMANCE_METRIC_KEYS,
  type PerformanceCardModel,
  type PerformanceMetricKey,
} from './performance-card';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable = (reason: 'no_trades' | 'no_losses' | 'no_wins'): AnalyticsMetric => ({
  status: 'unavailable',
  reason,
});

function axis(overrides: Partial<DashboardPerformanceData> = {}): DashboardPerformanceData {
  return {
    sampleCount: 31,
    outcomeCounts: { wins: 17, breakEvens: 3, losses: 11 },
    totalR: available('9.0000'),
    winRate: available('0.5484'),
    averageR: available('0.2903'),
    expectancyR: available('0.2903'),
    profitFactor: available('3.6400'),
    maximumDrawdownR: available('2.0000'),
    ...overrides,
  };
}

const EMPTY_AXIS = axis({
  sampleCount: 0,
  outcomeCounts: { wins: 0, breakEvens: 0, losses: 0 },
  totalR: unavailable('no_trades'),
  winRate: unavailable('no_trades'),
  averageR: unavailable('no_trades'),
  expectancyR: unavailable('no_trades'),
  profitFactor: unavailable('no_trades'),
  maximumDrawdownR: unavailable('no_trades'),
});

function page(
  system: DashboardPerformanceData = axis(),
  trader: DashboardPerformanceData = axis(),
): DashboardPageData {
  return {
    system,
    trader,
    // Present so the DTO shape is realistic. D4 must never read it.
    comparison: {
      comparableCount: 12,
      pairedSystemTotalR: available('30.0000'),
      pairedActualTotalR: available('9.0000'),
      executionGapR: available('-21.0000'),
      averageExecutionGapR: available('-1.7500'),
      systemEdgeCaptured: available('0.3000'),
    },
  } as unknown as DashboardPageData;
}

function cellOf(model: PerformanceCardModel, key: PerformanceMetricKey) {
  const cell = model.metrics.find((candidate) => candidate.key === key);
  if (cell === undefined) throw new Error(`missing performance metric ${key}`);
  return cell.value;
}

describe('composePerformanceCards', () => {
  it('emits exactly the two registered performance widgets, System first', () => {
    const [system, trader] = composePerformanceCards(page());
    expect(system.side).toBe('system');
    expect(system.widgetId).toBe('system.performance');
    expect(trader.side).toBe('trader');
    expect(trader.widgetId).toBe('trader.performance');
    expect(system.layout.order).toBeLessThan(trader.layout.order);
  });

  it('gives both sides identical metric keys in identical order', () => {
    const [system, trader] = composePerformanceCards(page());
    expect(system.metrics.map((cell) => cell.key)).toEqual([...PERFORMANCE_METRIC_KEYS]);
    expect(trader.metrics.map((cell) => cell.key)).toEqual([...PERFORMANCE_METRIC_KEYS]);
  });

  it('reads each side from its own population and never reconciles the counts', () => {
    const [system, trader] = composePerformanceCards(
      page(axis({ sampleCount: 19, totalR: available('30.0000') }), axis({ sampleCount: 31 })),
    );
    expect(system.sampleCount).toBe(19);
    expect(trader.sampleCount).toBe(31);
    expect(cellOf(system, 'sampleCount')).toEqual({
      status: 'available',
      text: '19',
      tone: 'neutral',
    });
    expect(cellOf(trader, 'sampleCount')).toEqual({
      status: 'available',
      text: '31',
      tone: 'neutral',
    });
    expect(system.hero).toMatchObject({ text: '+30.00R' });
    expect(trader.hero).toMatchObject({ text: '+9.00R' });
  });

  it('never reads the paired comparison population', () => {
    const [system, trader] = composePerformanceCards(page());
    const rendered = JSON.stringify([system, trader]);
    // D5 owns Execution Gap and System Edge Captured. None of the paired
    // figures may reach a D4 card, by value or by reason.
    for (const paired of ['-21.00R', '-1.75R', '30.00%', '0.3000', '12']) {
      expect(rendered).not.toContain(paired);
    }
  });

  describe.each(['system', 'trader'] as const)('%s side', (side) => {
    const index = side === 'system' ? 0 : 1;
    const build = (axisOverrides: Partial<DashboardPerformanceData>) => {
      const built = axis(axisOverrides);
      return composePerformanceCards(side === 'system' ? page(built, axis()) : page(axis(), built))[
        index
      ] as PerformanceCardModel;
    };

    it('tones a positive Total R positive', () => {
      expect(build({ totalR: available('9.0000') }).hero).toEqual({
        status: 'available',
        text: '+9.00R',
        tone: 'positive',
      });
    });

    it('tones a negative Total R negative', () => {
      expect(build({ totalR: available('-4.5000') }).hero).toEqual({
        status: 'available',
        text: '-4.50R',
        tone: 'negative',
      });
    });

    it('leaves a zero Total R neutral and unsigned', () => {
      expect(build({ totalR: available('0.0000') }).hero).toEqual({
        status: 'available',
        text: '0.00R',
        tone: 'neutral',
      });
    });

    it('keeps every supporting metric neutral however strong it reads', () => {
      const model = build({
        winRate: available('0.9800'),
        profitFactor: available('14.0000'),
        averageR: available('3.0000'),
        expectancyR: available('3.0000'),
      });
      for (const key of PERFORMANCE_METRIC_KEYS) {
        expect(cellOf(model, key)).toMatchObject({ tone: 'neutral' });
      }
    });

    it('renders Maximum Drawdown as an unsigned magnitude, not a gain', () => {
      const value = cellOf(build({ maximumDrawdownR: available('2.0000') }), 'maximumDrawdownR');
      // `+2.00R` would read as a 2R profit, and green would compound the lie.
      expect(value).toEqual({ status: 'available', text: '2.00R', tone: 'neutral' });
    });

    it('keeps the rest of the card when Profit Factor has no losses to divide by', () => {
      const model = build({ profitFactor: unavailable('no_losses') });
      expect(cellOf(model, 'profitFactor')).toEqual({
        status: 'unavailable',
        reason: 'no_losses',
      });
      expect(model.hero).toMatchObject({ status: 'available' });
      expect(cellOf(model, 'winRate')).toMatchObject({ status: 'available' });
      expect(cellOf(model, 'sampleCount')).toMatchObject({ status: 'available', text: '31' });
      expect(JSON.stringify(model)).not.toMatch(/Infinity|NaN/);
    });

    it('preserves per-metric availability rather than blanking the card', () => {
      const model = build({
        profitFactor: unavailable('no_losses'),
        maximumDrawdownR: { status: 'error', reason: 'data_integrity_error' },
      });
      expect(cellOf(model, 'profitFactor')).toEqual({ status: 'unavailable', reason: 'no_losses' });
      expect(cellOf(model, 'maximumDrawdownR')).toEqual({ status: 'error' });
      expect(cellOf(model, 'expectancyR')).toMatchObject({ status: 'available' });
      expect(model.populationEmpty).toBe(false);
    });

    it('exposes the W/BE/L composition behind the hero', () => {
      const model = build({ outcomeCounts: { wins: 17, breakEvens: 3, losses: 11 } });
      expect(model.composition).toEqual({ wins: 17, breakEvens: 3, losses: 11 });
    });

    it('reports an empty population as empty, with a truthful zero count', () => {
      const model =
        composePerformanceCards(
          side === 'system' ? page(EMPTY_AXIS, axis()) : page(axis(), EMPTY_AXIS),
        )[index] ?? null;
      if (model === null) throw new Error('missing model');
      expect(model.populationEmpty).toBe(true);
      expect(model.hero).toEqual({ status: 'empty' });
      expect(model.composition).toBeNull();
      expect(cellOf(model, 'sampleCount')).toEqual({
        status: 'available',
        text: '0',
        tone: 'neutral',
      });
      for (const key of PERFORMANCE_METRIC_KEYS.filter((k) => k !== 'sampleCount')) {
        expect(cellOf(model, key)).toEqual({ status: 'empty' });
      }
    });
  });

  it('lets one side be empty while the other stays fully populated', () => {
    const [system, trader] = composePerformanceCards(page(EMPTY_AXIS, axis()));
    expect(system.populationEmpty).toBe(true);
    expect(trader.populationEmpty).toBe(false);
    expect(trader.hero).toMatchObject({ status: 'available', text: '+9.00R' });

    const [system2, trader2] = composePerformanceCards(page(axis(), EMPTY_AXIS));
    expect(system2.populationEmpty).toBe(false);
    expect(trader2.populationEmpty).toBe(true);
    expect(system2.hero).toMatchObject({ status: 'available', text: '+9.00R' });
  });
});
