import { describe, expect, it } from 'vitest';

import type {
  AnalyticsMetric,
  ComparisonAnalyticsModel,
  ConfidenceAnalyticsModel,
  DimensionAxisSummary,
  EmotionGroupModel,
  FrameworkPerformanceAnalyticsModel,
  SetupPerformanceAnalyticsModel,
} from './metrics';
import {
  selectBestObservedSetup,
  selectBestObservedStrategy,
  selectEmotionConcern,
  selectExecutionGapObservation,
  selectStrongestConfidenceLevel,
  selectStrongestEmotion,
} from './overview-selectors';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable: AnalyticsMetric = { status: 'unavailable', reason: 'no_trades' };

function dimAxis(tradeCount: number, averageR: string | null): DimensionAxisSummary {
  return {
    tradeCount,
    averageR: averageR === null ? unavailable : available(averageR),
    winRate: unavailable,
  };
}

describe('selectStrongestConfidenceLevel', () => {
  function confidence(
    levels: readonly {
      level: 0 | 25 | 50 | 75 | 100;
      tradeCount: number;
      averageR: string | null;
    }[],
  ): ConfidenceAnalyticsModel {
    return {
      sampleCount: levels.reduce((sum, l) => sum + l.tradeCount, 0),
      averageConfidence: available('0.5000'),
      levels: levels.map((l) => ({
        level: l.level,
        trader: dimAxis(l.tradeCount, l.averageR),
        system: dimAxis(0, null),
      })),
    };
  }

  it('returns null when every level has zero Trades', () => {
    const model = confidence([
      { level: 0, tradeCount: 0, averageR: null },
      { level: 75, tradeCount: 0, averageR: null },
    ]);
    expect(selectStrongestConfidenceLevel(model)).toBeNull();
  });

  it('picks the level with the highest average R among populated levels', () => {
    const model = confidence([
      { level: 25, tradeCount: 4, averageR: '0.5000' },
      { level: 75, tradeCount: 12, averageR: '1.7000' },
      { level: 100, tradeCount: 2, averageR: '1.0000' },
    ]);
    expect(selectStrongestConfidenceLevel(model)).toEqual({
      level: 75,
      averageR: '1.7000',
      tradeCount: 12,
    });
  });

  it('allows level 0 to be the strongest observed — 0 is a valid recorded value, not "no data"', () => {
    const model = confidence([
      { level: 0, tradeCount: 5, averageR: '2.0000' },
      { level: 100, tradeCount: 3, averageR: '1.0000' },
    ]);
    expect(selectStrongestConfidenceLevel(model)?.level).toBe(0);
  });

  it('ignores a populated level whose average R is unavailable rather than treating it as zero', () => {
    const model = confidence([
      { level: 25, tradeCount: 3, averageR: null },
      { level: 50, tradeCount: 2, averageR: '0.4000' },
    ]);
    expect(selectStrongestConfidenceLevel(model)?.level).toBe(50);
  });
});

describe('selectStrongestEmotion / selectEmotionConcern', () => {
  function emotion(
    key: string,
    label: string,
    tradeCount: number,
    averageR: string | null,
  ): EmotionGroupModel {
    return { key, label, trader: dimAxis(tradeCount, averageR), system: dimAxis(0, null) };
  }

  it('returns null for an empty Emotion list', () => {
    expect(selectStrongestEmotion([])).toBeNull();
    expect(selectEmotionConcern([], null)).toBeNull();
  });

  it('picks the highest-averaging Emotion as strongest, and a genuinely negative distinct group as the concern', () => {
    const emotions = [
      emotion('focused', 'Focused', 12, '1.4000'),
      emotion('fearful', 'Fearful', 5, '-0.7000'),
    ];
    const strongest = selectStrongestEmotion(emotions);
    expect(strongest).toEqual({
      key: 'focused',
      label: 'Focused',
      averageR: '1.4000',
      tradeCount: 12,
    });
    const concern = selectEmotionConcern(emotions, strongest?.key ?? null);
    expect(concern).toEqual({
      key: 'fearful',
      label: 'Fearful',
      averageR: '-0.7000',
      tradeCount: 5,
    });
  });

  it('never manufactures a concern from "the worse of two positives"', () => {
    const emotions = [
      emotion('focused', 'Focused', 10, '1.5000'),
      emotion('calm', 'Calm', 4, '0.6000'),
    ];
    const strongest = selectStrongestEmotion(emotions);
    expect(selectEmotionConcern(emotions, strongest?.key ?? null)).toBeNull();
  });

  it('returns null concern when only one distinct Emotion group has data', () => {
    const emotions = [emotion('fearful', 'Fearful', 5, '-0.7000')];
    const strongest = selectStrongestEmotion(emotions);
    expect(selectEmotionConcern(emotions, strongest?.key ?? null)).toBeNull();
  });
});

