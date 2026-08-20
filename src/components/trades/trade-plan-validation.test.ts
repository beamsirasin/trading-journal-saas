import { describe, expect, it } from 'vitest';

import {
  canNavigateToStage,
  furthestReachableStage,
  isStageComplete,
  stageErrors,
  type PlanValidationValues,
} from './trade-plan-validation';

function values(overrides: Partial<PlanValidationValues> = {}): PlanValidationValues {
  return {
    tradingAccountId: '',
    strategyId: '',
    setupId: '',
    symbol: '',
    direction: '',
    plannedEntry: '',
    plannedStop: '',
    plannedTarget: '',
    plannedPositionSize: '',
    plannedRiskMinor: '',
    plannedRewardMinor: '',
    tradingviewUrl: '',
    ...overrides,
  };
}

const IDENTITY_BASE = { tradingAccountId: 'a', strategyId: 's', setupId: 'u' };

describe('stageErrors', () => {
  it('requires only the Trading Account at stage 0', () => {
    expect(stageErrors(0, values())).toEqual({ tradingAccountId: 'required_account' });
    expect(stageErrors(0, values({ tradingAccountId: 'acct-1' }))).toEqual({});
  });

  it('never requires Strategy/Setup at stage 1 — both are optional', () => {
    expect(stageErrors(1, values({ tradingAccountId: 'acct-1' }))).toEqual({});
    expect(stageErrors(1, values({ tradingAccountId: 'acct-1', strategyId: 's' }))).toEqual({});
  });

  it('rejects a Setup chosen without a Strategy at stage 1', () => {
    expect(stageErrors(1, values({ tradingAccountId: 'acct-1', setupId: 'u' }))).toEqual({
      setupId: 'setup_requires_strategy',
    });
    expect(
      stageErrors(1, values({ tradingAccountId: 'acct-1', strategyId: 's', setupId: 'u' })),
    ).toEqual({});
  });

  it('requires Symbol/Direction at stage 2', () => {
    const errors = stageErrors(2, values(IDENTITY_BASE));
    expect(errors).toEqual({
      symbol: 'required_symbol',
      direction: 'required_direction',
    });
  });

  it('never requires a Plan at stage 2 — Symbol/Direction alone is complete (Phase 14C.1 Quick Capture)', () => {
    const errors = stageErrors(
      2,
      values({ ...IDENTITY_BASE, symbol: 'XAUUSD', direction: 'long' }),
    );
    expect(errors).toEqual({});
  });

  it('accepts a Price-only Plan (Entry+Stop, no Money)', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedEntry: '100',
        plannedStop: '90',
      }),
    );
    expect(errors).toEqual({});
  });

  it('accepts a Money-only Plan (Risk, no Price)', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedRiskMinor: '50.00',
      }),
    );
    expect(errors).toEqual({});
  });

  it('accepts BOTH Price and Money present simultaneously', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedEntry: '100',
        plannedStop: '90',
        plannedRiskMinor: '50.00',
        plannedRewardMinor: '150.00',
      }),
    );
    expect(errors).toEqual({});
  });

  it('rejects an incomplete Price pair: Entry without Stop', () => {
    const errors = stageErrors(
      2,
      values({ ...IDENTITY_BASE, symbol: 'XAUUSD', direction: 'long', plannedEntry: '100' }),
    );
    expect(errors.plannedStop).toBe('required_stop');
  });

  it('rejects an incomplete Price pair: Stop without Entry', () => {
    const errors = stageErrors(
      2,
      values({ ...IDENTITY_BASE, symbol: 'XAUUSD', direction: 'long', plannedStop: '90' }),
    );
    expect(errors.plannedEntry).toBe('required_entry');
  });

  it('rejects a Target present without a complete Price pair', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedTarget: '130',
        plannedRiskMinor: '50.00',
      }),
    );
    expect(errors.plannedTarget).toBe('incomplete_price_plan');
  });

  it('rejects a Reward present without a Risk', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedEntry: '100',
        plannedStop: '90',
        plannedRewardMinor: '150.00',
      }),
    );
    expect(errors.plannedRewardMinor).toBe('incomplete_money_plan');
  });

  it('rejects a malformed decimal in Entry/Stop/Target/Position size', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedEntry: 'abc',
        plannedStop: '90',
        plannedTarget: 'xyz',
        plannedPositionSize: 'nope',
      }),
    );
    expect(errors.plannedEntry).toBe('invalid_decimal');
    expect(errors.plannedTarget).toBe('invalid_decimal');
    expect(errors.plannedPositionSize).toBe('invalid_decimal');
  });

  it('rejects a malformed decimal in Risk/Reward', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedRiskMinor: 'abc',
        plannedRewardMinor: 'xyz',
      }),
    );
    expect(errors.plannedRiskMinor).toBe('invalid_decimal');
    // Reward's malformed-decimal check only applies once Risk itself is present and valid-shaped;
    // here Risk is malformed too, so Reward's error stays the more fundamental "needs a Risk" complaint
    // only if Risk were absent — since Risk IS present (just malformed), Reward is checked as malformed too.
    expect(errors.plannedRewardMinor).toBe('invalid_decimal');
  });

  it('allows a blank Target/Position size/Reward (all optional)', () => {
    const errors = stageErrors(
      2,
      values({
        ...IDENTITY_BASE,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedEntry: '100',
        plannedStop: '90',
        plannedRiskMinor: '50.00',
      }),
    );
    expect(errors).toEqual({});
  });

  it('rejects a non-TradingView, non-HTTPS URL', () => {
    const base = values({
      ...IDENTITY_BASE,
      symbol: 'XAUUSD',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(stageErrors(2, { ...base, tradingviewUrl: 'not-a-url' }).tradingviewUrl).toBe(
      'invalid_tradingview_url',
    );
    expect(
      stageErrors(2, { ...base, tradingviewUrl: 'https://www.tradingview.com/chart/x' })
        .tradingviewUrl,
    ).toBeUndefined();
  });
});

