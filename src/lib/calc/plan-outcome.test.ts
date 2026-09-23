import { describe, expect, it } from 'vitest';

import {
  planOutcomeCase,
  planOutcomeChoices,
  planOutcomeNeedsAmount,
  validatePlanOutcomeAnswer,
  type PlanOutcomePlan,
} from '@/lib/trades/plan-outcome';

import { planOutcomeResult } from './plan-outcome';

const plan = (overrides: Partial<PlanOutcomePlan> = {}): PlanOutcomePlan => ({
  plannedRiskMinor: 5_000n,
  plannedRiskState: 'defined',
  targetState: 'fixed',
  plannedRewardMinor: 10_000n,
  exitPlanState: null,
  ...overrides,
});

describe('planOutcomeCase — which question the plan allows', () => {
  it('Defined Risk + Fixed Target is bounded', () => {
    expect(planOutcomeCase(plan())).toBe('bounded');
    // A TP price alone still fixes the target: the plan is still bounded.
    expect(planOutcomeCase(plan({ plannedRewardMinor: null }))).toBe('bounded');
  });

  it('a Fixed Target outranks an Exit Plan', () => {
    expect(planOutcomeCase(plan({ exitPlanState: 'saved' }))).toBe('bounded');
  });

  it('Defined Risk + a recorded Exit Plan without a Fixed Target is exit_plan', () => {
    for (const exitPlanState of ['saved', 'customized'] as const) {
      expect(planOutcomeCase(plan({ targetState: 'no_fixed', exitPlanState }))).toBe('exit_plan');
      expect(planOutcomeCase(plan({ targetState: null, exitPlanState }))).toBe('exit_plan');
    }
  });

  it('No Defined Risk asks nothing, even with a target and a plan', () => {
    expect(
      planOutcomeCase(
        plan({ plannedRiskState: 'no_defined', plannedRiskMinor: null, exitPlanState: 'saved' }),
      ),
    ).toBe('no_defined_risk');
  });

  it('a risk that was never recorded is its own reason, never No Defined Risk', () => {
    expect(planOutcomeCase(plan({ plannedRiskState: null, plannedRiskMinor: null }))).toBe(
      'risk_not_recorded',
    );
  });

  it('Defined Risk with neither a Fixed Target nor a usable Exit Plan is unavailable', () => {
    for (const exitPlanState of [null, 'no_rule'] as const) {
      expect(planOutcomeCase(plan({ targetState: 'no_fixed', exitPlanState }))).toBe('unavailable');
      expect(planOutcomeCase(plan({ targetState: null, exitPlanState }))).toBe('unavailable');
    }
  });

  it('offers only the answers its case allows', () => {
    expect(planOutcomeChoices('bounded')).toEqual([
      'planned_target_first',
      'planned_risk_first',
      'cannot_determine',
    ]);
    expect(planOutcomeChoices('exit_plan')).toEqual(['exit_plan_result', 'cannot_determine']);
    for (const kind of ['no_defined_risk', 'risk_not_recorded', 'unavailable'] as const) {
      expect(planOutcomeChoices(kind)).toEqual([]);
    }
  });
});

