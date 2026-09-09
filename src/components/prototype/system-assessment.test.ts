/**
 * WHAT A SYSTEM ASSESSMENT IS ALLOWED TO CLAIM.
 *
 * The failure mode this whole feature invites is hindsight fiction: a
 * retrospective opinion, formed with the outcome already known, entering
 * analytics as though it were a measurement of the strategy. Every case here is
 * one route to that — a target assumed held because price reached it, an
 * unestimated cost read as zero, a gross counterfactual subtracted from a net
 * actual, today's rules standing in for last month's, an outcome word stored
 * where it could contradict its own figure.
 */
import { describe, expect, it } from 'vitest';

import type { ExitPlanDraft } from './add-trade/exit-plan';
import {
  assessmentDependencies,
  comparability,
  confirmAssessment,
  EMPTY_SYSTEM_ASSESSMENT,
  executionGapR,
  isResolved,
  needsReview,
  systemAssessmentSummary,
  systemCostR,
  systemGrossR,
  systemNetR,
  systemOutcome,
  type AssessmentContext,
  type SystemAssessmentDraft,
} from './system-assessment';

const PLAN: ExitPlanDraft = {
  source: 'saved',
  planId: 'xp-fixed',
  planName: 'Fixed plan',
  instructions: 'Take profit at two R.',
};

const CONTEXT: AssessmentContext = {
  strategy: 'Elliott Wave',
  setup: 'Wave 3 Continuation',
  exitPlan: PLAN,
  riskAtEntry: '200.00',
  targetProfit: '1000.00',
};

/** An assessment as the editor would leave it, before dependencies are captured. */
function assessed(overrides: Partial<SystemAssessmentDraft> = {}): SystemAssessmentDraft {
  const draft: SystemAssessmentDraft = {
    ...EMPTY_SYSTEM_ASSESSMENT,
    status: 'assessed',
    reason: 'target_hit',
    basis: 'plan_target',
    ...overrides,
  };
  return { ...draft, dependencies: assessmentDependencies(CONTEXT, draft.basis) };
}

describe('the four states, and the two that must not merge', () => {
  it('starts unassessed and silent', () => {
    expect(EMPTY_SYSTEM_ASSESSMENT.status).toBe('not_assessed');
    expect(systemGrossR(EMPTY_SYSTEM_ASSESSMENT, CONTEXT)).toBeNull();
    expect(systemNetR(EMPTY_SYSTEM_ASSESSMENT, CONTEXT)).toBeNull();
    expect(systemOutcome(EMPTY_SYSTEM_ASSESSMENT, CONTEXT)).toBeNull();
    expect(systemAssessmentSummary(EMPTY_SYSTEM_ASSESSMENT, CONTEXT)).toEqual([]);
    expect(needsReview(EMPTY_SYSTEM_ASSESSMENT, CONTEXT)).toBe(false);
  });

  it('records no_trade as a finding, with no System R of any kind', () => {
    const draft = { ...EMPTY_SYSTEM_ASSESSMENT, status: 'no_trade' as const };
    expect(systemGrossR(draft, CONTEXT)).toBeNull();
    expect(systemNetR(draft, CONTEXT)).toBeNull();
    // Emphatically NOT zero: zero would assert the rules broke even on a trade
    // they would never have taken.
    expect(systemGrossR(draft, CONTEXT)).not.toBe(0);
    expect(systemOutcome(draft, CONTEXT)).toBeNull();
    expect(comparability(draft, CONTEXT)).toBe('unavailable');
    expect(systemAssessmentSummary(draft, CONTEXT)).toEqual([
      'Your rules would not have taken this trade',
    ]);
  });

  it('keeps cannot_determine distinct from not_assessed', () => {
    const asked = { ...EMPTY_SYSTEM_ASSESSMENT, status: 'cannot_determine' as const };
    // Same absence of numbers, opposite information about whether anyone looked.
    expect(asked.status).not.toBe(EMPTY_SYSTEM_ASSESSMENT.status);
    expect(systemAssessmentSummary(asked, CONTEXT)).toEqual([
      'Can’t determine what the rules would have done',
    ]);
    expect(systemAssessmentSummary(EMPTY_SYSTEM_ASSESSMENT, CONTEXT)).toEqual([]);
  });

  it('invents no R or outcome for cannot_determine', () => {
    const draft = { ...EMPTY_SYSTEM_ASSESSMENT, status: 'cannot_determine' as const };
    expect(systemGrossR(draft, CONTEXT)).toBeNull();
    expect(systemNetR(draft, CONTEXT)).toBeNull();
    expect(systemOutcome(draft, CONTEXT)).toBeNull();
    expect(isResolved(draft, CONTEXT)).toBe(false);
  });
});

