import { describe, expect, it } from 'vitest';

import {
  exitPlanLevel,
  finalCloseEligible,
  missingRequired,
  recordComplete,
  requirementItems,
  requirementLevel,
  stepRequirementStatus,
  type RequirementAnswers,
} from './requirements';

const NOTHING: RequirementAnswers = {
  account: false,
  symbol: false,
  direction: false,
  entryTime: false,
  risk: false,
  target: 'unanswered',
  exitPlan: false,
  priceLevels: false,
  strategy: false,
  setup: false,
  conditions: false,
  confidence: false,
  entryEmotion: false,
  entryContext: false,
  notesEvidence: false,
  outcome: false,
  traderResult: false,
  finalExitTime: false,
  systemResult: false,
  afterTradeContext: false,
};

const levels = (answers: RequirementAnswers) =>
  Object.fromEntries(requirementItems(answers).map((item) => [item.key, item.level]));

describe('requirement levels (decision 59)', () => {
  it('maps every item to its level', () => {
    expect(levels(NOTHING)).toEqual({
      account: 'required',
      symbol: 'required',
      direction: 'required',
      entryTime: 'optional',
      risk: 'required',
      target: 'required',
      exitPlan: 'conditional',
      priceLevels: 'optional',
      strategy: 'recommended',
      setup: 'optional',
      conditions: 'optional',
      confidence: 'recommended',
      entryEmotion: 'recommended',
      entryContext: 'optional',
      notesEvidence: 'optional',
      outcome: 'required',
      traderResult: 'required',
      finalExitTime: 'optional',
      systemResult: 'required',
      afterTradeContext: 'optional',
    });
  });

  it('decides the Exit Plan from the Target answer, and never from an Unanswered one', () => {
    expect(exitPlanLevel('fixed')).toBe('recommended');
    expect(exitPlanLevel('no_fixed')).toBe('required');
    expect(exitPlanLevel('unanswered')).toBe('conditional');
    expect(requirementLevel('exitPlan', { target: 'no_fixed' })).toBe('required');
  });
});

describe('completion', () => {
  const closeReady: RequirementAnswers = {
    ...NOTHING,
    account: true,
    symbol: true,
    direction: true,
    risk: true,
    target: 'fixed',
    outcome: true,
    traderResult: true,
  };

  it('counts only Required items, never Recommended or Optional', () => {
    expect(missingRequired(requirementItems(closeReady)).map((item) => item.key)).toEqual([
      'systemResult',
    ]);
    expect(finalCloseEligible(requirementItems(closeReady))).toBe(true);
    expect(recordComplete(requirementItems(closeReady))).toBe(false);
    expect(recordComplete(requirementItems({ ...closeReady, systemResult: true }))).toBe(true);
  });

  it('accepts explicit negatives: No Defined Risk, No Fixed Target, Can’t determine', () => {
    // `risk: true` is also what No Defined Risk maps to; No Fixed Target needs an Exit Plan.
    const noFixed = { ...closeReady, target: 'no_fixed' as const };
    expect(missingRequired(requirementItems(noFixed)).map((item) => item.key)).toEqual([
      'exitPlan',
      'systemResult',
    ]);
    expect(finalCloseEligible(requirementItems({ ...noFixed, exitPlan: true }))).toBe(true);
  });

  it('treats a System Result the plan does not ask as no item at all', () => {
    const items = requirementItems({ ...closeReady, systemResult: null });
    expect(items.some((item) => item.key === 'systemResult')).toBe(false);
    expect(recordComplete(items)).toBe(true);
  });

  it('leaves out what a flow does not ask', () => {
    const openOnly = requirementItems({
      account: true,
      symbol: true,
      direction: true,
      risk: false,
    });
    expect(openOnly.map((item) => item.key)).toEqual(['account', 'symbol', 'direction', 'risk']);
  });

  it('never calls a step with Required items Optional', () => {
    const items = requirementItems(NOTHING);
    expect(stepRequirementStatus(items, 'after')).toEqual({
      required: 1,
      requiredLeft: 1,
      recommended: 0,
    });
    expect(stepRequirementStatus(items, 'setup')).toEqual({
      required: 0,
      requiredLeft: 0,
      recommended: 1,
    });
    expect(stepRequirementStatus(items, 'plan')).toMatchObject({ required: 2, requiredLeft: 2 });
  });
});
