import { describe, expect, it } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import { createAtEntryDraft } from './at-entry-draft';
import { hasStaleSelection, staleSelections } from './stale-selection';

const OPTIONS = {
  strategies: [
    {
      strategyId: 's1',
      name: 'Breakout',
      setups: [{ setupId: 'u1', name: 'Retest', conditions: [], conditionSetToken: 't' }],
    },
  ],
  exitPlans: [{ exitPlanId: 'p1', name: 'Scale out', instructions: 'x', strategyId: null }],
} as unknown as Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;

const base = createAtEntryDraft('a');

describe('staleSelections', () => {
  it('is quiet for unanswered, None and still-offered choices', () => {
    expect(hasStaleSelection(staleSelections(base, OPTIONS))).toBe(false);
    const offered = {
      ...base,
      classification: {
        ...base.classification,
        strategy: 'selected' as const,
        strategyId: 's1',
        setupByStrategy: { s1: { answer: 'selected' as const, setupId: 'u1' } },
      },
      exitPlan: { ...base.exitPlan, choice: { kind: 'saved' as const, exitPlanId: 'p1' } },
    };
    expect(hasStaleSelection(staleSelections(offered, OPTIONS))).toBe(false);
  });

  it('names each chosen answer whose source is no longer offered', () => {
    const gone = {
      ...base,
      classification: {
        ...base.classification,
        strategy: 'selected' as const,
        strategyId: 's1',
        setupByStrategy: { s1: { answer: 'selected' as const, setupId: 'archived' } },
      },
      exitPlan: { ...base.exitPlan, choice: { kind: 'saved' as const, exitPlanId: 'archived' } },
    };
    expect(staleSelections(gone, OPTIONS)).toEqual({
      strategy: false,
      setup: true,
      exitPlan: true,
    });
    const strategyGone = {
      ...gone,
      classification: { ...gone.classification, strategyId: 'archived' },
    };
    expect(staleSelections(strategyGone, OPTIONS).strategy).toBe(true);
  });
});