describe('System R is derived from the declared basis, never from anything else', () => {
  it('reads the plan target only once the trader names it as the resolution', () => {
    /*
      TARGET R AND SYSTEM R ARE THE SAME NUMBER HERE, AND THAT IS NOT AUTOMATIC.
      Target R (1000/200 = +5R) exists the moment the plan does. It becomes the
      system result only because the trader selected `target_hit` — a statement
      about which rule fired first, which no arithmetic could have made for them.
    */
    expect(systemGrossR(assessed({ basis: 'plan_target' }), CONTEXT)).toBe(5);

    // With no basis chosen, the same plan yields nothing at all.
    const unchosen = { ...assessed(), basis: null };
    expect(systemGrossR(unchosen, CONTEXT)).toBeNull();
  });

  it('resolves a stop to exactly −1R, because that is what R means', () => {
    expect(systemGrossR(assessed({ reason: 'stop_hit', basis: 'plan_stop' }), CONTEXT)).toBe(-1);
  });

  it('resolves a break-even rule to a known zero', () => {
    const draft = assessed({ reason: 'break_even_rule', basis: 'break_even' });
    expect(systemGrossR(draft, CONTEXT)).toBe(0);
    // A known zero, unlike every other absence on this model.
    expect(systemGrossR(draft, CONTEXT)).not.toBeNull();
  });

  it('accepts the trader’s own figure where no rule can be computed', () => {
    const trailed = assessed({ reason: 'trailing_exit', basis: 'money', systemMoney: '640.00' });
    expect(systemGrossR(trailed, CONTEXT)).toBe(3.2);

    const typed = assessed({ reason: 'rule_exit', basis: 'custom_r', grossRInput: '2.4' });
    expect(systemGrossR(typed, CONTEXT)).toBe(2.4);
  });

  it('has no System R when the risk it would divide by is unrecorded', () => {
    const noRisk = { ...CONTEXT, riskAtEntry: '' };
    expect(systemGrossR(assessed({ basis: 'plan_target' }), noRisk)).toBeNull();
    expect(systemGrossR(assessed({ basis: 'money', systemMoney: '640.00' }), noRisk)).toBeNull();
    // A directly typed R needs no risk, and still works.
    expect(systemGrossR(assessed({ basis: 'custom_r', grossRInput: '2.4' }), noRisk)).toBe(2.4);
  });

  it('never reads the actual result — there is nowhere for it to enter', () => {
    // The context carries the PLAN only. No actual P&L, no exit price, no legs.
    const keys = Object.keys(CONTEXT).sort();
    expect(keys).toEqual(['exitPlan', 'riskAtEntry', 'setup', 'strategy', 'targetProfit']);
  });
});

describe('the outcome word follows the figure', () => {
  const withCost = (gross: string, cost: string) =>
    assessed({ basis: 'custom_r', grossRInput: gross, costR: cost });

  it('classifies a win, a loss and a break-even from net R', () => {
    expect(systemOutcome(withCost('5', '0.1'), CONTEXT)).toBe('win');
    expect(systemOutcome(withCost('-1', '0.1'), CONTEXT)).toBe('loss');
    expect(systemOutcome(withCost('0', '0'), CONTEXT)).toBe('break_even');
  });

  it('uses the engine’s break-even tolerance band, not a comparison with zero', () => {
    // 0.05R is the locked global tolerance; inside it is break-even.
    expect(systemOutcome(withCost('0.04', '0'), CONTEXT)).toBe('break_even');
    expect(systemOutcome(withCost('0.06', '0'), CONTEXT)).toBe('win');
  });

  it('cannot hold an outcome that contradicts its own figure', () => {
    // There is no independently editable outcome field to disagree with.
    expect(Object.keys(EMPTY_SYSTEM_ASSESSMENT)).not.toContain('outcome');
    expect(Object.keys(EMPTY_SYSTEM_ASSESSMENT)).not.toContain('systemOutcome');
  });
});