describe('isStageComplete / furthestReachableStage / canNavigateToStage', () => {
  it('reports stage 0 as the furthest reachable stage when nothing is filled', () => {
    const v = values();
    expect(furthestReachableStage(v)).toBe(0);
    expect(canNavigateToStage(0, v)).toBe(true);
    expect(canNavigateToStage(1, v)).toBe(false);
    expect(canNavigateToStage(2, v)).toBe(false);
    expect(canNavigateToStage(3, v)).toBe(false);
  });

  it('reaches stage 2 directly once the Account is chosen — Strategy/Setup never block it', () => {
    // Stage 1 (Strategy/Setup) has no required fields of its own since both
    // are optional (Phase 14C) — an Account alone already satisfies stages
    // 0 AND 1, so the furthest reachable stage is 2 (Symbol/Direction/Plan),
    // not 1.
    const v = values({ tradingAccountId: 'acct-1' });
    expect(isStageComplete(0, v)).toBe(true);
    expect(isStageComplete(1, v)).toBe(true);
    expect(furthestReachableStage(v)).toBe(2);
    expect(canNavigateToStage(1, v)).toBe(true);
    expect(canNavigateToStage(2, v)).toBe(true);
    expect(canNavigateToStage(3, v)).toBe(false);
  });

  it('unlocks stage 3 (Review) once a complete Price Plan exists', () => {
    const complete = values({
      ...IDENTITY_BASE,
      symbol: 'XAUUSD',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(furthestReachableStage(complete)).toBe(3);
    expect(canNavigateToStage(3, complete)).toBe(true);

    const incomplete = { ...complete, plannedStop: '' };
    expect(furthestReachableStage(incomplete)).toBe(2);
    expect(canNavigateToStage(3, incomplete)).toBe(false);
    expect(canNavigateToStage(2, incomplete)).toBe(true);
  });

  it('unlocks stage 3 (Review) with NO Plan at all — Phase 14C.1 Quick Capture needs only Account/Symbol/Direction', () => {
    const noPlan = values({ ...IDENTITY_BASE, symbol: 'XAUUSD', direction: 'long' });
    expect(furthestReachableStage(noPlan)).toBe(3);
    expect(canNavigateToStage(3, noPlan)).toBe(true);
    expect(noPlan.plannedEntry).toBe('');
    expect(noPlan.plannedRiskMinor).toBe('');
  });

  it('unlocks stage 3 (Review) via a Money-only Plan just as readily as a Price-only one', () => {
    const moneyOnly = values({
      ...IDENTITY_BASE,
      symbol: 'XAUUSD',
      direction: 'long',
      plannedRiskMinor: '50.00',
    });
    expect(furthestReachableStage(moneyOnly)).toBe(3);
    expect(canNavigateToStage(3, moneyOnly)).toBe(true);
  });

  it('never disagrees between a stage being reachable and it being the furthest complete boundary', () => {
    const v = values({ tradingAccountId: 'a', setupId: 'u' });
    // setupId without strategyId -> stage 1 incomplete -> stage 2 unreachable
    expect(isStageComplete(1, v)).toBe(false);
    expect(canNavigateToStage(2, v)).toBe(false);
  });
});