describe('validatePlanOutcomeAnswer — the one write rule', () => {
  it('asks for a number only when it cannot be derived', () => {
    expect(planOutcomeNeedsAmount('planned_target_first', plan())).toBe(false);
    expect(planOutcomeNeedsAmount('planned_target_first', plan({ plannedRewardMinor: null }))).toBe(
      true,
    );
    expect(planOutcomeNeedsAmount('planned_risk_first', plan())).toBe(false);
    expect(planOutcomeNeedsAmount('exit_plan_result', plan())).toBe(true);
    expect(planOutcomeNeedsAmount('cannot_determine', plan())).toBe(false);
  });

  it('accepts each answer its case offers', () => {
    expect(validatePlanOutcomeAnswer('planned_target_first', null, plan())).toBeNull();
    expect(validatePlanOutcomeAnswer('planned_risk_first', null, plan())).toBeNull();
    expect(validatePlanOutcomeAnswer('cannot_determine', null, plan())).toBeNull();
    const rule = plan({ targetState: 'no_fixed', exitPlanState: 'saved' });
    expect(validatePlanOutcomeAnswer('exit_plan_result', 30_000n, rule)).toBeNull();
    expect(validatePlanOutcomeAnswer('exit_plan_result', -2_500n, rule)).toBeNull();
    expect(validatePlanOutcomeAnswer('cannot_determine', null, rule)).toBeNull();
  });

  it('refuses an answer the plan does not offer', () => {
    expect(validatePlanOutcomeAnswer('exit_plan_result', 100n, plan())).toBe(
      'plan_outcome_not_applicable',
    );
    const rule = plan({ targetState: 'no_fixed', exitPlanState: 'saved' });
    expect(validatePlanOutcomeAnswer('planned_risk_first', null, rule)).toBe(
      'plan_outcome_not_applicable',
    );
    const noRisk = plan({ plannedRiskState: 'no_defined', plannedRiskMinor: null });
    expect(validatePlanOutcomeAnswer('cannot_determine', null, noRisk)).toBe(
      'plan_outcome_not_applicable',
    );
  });

  it('refuses a stated amount where the plan derives it, and requires one where it cannot', () => {
    expect(validatePlanOutcomeAnswer('planned_target_first', 10_000n, plan())).toBe(
      'plan_outcome_amount_not_allowed',
    );
    expect(validatePlanOutcomeAnswer('planned_risk_first', -5_000n, plan())).toBe(
      'plan_outcome_amount_not_allowed',
    );
    const rule = plan({ targetState: 'no_fixed', exitPlanState: 'customized' });
    expect(validatePlanOutcomeAnswer('exit_plan_result', null, rule)).toBe(
      'plan_outcome_amount_required',
    );
    const tpOnly = plan({ plannedRewardMinor: null });
    expect(validatePlanOutcomeAnswer('planned_target_first', null, tpOnly)).toBe(
      'plan_outcome_amount_required',
    );
    expect(validatePlanOutcomeAnswer('planned_target_first', 0n, tpOnly)).toBe(
      'plan_outcome_amount_invalid',
    );
    expect(validatePlanOutcomeAnswer('planned_target_first', 9_000n, tpOnly)).toBeNull();
  });
});

describe('planOutcomeResult — what the plan would have produced', () => {
  it('target first: the Target Profit, and its R against Risk at Entry', () => {
    expect(planOutcomeResult('planned_target_first', null, plan())).toEqual({
      status: 'known',
      outcome: 'planned_target_first',
      amountMinor: 10_000n,
      r: '2.0000',
      amountSource: 'plan',
    });
  });

  it('target first with a TP price only: the stated amount', () => {
    expect(
      planOutcomeResult('planned_target_first', 7_500n, plan({ plannedRewardMinor: null })),
    ).toMatchObject({ amountMinor: 7_500n, r: '1.5000', amountSource: 'stated' });
  });

  it('risk first: minus Risk at Entry, and exactly −1R', () => {
    expect(planOutcomeResult('planned_risk_first', null, plan())).toMatchObject({
      status: 'known',
      amountMinor: -5_000n,
      r: '-1.0000',
    });
  });

  it('exit plan: the stated amount over Risk at Entry — $300 on a $50 risk is +6R', () => {
    const rule = plan({ targetState: 'no_fixed', exitPlanState: 'saved' });
    expect(planOutcomeResult('exit_plan_result', 30_000n, rule)).toMatchObject({
      amountMinor: 30_000n,
      r: '6.0000',
      amountSource: 'stated',
    });
    expect(planOutcomeResult('exit_plan_result', -1_250n, rule)).toMatchObject({ r: '-0.2500' });
  });

  it('keeps Unanswered and Cannot Determine apart, and neither is a figure', () => {
    expect(planOutcomeResult(null, null, plan())).toEqual({ status: 'unanswered' });
    expect(planOutcomeResult('cannot_determine', null, plan())).toEqual({
      status: 'cannot_determine',
    });
  });

  it('follows a later correction of the plan instead of keeping a stale copy', () => {
    expect(
      planOutcomeResult('planned_target_first', null, plan({ plannedRewardMinor: 15_000n })),
    ).toMatchObject({ amountMinor: 15_000n, r: '3.0000' });
    expect(
      planOutcomeResult('planned_risk_first', null, plan({ plannedRiskMinor: 2_500n })),
    ).toMatchObject({ amountMinor: -2_500n, r: '-1.0000' });
  });

  it('says so when the plan no longer offers the recorded answer — never a guess', () => {
    const noRisk = plan({ plannedRiskState: 'no_defined', plannedRiskMinor: null });
    expect(planOutcomeResult('planned_target_first', null, noRisk)).toEqual({
      status: 'plan_changed',
      outcome: 'planned_target_first',
    });
    // A target first whose Target Profit is gone and was never stated.
    expect(
      planOutcomeResult('planned_target_first', null, plan({ plannedRewardMinor: null })),
    ).toEqual({ status: 'plan_changed', outcome: 'planned_target_first' });
  });
});