describe('unknown costs stay unknown', () => {
  const gross = assessed({ basis: 'custom_r', grossRInput: '5' });

  it('never reads a blank cost as zero', () => {
    expect(gross.costR).toBe('');
    expect(systemCostR(gross)).toBeNull();
    expect(systemGrossR(gross, CONTEXT)).toBe(5);
    // Gross is known; net is not, and is not quietly set equal to gross.
    expect(systemNetR(gross, CONTEXT)).toBeNull();
    expect(systemNetR(gross, CONTEXT)).not.toBe(5);
  });

  it('withholds the outcome verdict while the cost is unknown', () => {
    // Whether +0.04R gross is a win or a break-even depends entirely on the
    // cost nobody has estimated.
    expect(systemOutcome(gross, CONTEXT)).toBeNull();
  });

  it('produces a net figure once the cost is supplied', () => {
    const costed = { ...gross, costR: '0.15' };
    expect(systemNetR(costed, CONTEXT)).toBeCloseTo(4.85, 10);
    expect(systemOutcome(costed, CONTEXT)).toBe('win');
  });

  it('accepts an explicit zero cost as a real estimate', () => {
    const free = { ...gross, costR: '0' };
    expect(systemCostR(free)).toBe(0);
    expect(systemNetR(free, CONTEXT)).toBe(5);
  });
});

describe('gross must never be subtracted from net', () => {
  const actualR = 1.5;

  it('refuses an Execution Gap while the system side is gross-only', () => {
    const gross = assessed({ basis: 'custom_r', grossRInput: '5' });
    expect(comparability(gross, CONTEXT)).toBe('gross_only');
    /*
      1.5 − 5 = −3.5 is arithmetically available and semantically wrong: Actual R
      is net of every fee the trade really paid and this counterfactual is net of
      nothing, so the difference is overstated by the cost of trading, invisibly
      and always in the same direction.
    */
    expect(executionGapR(actualR, gross, CONTEXT)).toBeNull();
  });

  it('produces the gap once both sides are net', () => {
    const net = assessed({ basis: 'custom_r', grossRInput: '5', costR: '0.2' });
    expect(comparability(net, CONTEXT)).toBe('comparable');
    expect(executionGapR(actualR, net, CONTEXT)).toBeCloseTo(-3.3, 10);
  });

  it('refuses a gap for no_trade, cannot_determine and not_assessed', () => {
    for (const status of ['no_trade', 'cannot_determine', 'not_assessed'] as const) {
      const draft = { ...EMPTY_SYSTEM_ASSESSMENT, status };
      expect(comparability(draft, CONTEXT)).toBe('unavailable');
      expect(executionGapR(actualR, draft, CONTEXT)).toBeNull();
    }
  });

  it('refuses a gap when the actual side is unknown', () => {
    const net = assessed({ basis: 'custom_r', grossRInput: '5', costR: '0.2' });
    expect(executionGapR(null, net, CONTEXT)).toBeNull();
  });
});

describe('adherence is a separate axis', () => {
  it('carries four states, so "partly" is expressible', () => {
    // A boolean cannot hold this, which is why the production column's shape is
    // not reused.
    for (const adherence of ['not_answered', 'followed', 'partly', 'not_followed'] as const) {
      expect({ ...EMPTY_SYSTEM_ASSESSMENT, adherence }.adherence).toBe(adherence);
    }
  });

  it('represents a system loss the trader followed', () => {
    const draft = assessed({
      reason: 'stop_hit',
      basis: 'plan_stop',
      costR: '0',
      adherence: 'followed',
    });
    expect(systemNetR(draft, CONTEXT)).toBe(-1);
    expect(systemOutcome(draft, CONTEXT)).toBe('loss');
    expect(draft.adherence).toBe('followed');
    expect(systemAssessmentSummary(draft, CONTEXT)).toEqual([
      'System -1.00R',
      'Followed your plan',
    ]);
  });

  it('represents a system win the trader did not follow', () => {
    const draft = assessed({ basis: 'plan_target', costR: '0', adherence: 'not_followed' });
    expect(systemOutcome(draft, CONTEXT)).toBe('win');
    expect(draft.adherence).toBe('not_followed');
  });

  it('represents no_trade with adherence answered independently', () => {
    // The rules forbade the trade AND the trader knows they did not follow them.
    const draft = {
      ...EMPTY_SYSTEM_ASSESSMENT,
      status: 'no_trade' as const,
      adherence: 'not_followed' as const,
    };
    expect(systemGrossR(draft, CONTEXT)).toBeNull();
    expect(systemAssessmentSummary(draft, CONTEXT)).toEqual([
      'Your rules would not have taken this trade',
      'Did not follow your plan',
    ]);
  });

  it('never infers adherence from the system outcome', () => {
    const win = assessed({ basis: 'plan_target', costR: '0' });
    const loss = assessed({ reason: 'stop_hit', basis: 'plan_stop', costR: '0' });
    expect(win.adherence).toBe('not_answered');
    expect(loss.adherence).toBe('not_answered');
  });
});