describe('selectExecutionGapObservation', () => {
  function comparison(overrides: Partial<ComparisonAnalyticsModel>): ComparisonAnalyticsModel {
    return {
      comparableCount: 0,
      pairedSystemTotalR: unavailable,
      pairedActualTotalR: unavailable,
      executionGapR: unavailable,
      averageExecutionGapR: unavailable,
      systemEdgeCaptured: unavailable,
      ...overrides,
    };
  }

  it('returns null when there are no comparable (paired) Trades', () => {
    expect(selectExecutionGapObservation(comparison({ comparableCount: 0 }))).toBeNull();
  });

  it('returns null when the average execution gap metric is unavailable despite a nonzero count', () => {
    expect(
      selectExecutionGapObservation(
        comparison({ comparableCount: 3, averageExecutionGapR: unavailable }),
      ),
    ).toBeNull();
  });

  it('classifies a negative average gap as "behind"', () => {
    expect(
      selectExecutionGapObservation(
        comparison({ comparableCount: 8, averageExecutionGapR: available('-0.5000') }),
      ),
    ).toEqual({ tone: 'behind', comparableCount: 8 });
  });

  it('classifies a positive average gap as "ahead"', () => {
    expect(
      selectExecutionGapObservation(
        comparison({ comparableCount: 8, averageExecutionGapR: available('0.5000') }),
      ),
    ).toEqual({ tone: 'ahead', comparableCount: 8 });
  });

  it('classifies an exactly-zero average gap as "even"', () => {
    expect(
      selectExecutionGapObservation(
        comparison({ comparableCount: 8, averageExecutionGapR: available('0.0000') }),
      ),
    ).toEqual({ tone: 'even', comparableCount: 8 });
  });
});

describe('selectBestObservedStrategy / selectBestObservedSetup', () => {
  it('returns the already-sorted top Strategy when it has Trader data', () => {
    const model: FrameworkPerformanceAnalyticsModel = {
      strategies: [
        { strategyId: 'strategy-a', trader: dimAxis(24, '1.4800'), system: dimAxis(20, '2.1000') },
        { strategyId: 'strategy-b', trader: dimAxis(5, '0.5000'), system: dimAxis(4, '0.4000') },
      ],
      classifiedTraderCount: 29,
      unclassifiedTraderCount: 0,
      classifiedSystemCount: 24,
      unclassifiedSystemCount: 0,
    };
    expect(selectBestObservedStrategy(model)?.strategyId).toBe('strategy-a');
  });

  it('returns null when the top entry has no Trader data at all (System-only), never a false "best observed"', () => {
    const model: FrameworkPerformanceAnalyticsModel = {
      strategies: [
        {
          strategyId: 'strategy-system-only',
          trader: dimAxis(0, null),
          system: dimAxis(4, '1.0000'),
        },
      ],
      classifiedTraderCount: 0,
      unclassifiedTraderCount: 0,
      classifiedSystemCount: 4,
      unclassifiedSystemCount: 0,
    };
    expect(selectBestObservedStrategy(model)).toBeNull();
  });

  it('returns null for an empty Strategy list', () => {
    expect(
      selectBestObservedStrategy({
        strategies: [],
        classifiedTraderCount: 0,
        unclassifiedTraderCount: 0,
        classifiedSystemCount: 0,
        unclassifiedSystemCount: 0,
      }),
    ).toBeNull();
  });

  it('returns the already-sorted top Setup when it has Trader data', () => {
    const model: SetupPerformanceAnalyticsModel = {
      setups: [
        {
          setupId: 'setup-a',
          strategyId: 'strategy-a',
          trader: dimAxis(18, '1.9200'),
          system: dimAxis(15, '2.4000'),
        },
      ],
      classifiedTraderCount: 18,
      unclassifiedTraderCount: 0,
      classifiedSystemCount: 15,
      unclassifiedSystemCount: 0,
    };
    expect(selectBestObservedSetup(model)?.setupId).toBe('setup-a');
  });

  it('returns null for an empty Setup list', () => {
    expect(
      selectBestObservedSetup({
        setups: [],
        classifiedTraderCount: 0,
        unclassifiedTraderCount: 0,
        classifiedSystemCount: 0,
        unclassifiedSystemCount: 0,
      }),
    ).toBeNull();
  });
});
