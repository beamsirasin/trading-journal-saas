import { describe, expect, it } from 'vitest';

import { effectiveExitPlan, EMPTY_EXIT_PLAN, type ExitPlanDraft } from './exit-plan';
import { EMPTY_PLAN, tradeIdeaSummary } from './journal-editors';

describe('Trade idea summary', () => {
  it('keeps Not selected distinct from an explicit No strategy answer', () => {
    expect(tradeIdeaSummary(EMPTY_PLAN)).toEqual([]);
    expect(tradeIdeaSummary({ ...EMPTY_PLAN, noStrategy: true })).toEqual(['No strategy']);
  });

  it('uses a chart as the preview only when no reasoning or classification exists', () => {
    const chart = { kind: 'link', url: 'https://www.tradingview.com/x/example/' } as const;
    expect(tradeIdeaSummary({ ...EMPTY_PLAN, chart })).toEqual(['Chart attached']);
    expect(tradeIdeaSummary({ ...EMPTY_PLAN, reason: 'Breakout retest', chart })).toEqual([
      'Breakout retest',
    ]);
  });
});

describe('Strategy changes and Exit-plan inheritance', () => {
  it('resolves a strategy default only while the trade source is none', () => {
    const result = effectiveExitPlan(EMPTY_EXIT_PLAN, 'Elliott Wave');
    expect(result.inherited).toBe(true);
    expect(result.draft.source).toBe('saved');
    expect(result.draft.instructions).toBe('Trail beneath structure; exit on RSI invalidation.');
  });

  it.each([
    {
      source: 'saved',
      planId: 'xp-fixed',
      planName: 'Fixed plan',
      instructions: 'Take profit at two R.',
    },
    {
      source: 'custom',
      planId: null,
      planName: null,
      instructions: 'Trail this trade manually.',
    },
    {
      source: 'no_rule',
      planId: null,
      planName: null,
      instructions: '',
    },
  ] satisfies readonly ExitPlanDraft[])(
    'does not overwrite an explicit $source Exit-plan choice',
    (chosen) => {
      expect(effectiveExitPlan(chosen, 'Elliott Wave')).toEqual({
        draft: chosen,
        inherited: false,
      });
    },
  );

  it('keeps Not recorded when the selected strategy has no default', () => {
    expect(effectiveExitPlan(EMPTY_EXIT_PLAN, 'Price Action')).toEqual({
      draft: EMPTY_EXIT_PLAN,
      inherited: false,
    });
  });
});