describe('provenance', () => {
  it('defaults to unknown rather than claiming the rules were recorded at entry', () => {
    expect(EMPTY_SYSTEM_ASSESSMENT.planProvenance).toBe('unknown');
  });

  it('keeps a reconstructed plan distinguishable from one recorded at entry', () => {
    const later = { ...EMPTY_SYSTEM_ASSESSMENT, planProvenance: 'reconstructed_later' as const };
    const atEntry = { ...EMPTY_SYSTEM_ASSESSMENT, planProvenance: 'at_entry' as const };
    expect(later.planProvenance).not.toBe(atEntry.planProvenance);
  });

  it('labels every prototype resolution as trader-assessed, not measured', () => {
    // Even `plan_stop`, whose −1R the app computes: the arithmetic is machine,
    // the causation is human, and the causation is the load-bearing part.
    expect(assessed({ basis: 'plan_stop' }).resolutionSource).toBe('trader_assessed');
    expect(assessed({ basis: 'plan_target' }).resolutionSource).toBe('trader_assessed');
  });
});

describe('a dependency that moves marks the assessment for review', () => {
  const draft = assessed({ basis: 'plan_target', costR: '0' });

  it('is settled while nothing it rested on has changed', () => {
    expect(needsReview(draft, CONTEXT)).toBe(false);
  });

  it('flags a changed strategy, setup or exit plan', () => {
    expect(needsReview(draft, { ...CONTEXT, strategy: 'Mean Reversion' })).toBe(true);
    expect(needsReview(draft, { ...CONTEXT, setup: 'Wave C exhaustion' })).toBe(true);
    expect(
      needsReview(draft, {
        ...CONTEXT,
        exitPlan: { ...PLAN, instructions: 'Take profit at three R.' },
      }),
    ).toBe(true);
  });

  it('preserves the entered assessment rather than erasing it', () => {
    const moved = { ...CONTEXT, strategy: 'Mean Reversion' };
    expect(needsReview(draft, moved)).toBe(true);
    // Everything the trader entered is still there, and still computes.
    expect(draft.status).toBe('assessed');
    expect(draft.reason).toBe('target_hit');
    expect(systemNetR(draft, moved)).toBe(5);
  });

  it('flags a figure the basis actually divided by', () => {
    expect(needsReview(draft, { ...CONTEXT, riskAtEntry: '100.00' })).toBe(true);
    expect(needsReview(draft, { ...CONTEXT, targetProfit: '900.00' })).toBe(true);
  });

  it('does not cry wolf over a figure the basis never read', () => {
    // A directly typed gross R does not depend on the risk or the target.
    const typed = assessed({ basis: 'custom_r', grossRInput: '2.4' });
    expect(needsReview(typed, { ...CONTEXT, riskAtEntry: '100.00' })).toBe(false);
    expect(needsReview(typed, { ...CONTEXT, targetProfit: '900.00' })).toBe(false);
    // The rules are a dependency of every assessment, including this one.
    expect(needsReview(typed, { ...CONTEXT, strategy: 'Mean Reversion' })).toBe(true);
  });

  it('rests no_trade on the rules that forbade the trade', () => {
    const forbidden: SystemAssessmentDraft = {
      ...EMPTY_SYSTEM_ASSESSMENT,
      status: 'no_trade',
      dependencies: assessmentDependencies(CONTEXT, null),
    };
    expect(needsReview(forbidden, CONTEXT)).toBe(false);
    expect(needsReview(forbidden, { ...CONTEXT, setup: 'Wave C exhaustion' })).toBe(true);
  });

  it('settles again once the trader re-confirms, and re-flags on the next change', () => {
    const moved = { ...CONTEXT, strategy: 'Mean Reversion' };
    const confirmed = confirmAssessment(draft, moved);
    expect(needsReview(confirmed, moved)).toBe(false);
    // Confirming once does not silence every future change.
    expect(needsReview(confirmed, { ...moved, setup: 'Wave C exhaustion' })).toBe(true);
  });

  it('never flags an unassessed trade', () => {
    expect(needsReview(EMPTY_SYSTEM_ASSESSMENT, { ...CONTEXT, strategy: 'Anything' })).toBe(false);
  });
});
